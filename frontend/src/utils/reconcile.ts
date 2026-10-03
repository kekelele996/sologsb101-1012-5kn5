/**
 * 测量组复测坐标 ↔ 中心台账 对账，以及「中心手里那份」有效点位与孔径口径。
 *
 * 归属原则（两份分开管）：
 * - 实测坐标认测量组（SurveyCoord.lat/lng）；
 * - 台站归属与孔径分档认中心（SeisStation.arrayId、SeisArray）；
 * - 两边只按台站码 code 对账，复测记录不直接绑定中心台站 id；
 * - 中心认账（accepted）后该复测点位才进入中心口径；认下不退回；
 * - 台站迁走后复测坐标仍跟 code：同一 code 取最新一次「已认账」，旧认账保留追溯；
 * - 尚未认账时回退中心初设坐标（保证孔径始终可算，且不被未认账复测污染）。
 */
import type { SeisStation } from '@/types/station';
import type { SurveyCoord } from '@/types/survey';
import { apertureKm, haversineKm, type GeoPoint } from '@/utils/geo';

/** 点位来源：中心初设坐标 / 测量组已认账复测坐标 */
export type PointSource = '中心初设' | '复测认账';

export interface CenterPoint extends GeoPoint {
  /** 中心台站 id（几何/SVG 连线需要） */
  stationId: string;
  /** 所属台阵（归属认中心） */
  arrayId: string;
  lat: number;
  lng: number;
  /** 当前进入中心口径的坐标来源 */
  source: PointSource;
  /** 来源复测记录 id（source=复测认账 时） */
  surveyId: string | null;
  /** 复测日期，便于几何页标注 */
  measuredAt: string | null;
}

/**
 * 每个台站码取最新一次「已认账」复测（acceptedAt 最大；并列时取 updatedAt）。
 * 台站迁走后旧认账记录仍保留，这里只选最新的一份作为当前有效点位。
 */
export function latestAcceptedByCode(surveyCoords: SurveyCoord[]): Map<string, SurveyCoord> {
  const map = new Map<string, SurveyCoord>();
  surveyCoords
    .filter((row) => row.status === '已认账')
    .forEach((row) => {
      const key = row.code.trim().toUpperCase();
      const current = map.get(key);
      if (!current) {
        map.set(key, row);
        return;
      }
      const currentRank = current.acceptedAt ?? current.updatedAt;
      const nextRank = row.acceptedAt ?? row.updatedAt;
      if (nextRank > currentRank) map.set(key, row);
    });
  return map;
}

/**
 * 计算中心手里那份有效点位（孔径/分档统一以此为准）：
 * 有该 code 的已认账复测 → 用复测坐标；否则回退中心初设坐标。
 */
export function buildCenterPoints(
  stations: SeisStation[],
  surveyCoords: SurveyCoord[]
): CenterPoint[] {
  const accepted = latestAcceptedByCode(surveyCoords);
  return stations.map((station) => {
    const survey = accepted.get(station.code.trim().toUpperCase());
    if (survey && Number.isFinite(survey.lat) && Number.isFinite(survey.lng)) {
      return {
        id: station.id,
        stationId: station.id,
        arrayId: station.arrayId,
        code: station.code,
        lat: survey.lat,
        lng: survey.lng,
        source: '复测认账',
        surveyId: survey.id,
        measuredAt: survey.measuredAt,
      };
    }
    return {
      id: station.id,
      stationId: station.id,
      arrayId: station.arrayId,
      code: station.code,
      lat: station.lat,
      lng: station.lng,
      source: '中心初设',
      surveyId: null,
      measuredAt: null,
    };
  });
}

/** 单台阵的中心有效点位（孔径只按中心这份算） */
export function centerPointsOfArray(
  arrayId: string,
  stations: SeisStation[],
  surveyCoords: SurveyCoord[]
): CenterPoint[] {
  return buildCenterPoints(
    stations.filter((station) => station.arrayId === arrayId),
    surveyCoords
  );
}

/** 按中心有效点位重算台阵孔径（km，最大台间距） */
export function apertureFromCenter(
  arrayId: string,
  stations: SeisStation[],
  surveyCoords: SurveyCoord[]
): number {
  const points = centerPointsOfArray(arrayId, stations, surveyCoords);
  return apertureKm(points);
}

/** 复测记录对账视图：挂上中心名册匹配情况，供对账页展示 */
export interface SurveyReconcileRow extends SurveyCoord {
  /** 中心名册是否有此台站码 */
  matched: boolean;
  /** 匹配到的中心台站（可能已归到不同台阵——台站迁走的情形） */
  centerStation: SeisStation | null;
  /** 已认账复测坐标与中心初设坐标的偏差（km） */
  driftKm: number | null;
}

/** 生成对账页行数据（纯函数，便于筛选与展示） */
export function buildSurveyReconcileRows(
  surveyCoords: SurveyCoord[],
  stations: SeisStation[]
): SurveyReconcileRow[] {
  return surveyCoords.map((row) => {
    const centerStation =
      stations.find((station) => station.code.trim().toUpperCase() === row.code.trim().toUpperCase()) ??
      null;
    let driftKm: number | null = null;
    if (
      centerStation &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lng) &&
      !(centerStation.lat === 0 && centerStation.lng === 0)
    ) {
      driftKm = haversineKm(
        { lat: centerStation.lat, lng: centerStation.lng },
        { lat: row.lat, lng: row.lng }
      );
    }
    return {
      ...row,
      matched: centerStation !== null,
      centerStation,
      driftKm,
    };
  });
}
