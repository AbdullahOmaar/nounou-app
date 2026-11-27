import { useState } from 'react'
import { FileCheck2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { requireSupabase } from '../../lib/supabase'
import { openPrintDocument, type PrintSection } from '../../lib/printDoc'
import { getPublicPageSettings } from './api'

/**
 * ملف جاهزية الترخيص (4.11 — بند 673): مستند واحد قابل للطباعة
 * بمحرك 4.16 يجمع بيانات الحضانة الحية + قائمة متطلبات إرشادية.
 * الصياغة دائماً «جاهزية» لا «شهادة»، والقائمة إرشادية — التأكيد
 * النهائي من مديرية التضامن الاجتماعي المختصة (docs/LICENSING.md).
 */
export function LicensingCard({
  nurseryId,
  nurseryName,
  logoUrl,
  brandColor,
  address,
  phone,
}: {
  nurseryId: string
  nurseryName: string
  logoUrl: string | null
  brandColor: string | null
  address: string | null
  phone: string | null
}) {
  const t = useT()
  const showToast = useToast()
  const [busy, setBusy] = useState(false)

  async function printFile() {
    setBusy(true)
    try {
      const db = requireSupabase()
      const [pub, classesRes, childrenRes, membersRes] = await Promise.all([
        getPublicPageSettings(nurseryId),
        db
          .from('classes')
          .select('name, capacity')
          .eq('nursery_id', nurseryId)
          .order('name'),
        db
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('nursery_id', nurseryId)
          .eq('status', 'active'),
        db
          .from('nursery_members')
          .select('id', { count: 'exact', head: true })
          .eq('nursery_id', nurseryId)
          .eq('status', 'active'),
      ])
      const classes = (classesRes.data ?? []) as {
        name: string
        capacity: number | null
      }[]
      const totalCapacity = classes.reduce((s, c) => s + (c.capacity ?? 0), 0)
      const licenseNo = pub?.public_license_no ?? null
      const yes = t('licensing.statusReady')
      const no = t('licensing.statusMissing')
      const paper = t('licensing.statusPaper')
      const sections: PrintSection[] = [
        {
          type: 'kv',
          rows: [
            { label: t('licensing.nursery'), value: nurseryName },
            { label: t('licensing.licenseNo'), value: licenseNo ?? no },
            { label: t('licensing.address'), value: address ?? no },
            { label: t('licensing.phone'), value: phone ?? no },
            { label: t('licensing.classes'), value: String(classes.length) },
            {
              label: t('licensing.capacity'),
              value: totalCapacity > 0 ? String(totalCapacity) : no,
            },
            {
              label: t('licensing.children'),
              value: String(childrenRes.count ?? 0),
            },
            {
              label: t('licensing.staff'),
              value: String(membersRes.count ?? 0),
            },
          ],
        },
        {
          type: 'table',
          head: [t('licensing.reqCol'), t('licensing.statusCol')],
          rows: [
            [t('licensing.reqLicense'), licenseNo ? yes : no],
            [t('licensing.reqClasses'), classes.length > 0 ? yes : no],
            [t('licensing.reqContact'), address && phone ? yes : no],
            [t('licensing.reqCommercial'), paper],
            [t('licensing.reqTax'), paper],
            [t('licensing.reqLease'), paper],
            [t('licensing.reqCivil'), paper],
            [t('licensing.reqHealth'), paper],
            [t('licensing.reqStaffIds'), paper],
            [t('licensing.reqSafety'), paper],
          ],
        },
        { type: 'text', text: t('licensing.disclaimer') },
      ]
      const opened = openPrintDocument({
        nurseryName,
        logoUrl,
        brandColor,
        title: t('licensing.title'),
        sections,
        footerNote: t('pub.poweredBy'),
      })
      if (!opened) showToast(t('common.errorGeneric'), 'error')
    } catch {
      showToast(t('common.errorGeneric'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <FileCheck2 size={18} />
        <span className="type-section">{t('licensing.cardTitle')}</span>
      </div>
      <p className="type-secondary text-muted">{t('licensing.cardHint')}</p>
      <Button variant="soft" disabled={busy} onClick={() => void printFile()}>
        {t('licensing.print')}
      </Button>
    </Card>
  )
}
