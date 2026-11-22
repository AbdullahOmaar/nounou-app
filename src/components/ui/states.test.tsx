import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ListLoadingState, PageLoadingOverlay } from './states'
import { EmptyState } from './EmptyState'
import { t } from '../../i18n'

afterEach(() => {
  cleanup()
})

describe('لودر Overlay الموحّد', () => {
  it('طبقة ثابتة فوق منطقة المحتوى فقط + سطر التحميل', () => {
    const { container } = render(<PageLoadingOverlay />)
    const overlay = container.querySelector('[data-loading-overlay]')
    expect(overlay).not.toBeNull()
    expect(overlay!.className).toContain('fixed')
    expect(overlay!.className).toContain('top-[49px]')
    expect(overlay!.className).toContain(
      'bottom-[calc(64px+env(safe-area-inset-bottom,0px))]',
    )
    expect(overlay!.className).not.toContain('inset-0')
    expect(overlay!.className).toContain('bg-bg/30')
    expect(overlay!.className).not.toContain('backdrop-blur')
    expect(screen.getAllByText(t('common.loading')).length).toBeGreaterThan(0)
  })

  it('ListLoadingState: Overlay + هيكل صفوف نابض', () => {
    const { container } = render(<ListLoadingState rows={3} />)
    expect(container.querySelector('[data-loading-overlay]')).not.toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})

describe('EmptyState', () => {
  it('يعرض العنوان والتلميح وزر الإجراء', () => {
    render(
      <EmptyState
        title="فارغ"
        hint="لا عناصر"
        action={{ label: 'أضف', onClick: () => {} }}
      />,
    )
    expect(screen.getByText('فارغ')).toBeInTheDocument()
    expect(screen.getByText('لا عناصر')).toBeInTheDocument()
    expect(screen.getByText('أضف')).toBeInTheDocument()
  })

  it('مع mascot يعرض علامة نونو (SVG) بدل دائرة الأيقونة', () => {
    const { container } = render(<EmptyState mascot title="فارغ" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
