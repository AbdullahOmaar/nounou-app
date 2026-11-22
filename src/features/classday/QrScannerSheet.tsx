import { useEffect, useRef } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'

interface Props {
  open: boolean
  onClose: () => void
  onCode: (code: string) => void
}

/**
 * ماسح كارت الطفل (QR) بكاميرا الجهاز — @zxing/browser (نفس مكتبة
 * المدرس). الكود المقروء هو public_code؛ التحقق والبحث عند المستدعي.
 */
export function QrScannerSheet({ open, onClose, onCode }: Props) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (!open) return
    handledRef.current = false
    const reader = new BrowserQRCodeReader()
    let controls: { stop: () => void } | null = null
    let cancelled = false
    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result && !handledRef.current) {
          handledRef.current = true
          onCode(result.getText())
        }
      })
      .then((c) => {
        if (cancelled) c.stop()
        else controls = c
      })
      .catch(() => {
        // كاميرا غير متاحة/مرفوضة: الورقة تبقى مفتوحة برسالتها الإرشادية
      })
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [open, onCode])

  return (
    <Sheet open={open} onClose={onClose} title={t('attendance.scanQr')}>
      <div className="flex flex-col items-center gap-3">
        <video
          ref={videoRef}
          className="w-full max-w-[320px] aspect-square object-cover rounded-2xl bg-black"
          muted
          playsInline
        />
        <p className="type-secondary text-muted">{t('attendance.scanQrHint')}</p>
      </div>
    </Sheet>
  )
}
