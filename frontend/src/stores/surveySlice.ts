/**
 * 复测 slice：维护测量组复测记录与对账状态。
 * 双台账分管：实测坐标认测量组（surveys 表），台站归属与孔径分档认中心（stations / arrays 表）；
 * 两边按台站码对账，中心名册没有的先挂着等确认；对账失败后测量组重试，中心认下的不退回。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { db, createId, watchTable } from '@/utils/db';
import type { SurveyRecord, SurveyFilterState } from '@/types/survey';
import { canRetrySurvey, createEmptySurveyFilter } from '@/types/survey';
import { apertureKm, validateLatLng } from '@/utils/geo';
import type { RootState } from '@/stores/store';

/** 选择器入参统一用 RootState */
type WithSurvey = RootState;

export interface SurveySliceState {
  surveys: SurveyRecord[];
  ready: boolean;
  error: string | null;
  filter: SurveyFilterState;
  /** 最近一次对账 / 重试回执 */
  lastReceipt: string;
}

const initialState: SurveySliceState = {
  surveys: [],
  ready: false,
  error: null,
  filter: createEmptySurveyFilter(),
  lastReceipt: '',
};

export interface ReconcileResult {
  /** 本轮实际参与对账的条数（不含已认下跳过的） */
  total: number;
  accepted: number;
  held: number;
  failed: number;
  /** 已认下被跳过（不退回、不重复对账） */
  skipped: number;
}

/**
 * 对账主流程（模块内部复用）：按台站码与中心名册核对。
 * - 名册有 → 认下：实测坐标写回中心台账，孔径按中心手里那份（台账全量台站）重算；
 * - 名册没有 → 挂起待确认，等中心确认；
 * - 坐标无效 → 对账失败，等测量组重试；
 * - 已认下的一律跳过：中心认下的不退回。
 */
async function runReconcile(ids?: string[]): Promise<ReconcileResult> {
  const now = Date.now();
  const all = await db.surveys.toArray();
  // 同一台站码多条记录时按复测日期先后处理，保证最新一次最后写入中心台账
  const targets = all
    .filter((row) => (ids ? ids.includes(row.id) : true))
    .sort((a, b) => a.surveyDate.localeCompare(b.surveyDate) || a.createdAt - b.createdAt);
  const result: ReconcileResult = { total: 0, accepted: 0, held: 0, failed: 0, skipped: 0 };
  const stations = await db.stations.toArray();
  const byCode = new Map(stations.map((row) => [row.code.trim().toUpperCase(), row]));

  for (const record of targets) {
    if (record.state === '已认下') {
      result.skipped += 1;
      continue;
    }
    result.total += 1;

    const errors = validateLatLng(record.lat, record.lng);
    if (errors.length > 0) {
      await db.surveys.update(record.id, {
        state: '对账失败',
        note: `坐标无效：${errors.join('；')}，请测量组核实后重试`,
        updatedAt: now,
      } as never);
      result.failed += 1;
      continue;
    }

    const station = byCode.get(record.code.trim().toUpperCase());
    if (!station) {
      await db.surveys.update(record.id, {
        state: '挂起待确认',
        note: '中心名册没有该台站码，先挂着等中心确认',
        updatedAt: now,
      } as never);
      result.held += 1;
      continue;
    }

    await db.transaction('rw', [db.surveys, db.stations, db.arrays], async () => {
      // 实测坐标认测量组：认下即写回中心台账（台站迁走后复测坐标仍跟着台站码走）
      await db.stations.update(station.id, {
        lat: record.lat,
        lng: record.lng,
        elevM: record.elevM,
        coordSource: '实测',
        surveyedAt: record.surveyDate,
        updatedAt: now,
      } as never);
      // 孔径按中心手里那份重算：以中心台账全量台站坐标实算并回写登记孔径
      const rows = await db.stations.where('arrayId').equals(station.arrayId).toArray();
      const computed = apertureKm(
        rows.map((row) => ({ id: row.id, code: row.code, lat: row.lat, lng: row.lng }))
      );
      await db.arrays.update(station.arrayId, { apertureKm: computed, updatedAt: now } as never);
      await db.surveys.update(record.id, {
        state: '已认下',
        stationId: station.id,
        note: `中心已认下，实测坐标已入中心台账；孔径按中心台账重算为 ${computed} km`,
        updatedAt: now,
      } as never);
    });
    result.accepted += 1;
  }
  return result;
}

function formatReceipt(action: string, result: ReconcileResult): string {
  const parts = [
    `认下 ${result.accepted} 条`,
    `挂起待确认 ${result.held} 条`,
    `对账失败 ${result.failed} 条`,
  ];
  if (result.skipped > 0) parts.push(`已认下跳过 ${result.skipped} 条（不退回）`);
  return `${action}完成：${parts.join('，')}`;
}

/* ------------------------------ 异步动作（落库后由 liveQuery 回流） ------------------------------ */

export const createSurvey = createAsyncThunk(
  'survey/createSurvey',
  async (
    payload: Omit<SurveyRecord, 'id' | 'createdAt' | 'updatedAt' | 'state' | 'stationId' | 'retryCount' | 'note'>
  ) => {
    const now = Date.now();
    const row: SurveyRecord = {
      ...payload,
      state: '待对账',
      stationId: null,
      retryCount: 0,
      note: '',
      id: createId('svy'),
      createdAt: now,
      updatedAt: now,
    };
    await db.surveys.put(row);
    return row;
  }
);

