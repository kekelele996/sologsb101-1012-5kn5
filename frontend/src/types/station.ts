/** 基岩类型 */
export type BedrockType = '花岗岩' | '玄武岩' | '石灰岩' | '砂岩' | '片麻岩' | '第四系覆盖';

export const BEDROCK_TYPES: BedrockType[] = ['花岗岩', '玄武岩', '石灰岩', '砂岩', '片麻岩', '第四系覆盖'];

/** 坐标来源：初设（中心台账登记值）/ 实测（测量组复测、中心认下后写回） */
export type CoordSource = '初设' | '实测';

export const COORD_SOURCES: CoordSource[] = ['初设', '实测'];

/** 台站：台阵内的观测点位（台网中心名册，台站归属认中心） */
export interface SeisStation {
  id: string;
  /** 所属台阵 */
  arrayId: string;
  /** 台站码，如 SX01；与测量组复测记录对账的关键字 */
  code: string;
  /** 纬度（十进制度，-90 ~ 90） */
  lat: number;
  /** 经度（十进制度，-180 ~ 180） */
  lng: number;
  /** 高程（m） */
  elevM: number;
  /** 基岩类型 */
  bedrock: BedrockType;
  /** 坐标来源：初设 / 实测（实测坐标认测量组，认下后写回本台账） */
  coordSource: CoordSource;
  /** 最近一次复测日期（YYYY-MM-DD，空串表示尚未复测） */
  surveyedAt: string;
  /** 场地备注 */
  siteNote: string;
  createdAt: number;
  updatedAt: number;
}

/** 台站列表页筛选条件（存于 instrumentSlice） */
export interface StationFilterState {
  keyword: string;
  bedrocks: BedrockType[];
  /** 高程下限（m） */
  minElevM: number | null;
  /** 是否只看未安装仪器的台站 */
  onlyEmpty: boolean;
}

export function createEmptyStationFilter(): StationFilterState {
  return {
    keyword: '',
    bedrocks: [],
    minElevM: null,
    onlyEmpty: false
  };
}

/** 经纬度范围校验：返回错误信息数组（为空表示通过） */
export function validateLatLng(lat: number, lng: number): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('纬度应在 -90 ~ 90 之间');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('经度应在 -180 ~ 180 之间');
  return errors;
}

/** 十进制度 → 度分秒文本，便于外业核对 */
export function formatLatLng(lat: number, lng: number): string {
  const toDms = (value: number, positive: string, negative: string): string => {
    const hemisphere = value >= 0 ? positive : negative;
    const abs = Math.abs(value);
    const degree = Math.floor(abs);
    const minutesFloat = (abs - degree) * 60;
    const minute = Math.floor(minutesFloat);
    const second = ((minutesFloat - minute) * 60).toFixed(1);
    return `${degree}°${minute}′${second}″${hemisphere}`;
  };
  return `${toDms(lat, 'N', 'S')} ${toDms(lng, 'E', 'W')}`;
}
