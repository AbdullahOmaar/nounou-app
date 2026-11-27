import { describe, expect, it } from 'vitest'
import {
  BUS_LIVE_STALE_MS,
  isBusLiveStale,
  osmTileFor,
  osmTileGrid,
} from './busLive'

describe('isBusLiveStale', () => {
  const now = Date.parse('2026-11-27T10:00:00Z')
  it('fresh within 60s', () => {
    expect(isBusLiveStale('2026-11-27T10:00:30Z', now + 30_000)).toBe(false)
  })
  it('stale past 60s', () => {
    expect(isBusLiveStale('2026-11-27T10:00:00Z', now + 61_000)).toBe(true)
  })
  it('boundary at exactly 60s is still fresh', () => {
    expect(isBusLiveStale('2026-11-27T10:00:00Z', now + BUS_LIVE_STALE_MS)).toBe(
      false,
    )
  })
  it('missing timestamp is stale', () => {
    expect(isBusLiveStale(null, now)).toBe(true)
    expect(isBusLiveStale(undefined, now)).toBe(true)
  })
})

describe('osmTileFor', () => {
  it('Cairo at zoom 16 lands inside one tile with a valid URL', () => {
    const t = osmTileFor(30.0444, 31.2357, 16)
    expect(t.zoom).toBe(16)
    expect(t.x).toBeGreaterThanOrEqual(0)
    expect(t.y).toBeGreaterThanOrEqual(0)
    expect(t.px).toBeGreaterThanOrEqual(0)
    expect(t.px).toBeLessThan(256)
    expect(t.py).toBeGreaterThanOrEqual(0)
    expect(t.py).toBeLessThan(256)
    expect(t.url).toBe(
      `https://tile.openstreetmap.org/16/${t.x}/${t.y}.png`,
    )
  })
  it('the equator/prime-meridian corner is tile (32768, 32768) at zoom 16', () => {
    const t = osmTileFor(0, 0, 16)
    expect(t.x).toBe(32768)
    expect(t.y).toBe(32768)
  })
})

describe('osmTileGrid', () => {
  it('returns 9 tiles around the center tile', () => {
    const { center, tiles } = osmTileGrid(30.0444, 31.2357, 16)
    expect(tiles).toHaveLength(9)
    const middle = tiles.find((t) => t.dx === 0 && t.dy === 0)
    expect(middle?.url).toBe(center.url)
    const offsets = tiles.map((t) => `${t.dx}/${t.dy}`).sort()
    expect(offsets).toEqual(
      ['-1/-1', '-1/0', '-1/1', '0/-1', '0/0', '0/1', '1/-1', '1/0', '1/1'].sort(),
    )
    for (const t of tiles) {
      expect(t.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/)
    }
  })
})