/** 更正复测记录（测量组核实后修正坐标）：保存后置回待对账；已认下的不退回、不可改 */
export const updateSurvey = createAsyncThunk(
  'survey/updateSurvey',
  async (payload: { id: string; patch: Partial<SurveyRecord> }, { rejectWithValue }) => {
    const record = await db.surveys.get(payload.id);
    if (!record) return rejectWithValue('复测记录不存在');
    if (record.state === '已认下') return rejectWithValue('中心已认下的记录不退回，不可修改');
    await db.surveys.update(payload.id, {
      ...payload.patch,
      state: '待对账',
      note: '',
      updatedAt: Date.now(),
    } as never);
    return payload;
  }
);

/** 全量或指定记录的批量对账 */
export const reconcileSurveys = createAsyncThunk(
  'survey/reconcileSurveys',
  async (payload?: { ids?: string[] }) => runReconcile(payload?.ids)
);

/** 测量组侧重试：仅挂起 / 失败的记录可置回待对账并立即重新对账；已认下的不退回 */
export const retrySurvey = createAsyncThunk(
  'survey/retrySurvey',
  async (id: string, { rejectWithValue }) => {
    const record = await db.surveys.get(id);
    if (!record) return rejectWithValue('复测记录不存在');
    if (record.state === '已认下') return rejectWithValue('中心已认下的记录不退回，无需重试');
    if (!canRetrySurvey(record.state)) {
      return rejectWithValue(`「${record.state}」状态请直接用对账处理，无需重试`);
    }
    await db.surveys.update(id, {
      state: '待对账',
      retryCount: record.retryCount + 1,
      note: '',
      updatedAt: Date.now(),
    } as never);
    return runReconcile([id]);
  }
);

/** 删除复测记录：已认下的留在台账备查，不可删除 */
export const removeSurvey = createAsyncThunk(
  'survey/removeSurvey',
  async (id: string, { rejectWithValue }) => {
    const record = await db.surveys.get(id);
    if (!record) return rejectWithValue('复测记录不存在');
    if (record.state === '已认下') return rejectWithValue('中心已认下的记录不退回，保留备查');
    await db.surveys.delete(id);
    return id;
  }
);

const surveySlice = createSlice({
  name: 'survey',
  initialState,
  reducers: {
    /** 由 liveQuery 推送整表数据 */
    setSurveys(state, action: PayloadAction<SurveyRecord[]>) {
      state.surveys = action.payload;
      state.ready = true;
      state.error = null;
    },
    patchSurveyFilter(state, action: PayloadAction<Partial<SurveyFilterState>>) {
      state.filter = { ...state.filter, ...action.payload };
    },
    resetSurveyFilter(state) {
      state.filter = createEmptySurveyFilter();
    },
    setSurveyError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(createSurvey.fulfilled, (state, action) => {
        state.lastReceipt = `复测记录 ${action.payload.code}（${action.payload.surveyDate}）已登记，等待对账`;
      })
      .addCase(updateSurvey.rejected, (state, action) => {
        state.error = typeof action.payload === 'string' ? action.payload : '更正失败';
      })
      .addCase(reconcileSurveys.fulfilled, (state, action) => {
        state.lastReceipt = formatReceipt('对账', action.payload);
      })
      .addCase(retrySurvey.fulfilled, (state, action) => {
        state.lastReceipt = formatReceipt('重试对账', action.payload);
      })
      .addCase(retrySurvey.rejected, (state, action) => {
        state.error = typeof action.payload === 'string' ? action.payload : '重试失败';
      })
      .addCase(removeSurvey.rejected, (state, action) => {
        state.error = typeof action.payload === 'string' ? action.payload : '删除失败';
      });
  },
});

export const { setSurveys, patchSurveyFilter, resetSurveyFilter, setSurveyError } = surveySlice.actions;

/* ------------------------------ 模块级订阅启动 ------------------------------ */

let started = false;

/** 启动复测记录表实时订阅（幂等）：在应用挂载时调用一次 */
export function startSurveySubscription(dispatch: (action: unknown) => void): void {
  if (started) return;
  started = true;
  watchTable<SurveyRecord>(() => db.surveys).subscribe((rows) => {
    dispatch(setSurveys(rows));
  });
}

/* ------------------------------ Selector ------------------------------ */

export const selectSurveyState = (state: WithSurvey): SurveySliceState => state.survey;
export const selectSurveys = (state: WithSurvey): SurveyRecord[] => state.survey.surveys;
export const selectSurveyReady = (state: WithSurvey): boolean => state.survey.ready;
export const selectSurveyFilter = (state: WithSurvey): SurveyFilterState => state.survey.filter;
export const selectSurveyReceipt = (state: WithSurvey): string => state.survey.lastReceipt;

/** 各对账状态计数（统计徽标与导航角标共用） */
export const selectSurveyCounts = (
  state: WithSurvey
): { pending: number; accepted: number; held: number; failed: number } => {
  const counts = { pending: 0, accepted: 0, held: 0, failed: 0 };
  state.survey.surveys.forEach((row) => {
    if (row.state === '待对账') counts.pending += 1;
    else if (row.state === '已认下') counts.accepted += 1;
    else if (row.state === '挂起待确认') counts.held += 1;
    else if (row.state === '对账失败') counts.failed += 1;
  });
  return counts;
};

export default surveySlice.reducer;
