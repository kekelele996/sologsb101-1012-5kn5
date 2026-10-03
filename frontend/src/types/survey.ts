/**
 * 复测记录：台阵投运后外业测量组用平板复测的点位坐标。
 * 双台账分管原则：实测坐标认测量组（本表），台站归属与孔径分档认台网中心（stations / arrays 台账）。
 * 两边按台站码对账；中心名册没有的先挂着等确认；中心认下的不退回。
 */

/** 复测记录对账状态 */
export type SurveyState = '待对账' | '已认下' | '挂起待确认' | '对账失败';

export const SURVEY_STATES: SurveyState[] = ['待对账', '已认下', '挂起待确认', '对账失败'];

/** 复测记录：测量组一侧的实测坐标台账 */
export interface SurveyRecord {
  id: string;
  /** 台站码：与中心名册对账的唯一关键字；台站迁走后复测坐标仍按台站码跟着台站 */
  code: string;
  /** 实测纬度（十进制度；旧数据只有度分秒时由升级/录入换算补出） */
  lat: number;
  /** 实测经度（十进制度） */
  lng: number;
  /** 实测高程（m） */
  elevM: number;
  /** 平板导出的原始度分秒文本（留档备查） */
  latDms: string;
  lngDms: string;
  /** 复测日期 YYYY-MM-DD */
  surveyDate: string;
  /** 测量员 / 班组 */
  surveyor: string;
  /** 对账状态 */
  state: SurveyState;
  /** 认下时关联的中心台账台站 id（未认下为 null） */
  stationId: string | null;
  /** 对账失败 / 挂起后的重试次数 */
  retryCount: number;
  /** 对账备注（失败原因、挂起说明、认下回执） */
  note: string;
  createdAt: number;
  updatedAt: number;
}

/** 复测对账台筛选条件（存于 surveySlice） */
export interface SurveyFilterState {
  keyword: string;
  states: SurveyState[];
}

export function createEmptySurveyFilter(): SurveyFilterState {
  return { keyword: '', states: [] };
}

/**
 * 是否允许测量组侧重试：仅「挂起待确认 / 对账失败」可置回待对账重新对账；
 * 「已认下」是中心确认后的终态，不退回、不重复对账。
 */
export function canRetrySurvey(state: SurveyState): boolean {
  return state === '挂起待确认' || state === '对账失败';
}

/** 是否允许删除：中心已认下的记录留在台账里备查，不可删除 */
export function canRemoveSurvey(state: SurveyState): boolean {
  return state !== '已认下';
}
