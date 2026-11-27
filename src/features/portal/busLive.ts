/**
 * تتبع الباص الحي في بوابة ولي الأمر (3A-414).
 * الخريطة بلاطة OSM واحدة متمركزة على موقع الباص (بلا اعتماد جديد —
 * قرار توثيق §9: Leaflet غير لازمة لعرض نقطة واحدة ثابتة المركز).
 */

/** أقدم من هذا = الإشارة قديمة، ولا تُعرض كحية أبداً (مواصفة R&D للباص) */
export const BUS_LIVE_STALE_MS = 60_000

export interface PortalBusLive {
  found: boolean
  route_name?: string
  direction?: string
  started_at?: string
  lat?: number | null
  lng?: number | null
  loc_at?: string | null
}

export function isBusLiveStale(
  locAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!locAt) return true
  const t = Date.parse(locAt)
  if (Number.isNaN(t)) return true
  return nowMs - t > BUS_LIVE_STALE_MS
}

export interface OsmTile {
  zoom: number
  x: number
  y: number
  /** إزاحة البكسل داخل البلاطة (0–255) */
  px: number
  py: number
  url: string
}

/** صيغة خريطة slippy القياسية: بلاطة OSM التي تحوي الإحداثية + موقعها فيها */
export function osmTileFor(lat: number, lng: number, zoom = 16): OsmTile {
  const n = 2 ** zoom
  const xf = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const yf =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const x = Math.floor(xf)
  const y = Math.floor(yf)
  return {
    zoom,
    x,
    y,
    px: (xf - x) * 256,
    py: (yf - y) * 256,
    url: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
  }
}

export interface OsmGridTile {
  /** إزاحة البلاطة عن بلاطة المركز (-1/0/1 في كل محور) */
  dx: number
  dy: number
  url: string
}

/**
 * شبكة 3×3 حول بلاطة المركز: بلاطة واحدة 256px لا تغطي عرض الحاوية
 * (~320px) فيُترك شريط فارغ — الشبكة تغطي الحاوية كلها في كل الأحوال.
 */
export function osmTileGrid(
  lat: number,
  lng: number,
  zoom = 16,
): { center: OsmTile; tiles: OsmGridTile[] } {
  const center = osmTileFor(lat, lng, zoom)
  const n = 2 ** zoom
  const tiles: OsmGridTile[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = (center.x + dx + n) % n
      const y = Math.min(Math.max(center.y + dy, 0), n - 1)
      tiles.push({
        dx,
        dy,
        url: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
      })
    }
  }
  return { center, tiles }
}
