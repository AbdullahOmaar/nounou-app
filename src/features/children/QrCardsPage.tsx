import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Chip, ChipRow } from '../../components/ui/form'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { useClasses } from '../classes/hooks'
import { useChildren } from './hooks'

/**
 * 420-S1: بطاقات QR قابلة للطباعة — كل بطاقة تحمل اسم الطفل وفصله وQR
 * لكوده العام (public_code) الذي يقرأه ماسح الحضور أصلاً. الطباعة على
 * A4 بشبكة بطاقات تُقصّ، وCSS الطباعة يخفي كل واجهة التطبيق.
 */
export function QrCardsPage() {
  const t = useT()
  const classes = useClasses()
  const children = useChildren()
  const [classId, setClassId] = useState('')
  const [qrUrls, setQrUrls] = useState<Map<string, string>>(new Map())

  const activeClassId = classId || classes.data?.[0]?.id || ''
  const classChildren = useMemo(
    () =>
      (children.data ?? []).filter(
        (c) => c.classId === activeClassId && !c.archived_at,
      ),
    [children.data, activeClassId],
  )
  const activeClass = (classes.data ?? []).find((c) => c.id === activeClassId)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        classChildren.map(async (c) => {
          try {
            const url = await QRCode.toDataURL(c.public_code, {
              width: 240,
              margin: 1,
            })
            return [c.id, url] as const
          } catch {
            return [c.id, ''] as const
          }
        }),
      )
      if (!cancelled) setQrUrls(new Map(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [classChildren])

  if (classes.isPending || children.isPending) return <LoadingState />
  if (classes.isError || children.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => {
          void classes.refetch()
          void children.refetch()
        }}
      />
    )

  return (
    <div className="flex flex-col gap-3">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .qr-print-area, .qr-print-area * { visibility: visible; }
          .qr-print-area { position: absolute; inset: 0; padding: 8mm; }
          .qr-card { break-inside: avoid; border: 1px dashed #999 !important; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>
      <div className="no-print flex flex-col gap-3">
        <h1 className="type-title">{t('children.qr.title')}</h1>
        <p className="type-secondary text-muted">{t('children.qr.hint')}</p>
        <ChipRow>
          {(classes.data ?? []).map((c) => (
            <Chip
              key={c.id}
              active={c.id === activeClassId}
              onClick={() => setClassId(c.id)}
            >
              {c.name}
            </Chip>
          ))}
        </ChipRow>
        {classChildren.length > 0 && (
          <Button onClick={() => window.print()}>
            <Printer size={18} />
            {t('children.qr.print')}
          </Button>
        )}
      </div>
      {classChildren.length === 0 ? (
        <EmptyState title={t('children.qr.empty')} />
      ) : (
        <div className="qr-print-area grid grid-cols-2 sm:grid-cols-3 gap-3">
          {classChildren.map((c) => (
            <div
              key={c.id}
              className="qr-card bg-card border border-border rounded-2xl p-3 flex flex-col items-center gap-1 text-center"
            >
              <div className="type-body">{c.full_name}</div>
              <div className="type-badge text-muted">{activeClass?.name ?? ''}</div>
              {qrUrls.get(c.id) ? (
                <img
                  src={qrUrls.get(c.id)}
                  alt={c.public_code}
                  className="w-28 h-28"
                />
              ) : (
                <div className="w-28 h-28 bg-soft rounded-lg" />
              )}
              <div className="type-badge text-muted" dir="ltr">
                {c.public_code}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
