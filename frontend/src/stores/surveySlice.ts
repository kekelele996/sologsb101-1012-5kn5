/**
 * 测量组复测坐标 slice：复测台账、对账状态机、按中心口径重算孔径。
 *
 * 与中心 arraySlice 分开：本 slice 只管测量组那份实测坐标（surveyCoords 表）；
 * 写操作落 IndexedDB，数据由 liveQuery 回流，页面只读 selector。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db, watchTable } from '@/utils/db';
import type {
  SurveyCoord,
  SurveyFilterState,
  SurveyStatus,
} from '@/types/survey';
import {
  ACCEPTABLE_STATUSES,
  RETRYABLE_STATUSES,
  createEmptySurveyFilter,
  reconcileByCode,
} from '@/types/survey';
import { apertureFromCenter } from '@/utils/reconcile';
import type { RootState } from '@/stores/store';

type WithSurvey = RootState;

export interface SurveySliceState {
  surveyCoords: SurveyCoord[];
  ready: boolean;
  error: string | null;
  filter: SurveyFilterState;
}

const initialState: SurveySliceState = {
  surveyCoords: [],
  ready: false,
  error: null,
  filter: createEmptySurveyFilter(),
};

/** 新建复测记录入参（测量组平板录入；十进制或度分秒均可，归一化由页面完成） */
export type SurveyDraft = Omit<SurveyCoord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'reconcileNote' | 'retryCount' | 'acceptedAt'>;

