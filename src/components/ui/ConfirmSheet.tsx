import { useState } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { useT } from '../../i18n'

/**
 * تأكيد بسيط (نشر/حذف خفيف/عكس دفعة): رسالة + تأكيد/إلغاء — للإجراءات
 * التي لا تستحق نمط «اكتب الاسم» الثقيل في DangerConfirmSheet.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="soft" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="type-body">{body}</p>
    </Sheet>
  )
}
