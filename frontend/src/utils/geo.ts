/**
 * 地理计算工具：经纬度格式校验、Haversine 台站间距与台阵孔径计算。
 */

const EARTH_RADIUS_KM = 6371.0088;

/** 角度转弧度 */
function toRadians(degree: number): number {
  return (degree * Math.PI) / 180;
}

/** 保留小数位 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 经纬度范围校验：返回错误信息数组（为空表示通过） */
export function validateLatLng(lat: number, lng: number): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('纬度应在 -90 ~ 90 之间');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('经度应在 -180 ~ 180 之间');
  return errors;
}

/** 十进制度文本化：保留 4 位小数 */
export function formatLatLng(lat: number, lng: number): string {
  return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
}

/** 十进制度 → 度分秒 */
export function toDms(value: number, axis: 'lat' | 'lng'): string {
  const positive = axis === 'lat' ? 'N' : 'E';
  const negative = axis === 'lat' ? 'S' : 'W';
  const hemisphere = value >= 0 ? positive : negative;
  return `${formatDmsParts(value)}${hemisphere}`;
}

/**
 * 解析度分秒文本为带符号的十进制度（旧外业数据只有度分秒，升级时据此补出十进制）。
 * 支持：`30°50′31.6″N`、`30 50 31.6 N`、`30°50′31.6″`、可省略分秒；
 * 半球字母 N/S/E/W 或前导正负号决定符号。无法解析返回 null。
 */
export function parseDms(text: string | null | undefined, axis: 'lat' | 'lng'): number | null {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (raw.length === 0) return null;
  const upper = raw.toUpperCase();
  const positive = axis === 'lat' ? 'N' : 'E';
  const negative = axis === 'lat' ? 'S' : 'W';
  let sign = 1;
  if (upper.includes(negative)) sign = -1;
  else if (upper.includes(positive)) sign = 1;
  else if (raw.trimStart().startsWith('-')) sign = -1;
  const numbers = raw.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return null;
  const degree = Number(numbers[0]);
  const minute = numbers[1] !== undefined ? Number(numbers[1]) : 0;
  const second = numbers[2] !== undefined ? Number(numbers[2]) : 0;
  if (!Number.isFinite(degree) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
  if (minute >= 60 || second >= 60) return null;
  const decimal = sign * (degree + minute / 60 + second / 3600);
  const limit = axis === 'lat' ? 90 : 180;
  if (decimal < -limit || decimal > limit) return null;
  return round(decimal, 6);
}

/** 十进制度 → 不带半球后缀的「度°分′秒″」串（供回填度分秒原始记录） */
export function formatDmsParts(value: number): string {
  const abs = Math.abs(value);
  const degree = Math.floor(abs);
  const minutesFloat = (abs - degree) * 60;
  const minute = Math.floor(minutesFloat);
  const second = ((minutesFloat - minute) * 60).toFixed(1);
  return `${degree}°${minute}′${second}″`;
}

/** 由十进制坐标生成完整度分秒记录（含半球后缀），供新录入复测自动回填 */
export function decimalToDmsRecord(lat: number, lng: number): { latDms: string; lngDms: string } {
  return { latDms: toDms(lat, 'lat'), lngDms: toDms(lng, 'lng') };
}

/**
 * 从度分秒对补出十进制度：优先用已解析的十进制，缺失时由度分秒解析。
 * 返回 null 表示两份都无法得到合法坐标（该点位不能参与孔径计算）。
 */
export function resolveCoord(input: {
  lat?: number | null;
  lng?: number | null;
  latDms?: string | null;
  lngDms?: string | null;
}): { lat: number; lng: number } | null {
  const hasDecimal =
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng) &&
    input.lat !== 0 &&
    input.lng !== 0;
  if (hasDecimal && validateLatLng(input.lat as number, input.lng as number).length === 0) {
    return { lat: input.lat as number, lng: input.lng as number };
  }
  const lat = parseDms(input.latDms, 'lat');
  const lng = parseDms(input.lngDms, 'lng');
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

/** Haversine 距离（km） */
export function haversineKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return round(EARTH_RADIUS_KM * c, 3);
}

export interface GeoPoint {
  id: string;
  code: string;
  lat: number;
  lng: number;
}

/** 台站间距矩阵：返回全部两两组合的距离（km），按距离降序 */
export function stationDistances(
  points: GeoPoint[]
): Array<{ from: string; to: string; fromCode: string; toCode: string; km: number }> {
  const rows: Array<{ from: string; to: string; fromCode: string; toCode: string; km: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      rows.push({
        from: points[i].id,
        to: points[j].id,
        fromCode: points[i].code,
        toCode: points[j].code,
        km: haversineKm(points[i], points[j]),
      });
    }
  }
  return rows.sort((a, b) => b.km - a.km);
}

/**
 * 台阵孔径（km）：台站两两距离的最大值（最大台间距）。
 * 单站或无站时返回 0。
 */
export function apertureKm(points: GeoPoint[]): number {
  const rows = stationDistances(points);
  return rows.length === 0 ? 0 : rows[0].km;
}

/**
 * 台阵几何中心（经纬度算术平均，适用于数十公里量级台阵）。
 */
export function centroid(points: GeoPoint[]): { lat: number; lng: number } | null {
  if (points.length === 0) return null;
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  return { lat: round(lat, 4), lng: round(lng, 4) };
}

/**
 * 把经纬度换算为以台阵中心为原点的局部平面坐标（km），
 * 供几何视图 SVG 绘制使用（等距圆柱投影近似）。
 */
export function toLocalPlane(
  points: GeoPoint[],
  center: { lat: number; lng: number }
): Array<GeoPoint & { x: number; y: number }> {
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(toRadians(center.lat));
  return points.map((point) => ({
    ...point,
    x: round((point.lng - center.lng) * kmPerDegLng, 3),
    y: round((point.lat - center.lat) * kmPerDegLat, 3),
  }));
}

/** 由几何视图坐标反推 SVG 视口尺寸（含留白） */
export function planeViewBox(
  plane: Array<{ x: number; y: number }>,
  paddingKm = 2
): { minX: number; minY: number; width: number; height: number } {
  if (plane.length === 0) {
    return { minX: -paddingKm, minY: -paddingKm, width: paddingKm * 2, height: paddingKm * 2 };
  }
  const xs = plane.map((point) => point.x);
  const ys = plane.map((point) => point.y);
  const minX = Math.min(...xs) - paddingKm;
  const maxX = Math.max(...xs) + paddingKm;
  const minY = Math.min(...ys) - paddingKm;
  const maxY = Math.max(...ys) + paddingKm;
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

/** 方位角（度，正北为 0、顺时针增大），用于几何视图标注 */
export function bearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return round((bearing + 360) % 360, 1);
}
