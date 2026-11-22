import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { NotFoundPage } from './NotFoundPage'

afterEach(() => {
  cleanup()
})

describe('NotFoundPage — صفحة 404', () => {
  it('تعرض العنوان وزر الرجوع للرئيسية', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('الصفحة دي مش موجودة')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /ارجع للرئيسية/ }),
    ).toBeInTheDocument()
  })

  it('الوضع المنفرد يلفّ المحتوى في شاشة كاملة', () => {
    const { container } = render(
      <MemoryRouter>
        <NotFoundPage standalone />
      </MemoryRouter>,
    )
    expect(container.querySelector('.min-h-screen')).not.toBeNull()
    expect(screen.getByText('الصفحة دي مش موجودة')).toBeInTheDocument()
  })
})
