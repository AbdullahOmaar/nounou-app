import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capturePortalToken, getStoredPortalToken } from './session'

// جلسة جهاز البوابة (3A-375): التقاط التوكن من الرابط + استرجاعه
// من التخزين + تنظيف شريط العنوان — بلا خادم.
describe('portal device session (3A-375)', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/p/old-token')
    vi.restoreAllMocks()
  })

  it('يلتقط توكن الرابط: يخزنه وينظف شريط العنوان إلى /p ويعيده', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    expect(capturePortalToken('raw-token-1')).toBe('raw-token-1')
    expect(localStorage.getItem('nounou.portalToken')).toBe('raw-token-1')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/p')
    expect(window.location.pathname).toBe('/p')
  })

  it('بلا توكن في الرابط: يرجع المخزن', () => {
    localStorage.setItem('nounou.portalToken', 'stored-token')
    expect(capturePortalToken(undefined)).toBe('stored-token')
  })

  it('بلا توكن في الرابط ولا مخزن: null', () => {
    expect(capturePortalToken(undefined)).toBeNull()
    expect(getStoredPortalToken()).toBeNull()
  })

  it('توكن رابط جديد يستبدل المخزن القديم', () => {
    localStorage.setItem('nounou.portalToken', 'old-token')
    expect(capturePortalToken('new-token')).toBe('new-token')
    expect(localStorage.getItem('nounou.portalToken')).toBe('new-token')
  })
})
