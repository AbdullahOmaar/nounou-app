import { describe, expect, it } from 'vitest'
import { MAX_PHOTO_BYTES, MAX_PHOTO_SIDE, targetSize } from './photoUtils'

describe('targetSize (W3)', () => {
  it('scales a landscape phone photo down to the max side', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 1280, height: 960 })
  })

  it('scales a portrait photo down to the max side', () => {
    expect(targetSize(3024, 4032)).toEqual({ width: 960, height: 1280 })
  })

  it('never upscales a small image', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('keeps an exactly-max image unchanged', () => {
    expect(targetSize(MAX_PHOTO_SIDE, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('honours a custom max side', () => {
    expect(targetSize(2000, 1000, 500)).toEqual({ width: 500, height: 250 })
  })
})

describe('photo caps (W3)', () => {
  it('the file cap is 8MB', () => {
    expect(MAX_PHOTO_BYTES).toBe(8 * 1024 * 1024)
  })
})
