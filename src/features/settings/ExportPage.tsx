import { useState } from 'react'
import { Download, FileSpreadsheet, Receipt, Users } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useT } from '../../i18n'
import { toCsv } from '../../lib/csv'
import { formatDateTimeAr } from '../../lib/format'
import { requireSupabase } from '../../lib/supabase'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useNurserySettings } from './hooks'

/**
 * تصدير بيانات الحضانة CSV (أطفال + فواتير + مدفوعات للمالك): ملفات
 * تُبنى على الجهاز من بيانات الاتصال المشفر — حقّ العميل في بياناته.
 */
export function ExportPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const settings = useNurserySettings()

  function download(name: string, csv: string) {
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExport() {
    if (!nurseryId) return
    setBusy(true)
    try {
      const db = requireSupabase()
      const [childrenRes, invoicesRes, paymentsRes] = await Promise.all([
        db
          .from('children')
          .select('full_name, birth_date, gender, public_code, photo_consent, created_at')
          .eq('nursery_id', nurseryId),
        isOwner
          ? db
              .from('invoice_balances')
              .select('child_id, period, total, paid, balance, status')
              .eq('nursery_id', nurseryId)
          : Promise.resolve({ data: [], error: null }),
        isOwner
          ? db
              .from('payments')
              .select('child_id, amount, method, paid_at, receipt_no, proof_status')
              .eq('nursery_id', nurseryId)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (childrenRes.error) throw childrenRes.error
      download(
        'nounou-children.csv',
        toCsv(
          ['name', 'birth_date', 'gender', 'code', 'photo_consent', 'created_at'],
          (childrenRes.data ?? []).map((c) => [
            c.full_name,
            c.birth_date,
            c.gender,
            c.public_code,
            c.photo_consent,
            c.created_at,
          ]),
        ),
      )
      if (isOwner) {
        download(
          'nounou-invoices.csv',
          toCsv(
            ['child_id', 'period', 'total', 'paid', 'balance', 'status'],
            (invoicesRes.data ?? []).map((i) => [
              i.child_id,
              i.period,
              i.total,
              i.paid,
              i.balance,
              i.status,
            ]),
          ),
        )
        download(
          'nounou-payments.csv',
          toCsv(
            ['child_id', 'amount', 'method', 'paid_at', 'receipt_no', 'proof_status'],
            (paymentsRes.data ?? []).map((p) => [
              p.child_id,
              p.amount,
              p.method,
              p.paid_at,
              p.receipt_no,
              p.proof_status,
            ]),
          ),
        )
        await db
          .from('nursery_settings')
          .update({ last_export_at: new Date().toISOString() })
          .eq('nursery_id', nurseryId)
      }
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="type-section">{t('settings.exportTitle')}</h2>
        <p className="type-secondary text-muted">{t('settings.exportBody')}</p>
        <div className="flex flex-col gap-2">
          <div className="type-badge text-muted">{t('settings.exportIncludes')}</div>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-soft text-primary flex items-center justify-center">
              <Users size={18} />
            </span>
            <span className="type-body">{t('settings.exportFileChildren')}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-soft text-primary flex items-center justify-center">
              <Receipt size={18} />
            </span>
            <span className="type-body">{t('settings.exportFileInvoices')}</span>
            {!isOwner && (
              <span className="type-badge text-warn-text bg-warn-soft rounded-full px-2 py-1">
                {t('settings.exportOwnerOnly')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-soft text-primary flex items-center justify-center">
              <FileSpreadsheet size={18} />
            </span>
            <span className="type-body">{t('settings.exportFilePayments')}</span>
            {!isOwner && (
              <span className="type-badge text-warn-text bg-warn-soft rounded-full px-2 py-1">
                {t('settings.exportOwnerOnly')}
              </span>
            )}
          </div>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        {settings.data?.last_export_at && (
          <p className="type-secondary text-muted">
            {t('settings.lastExport', { date: formatDateTimeAr(settings.data.last_export_at) })}
          </p>
        )}
        <Button onClick={handleExport} disabled={busy || !nurseryId} full>
          <Download size={18} />
          {t('settings.exportNow')}
        </Button>
        {done && <p className="type-body text-ok-text">{t('common.savedOk')}</p>}
      </Card>
    </div>
  )
}
