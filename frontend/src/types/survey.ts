/**
 * 测量组复测坐标（外业平板复测台账）
 *
 * 与中心台账（types/station.ts）分开管：
 * - 实测坐标（lat/lng）认测量组这一份；
 * - 台站归属（arrayId）与孔径分档认中心台账；
 * - 两边只按「台站码 code」对账，复测记录不直接绑定中心台站 id。
 *
 * 对账状态机：
 *   待对账 pending  ──按 code 对账──▶ 待认账 matched（中心名册有此码）
 *                    └─对不上──────▶ 待确认 failed（中心名册没有，先挂着等确认，可重试）
 *   待认账 matched  ──中心认账────▶ 已认账 accepted（终态：进入中心孔径口径，不退回）
 *
 * 台站迁走后仍按 code 复测：新记录再走一遍对账，认账后中心口径切到新点位；
 * 历史「已认账」记录保留作为追溯，重算时只取该码最新一次认账。
 */

/** 复测对账状态 */
export type SurveyStatus =
  | '待对账' // 测量组刚提交，尚未按台站码对账
  | '待认账' // 已对上中心名册，等中心认账
  | '已认账' // 中心认下：进入中心孔径口径（终态，不退回）
  | '待确认'; // 对账失败挂起：中心名册没有该台站码，测量组修正后可重试

export const SURVEY_STATUSES: SurveyStatus[] = ['待对账', '待认账', '已认账', '待确认'];

/** 可重试对账的状态：待对账 与 对账失败挂起 */
export const RETRYABLE_STATUSES: SurveyStatus[] = ['待对账', '待确认'];

/** 中心可认账的状态：只有已经对上中心名册的「待认账」 */
export const ACCEPTABLE_STATUSES: SurveyStatus[] = ['待认账'];

/** 已认账为终态，不可编辑、不可删除、不可退回 */
export function isAccepted(row: { status: SurveyStatus }): boolean {
  return row.status === '已认账';
}

/** 测量组复测坐标记录 */
export interface SurveyCoord {
  id: string;
  /** 台站码：与中心名册对账的唯一依据（台站迁走也不变） */
  code: string;
  /** 复测纬度（十进制度，由度分秒升级补出或直接录入） */
  lat: number;
  /** 复测经度（十进制度） */
  lng: number;
  /** 原始度分秒记录（旧数据只有这一份；新录入自动回填，便于外业核对） */
  latDms: string;
  lngDms: string;
  /** 复测日期 YYYY-MM-DD */
  measuredAt: string;
  /** 外业测量员 */
  surveyor: string;
  /** 复测手段（平板 GNSS / 全站仪等） */
  method: string;
  /** 对账状态 */
  status: SurveyStatus;
  /** 对账/认账备注：失败原因、认账说明等 */
  reconcileNote: string;
  /** 重试对账次数（对账失败后测量侧重试累计） */
  retryCount: number;
  /** 认账时间戳：已认账时由中心写入，用于同一台站码取最新认账 */
  acceptedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 复测台账筛选（存于 surveySlice） */
export interface SurveyFilterState {
  keyword: string;
  statuses: SurveyStatus[];
}

export function createEmptySurveyFilter(): SurveyFilterState {
  return { keyword: '', statuses: [] };
}

/** 对账结果：只回状态与备注，实测坐标本身保持测量组原值不动 */
export interface ReconcileOutcome {
  status: SurveyStatus;
  reconcileNote: string;
}

/**
 * 按台站码对中心名册：
 * - 名册里能找到该 code：进入「待认账」，备注附上中心归属的台站名/台阵，供中心核对；
 * - 找不到：挂起「待确认」，等中心补名册或测量组核对台站码（可重试）。
 */
export function reconcileByCode(
  code: string,
  roster: Array<{ code: string; nameHint?: string }>
): ReconcileOutcome {
  const hit = roster.find((row) => row.code.trim().toUpperCase() === code.trim().toUpperCase());
  if (hit) {
    return {
      status: '待认账',
      reconcileNote: hit.nameHint
        ? `台站码已对上中心名册：${hit.nameHint}，待中心认账`
        : '台站码已对上中心名册，待中心认账',
    };
  }
  return {
    status: '待确认',
    reconcileNote: '中心名册暂无此台站码，先挂起等确认；测量组核对台站码后可重试对账',
  };
}