export const createSurveyCoord = createAsyncThunk(
  'survey/create',
  async (draft: SurveyDraft) => {
    const now = Date.now();
    const row: SurveyCoord = {
      ...draft,
      code: draft.code.trim().toUpperCase(),
      id: createId('srv'),
      status: '待对账',
      reconcileNote: '外业平板复测，尚未按台站码对账',
      retryCount: 0,
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.surveyCoords.put(row);
    return row;
  }
);

/** 测量组修改复测记录：已认账为终态，禁止改动 */
export const updateSurveyCoord = createAsyncThunk(
  'survey/update',
  async (payload: { id: string; patch: Partial<SurveyCoord> }) => {
    const existing = await db.surveyCoords.get(payload.id);
    if (!existing) throw new Error('复测记录不存在');
    if (existing.status === '已认账') {
      throw new Error('该复测中心已认账，认下不退回，不能再修改');
    }
    const patch = { ...payload.patch };
    if (typeof patch.code === 'string') patch.code = patch.code.trim().toUpperCase();
    await db.surveyCoords.update(payload.id, { ...patch, updatedAt: Date.now() } as never);
    return payload;
  }
);

/** 测量组删除复测记录：已认账为终态，禁止删除（保留追溯） */
export const removeSurveyCoord = createAsyncThunk('survey/remove', async (id: string) => {
  const existing = await db.surveyCoords.get(id);
  if (!existing) return id;
  if (existing.status === '已认账') {
    throw new Error('该复测中心已认账，认下不退回，不能删除');
  }
  await db.surveyCoords.delete(id);
  return id;
});

/**
 * 按台站码对账（测量侧发起）：
 * - 中心名册有此码 → 待认账；没有 → 待确认（挂起，可重试）。
 * - 已认账的不参与对账（认下不退回）。
 */
export const reconcileSurveyCoord = createAsyncThunk(
  'survey/reconcile',
  async (id: string) => {
    const row = await db.surveyCoords.get(id);
    if (!row) throw new Error('复测记录不存在');
    if (row.status === '已认账') {
      throw new Error('该复测中心已认账，无需重复对账');
    }
    const stations = await db.stations.toArray();
    const outcome = reconcileByCode(row.code, stations.map((station) => ({ code: station.code })));
    const isRetry = RETRYABLE_STATUSES.includes(row.status);
    const next: Partial<SurveyCoord> = {
      status: outcome.status,
      reconcileNote: outcome.reconcileNote,
      retryCount: isRetry ? row.retryCount + 1 : row.retryCount,
      updatedAt: Date.now(),
    };
    await db.surveyCoords.update(id, next as never);
    return { id, ...next } as { id: string; status: SurveyStatus; reconcileNote: string; retryCount: number };
  }
);

/** 批量对账：仅处理可对账状态（待对账 / 待确认重试）；已认账跳过不退回 */
export const reconcilePendingSurveys = createAsyncThunk(
  'survey/reconcilePending',
  async () => {
    const rows = await db.surveyCoords.toArray();
    const stations = await db.stations.toArray();
    const targets = rows.filter((row) => RETRYABLE_STATUSES.includes(row.status));
    const now = Date.now();
    await db.surveyCoords.bulkPut(
      targets.map((row) => {
        const outcome = reconcileByCode(row.code, stations.map((station) => ({ code: station.code })));
        return {
          ...row,
          status: outcome.status,
          reconcileNote: outcome.reconcileNote,
          retryCount: row.status === '待确认' ? row.retryCount + 1 : row.retryCount,
          updatedAt: now,
        };
      })
    );
    return targets.length;
  }
);

/**
 * 中心认账：把「待认账」复测认下，进入中心孔径口径（终态，不退回）。
 * 认账前再按 code 核一遍中心名册，防止复测记录挂起期间名册变动。
 */
export const acceptSurveyCoord = createAsyncThunk(
  'survey/accept',
  async (id: string) => {
    const row = await db.surveyCoords.get(id);
    if (!row) throw new Error('复测记录不存在');
    if (row.status === '已认账') throw new Error('该复测已认账');
    if (!ACCEPTABLE_STATUSES.includes(row.status)) {
      throw new Error('只有「待认账」（已对上中心名册）的复测才能认账');
    }
    const exists = await db.stations
      .where('code')
      .equalsIgnoreCase(row.code.trim())
      .count();
    if (exists === 0) {
      throw new Error(`中心名册已无台站码 ${row.code}，请先确认归属再认账`);
    }
    const now = Date.now();
    const next: Partial<SurveyCoord> = {
      status: '已认账',
      reconcileNote: '中心已认账：该实测坐标进入中心孔径口径，认下不退回',
      acceptedAt: now,
      updatedAt: now,
    };
    await db.surveyCoords.update(id, next as never);
    return { id, ...next } as { id: string; status: SurveyStatus; acceptedAt: number };
  }
);

/**
 * 按「中心手里那份」重算台阵孔径并回写台阵表：
 * 已认账复测坐标优先，未认账回退中心初设坐标。台站归属（哪个台阵）仍认中心 arrayId。
 */
export const recomputeApertureFromCenter = createAsyncThunk(
  'survey/recomputeAperture',
  async (arrayId: string) => {
    const [stations, surveys] = await Promise.all([db.stations.toArray(), db.surveyCoords.toArray()]);
    const computed = apertureFromCenter(arrayId, stations, surveys);
    await db.arrays.update(arrayId, { apertureKm: computed, updatedAt: Date.now() } as never);
    return { arrayId, apertureKm: computed };
  }
);

/** 批量按中心口径重算全部台阵孔径（认账后可一键刷新分档） */
export const recomputeAllAperturesFromCenter = createAsyncThunk(
  'survey/recomputeAllApertures',
  async () => {
    const [arrays, stations, surveys] = await Promise.all([
      db.arrays.toArray(),
      db.stations.toArray(),
      db.surveyCoords.toArray(),
    ]);
    const now = Date.now();
    const results = arrays.map((array) => {
      const computed = apertureFromCenter(array.id, stations, surveys);
      return { id: array.id, apertureKm: computed, updatedAt: now };
    });
    await db.arrays.bulkPut(
      arrays.map((array) => {
        const hit = results.find((row) => row.id === array.id);
        return { ...array, apertureKm: hit?.apertureKm ?? array.apertureKm, updatedAt: now };
      })
    );
    return results;
  }
);

const surveySlice = createSlice({
  name: 'survey',
  initialState,
  reducers: {
    setSurveyCoords(state, action: PayloadAction<SurveyCoord[]>) {
      state.surveyCoords = action.payload;
      state.ready = true;
      state.error = null;
    },
    setSurveyError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    patchSurveyFilter(state, action: PayloadAction<Partial<SurveyFilterState>>) {
      state.filter = { ...state.filter, ...action.payload };
    },
    resetSurveyFilter(state) {
      state.filter = createEmptySurveyFilter();
    },
  },
});

export const { setSurveyCoords, setSurveyError, patchSurveyFilter, resetSurveyFilter } =
  surveySlice.actions;

/* ------------------------------ 模块级订阅启动 ------------------------------ */

let started = false;

/** 启动 surveyCoords 表实时订阅（幂等）：应用挂载时调用一次 */
export function startSurveySubscription(dispatch: (action: unknown) => void): void {
  if (started) return;
  started = true;
  watchTable<SurveyCoord>(() => db.surveyCoords).subscribe((rows) => {
    dispatch(setSurveyCoords(rows));
  });
}

/* ------------------------------ Selector ------------------------------ */

export const selectSurveyState = (state: WithSurvey): SurveySliceState => state.survey;
export const selectSurveyCoords = (state: WithSurvey): SurveyCoord[] => state.survey.surveyCoords;
export const selectSurveyReady = (state: WithSurvey): boolean => state.survey.ready;
export const selectSurveyFilter = (state: WithSurvey): SurveyFilterState => state.survey.filter;

export default surveySlice.reducer;
