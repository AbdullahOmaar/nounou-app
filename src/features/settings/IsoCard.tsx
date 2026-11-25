import { useState } from 'react'
import { Award } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { requireSupabase } from '../../lib/supabase'
import { openPrintDocument, type PrintSection } from '../../lib/printDoc'

/**
 * ملف جاهزية ISO 9001 (مهمة 4.10): خريطة بنود الجودة إلى الأدلة
 * التي يوثقها نونو تلقائياً أثناء التشغيل اليومي. الصياغة دائماً
 * «جاهزية» لا «شهادة» — الاعتماد قرار جهة منح خارجية، ودور نونو
 * أن تكون الأدلة موجودة ومنظمة (docs/ISO-READINESS.md).
 */
export function IsoCard({
  nurseryId,
  nurseryName,
  logoUrl,
  brandColor,
}: {
  nurseryId: string
  nurseryName: string
  logoUrl: string | null
  brandColor: string | null
}) {
  const t = useT()
  const showToast = useToast()
  const [busy, setBusy] = useState(false)

  async function printFile() {
    setBusy(true)
    try {
      const db = requireSupabase()
      const [actRes, repRes, attRes, msgRes] = await Promise.all([
        db
          .from('activity_log')
          .select('id', { count: 'exact', head: true })
          .eq('nursery_id', nurseryId),
        db
          .from('daily_reports')
          .select('id', { count: 'exact', head: true })
          .eq('nursery_id', nurseryId)
          .not('published_at', 'is', null),
        db
          .from('attendance')
          .select('id', { count: 'exact', head: true })
          .eq('nursery_id', nurseryId),
        db
          .from('portal_messages')
          .select('id', { count: 'exact', head: true })
          .eq('nursery_id', nurseryId),
      ])
      const documented = t('iso.documented')
      const partial = t('iso.partial')
      const sections: PrintSection[] = [
        { type: 'text', text: t('iso.mapTitle') },
        {
          type: 'table',
          head: [t('iso.colClause'), t('iso.colEvidence'), t('iso.colStatus')],
          rows: [
            [t('iso.c4'), t('iso.e4'), documented],
            [t('iso.c5'), t('iso.e5'), partial],
            [t('iso.c6'), t('iso.e6'), partial],
            [
              t('iso.c7'),
              t('iso.e7', { count: actRes.count ?? 0 }),
              documented,
            ],
            [
              t('iso.c8'),
              t('iso.e8', {
                reports: repRes.count ?? 0,
                attendance: attRes.count ?? 0,
              }),
              documented,
            ],
            [t('iso.c9'), t('iso.e9', { count: msgRes.count ?? 0 }), partial],
            [t('iso.c10'), t('iso.e10'), partial],
          ],
        },
        { type: 'text', text: `${t('iso.noteTitle')}: ${t('iso.note')}` },
      ]
      const ok = openPrintDocument({
        title: t('iso.title'),
        nurseryName,
        logoUrl,
        brandColor,
        sections,
        footerNote: t('iso.footer'),
      })
      if (!ok) showToast(t('common.errorGeneric'), 'error')
    } catch {
      showToast(t('common.errorGeneric'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="type-section flex items-center gap-2">
        <Award size={18} />
        {t('iso.cardTitle')}
      </h2>
      <p className="type-secondary text-muted">{t('iso.cardBody')}</p>
      <Button onClick={() => void printFile()} disabled={busy}>
        {t('iso.print')}
      </Button>
    </Card>
  )
}
