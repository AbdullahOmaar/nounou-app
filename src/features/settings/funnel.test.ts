import { describe, expect, it } from 'vitest'
import { pct, summarizeFunnel } from './api'

describe('summarizeFunnel — تجميع قمع الاكتشاف', () => {
  it('يعدّ المشاهدات والنقرات والجولات والملتحقين فقط', () => {
    const f = summarizeFunnel(
      [
        { kind: 'view' },
        { kind: 'view' },
        { kind: 'whatsapp_click' },
        { kind: 'other' },
      ],
      [
        { status: 'new' },
        { status: 'contacted' },
        { status: 'converted' },
        { status: 'done' },
      ],
    )
    expect(f).toEqual({ views: 2, clicks: 1, tours: 4, converted: 1 })
  })

  it('القوائم الفارغة تعطي أصفاراً', () => {
    expect(summarizeFunnel([], [])).toEqual({
      views: 0,
      clicks: 0,
      tours: 0,
      converted: 0,
    })
  })
})

describe('pct — النسبة المئوية الآمنة', () => {
  it('يحسب ويقرّب لأقرب عدد صحيح', () => {
    expect(pct(1, 4)).toBe(25)
    expect(pct(2, 3)).toBe(67)
  })
  it('أساس صفري أو سالب يعطي صفراً بدل قسمة على صفر', () => {
    expect(pct(5, 0)).toBe(0)
    expect(pct(0, 0)).toBe(0)
  })
})
