import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTimeAr } from '../../lib/format'
import { logActivityAuto } from './api'

interface DataRequestRow {
  id: string
  kind: 'export' | 'deletion'
  status: 'pending' | 'done' | 'rejected'
  created_at: string
  guardians: { full_name: string } | null
}

/**
 * طلبات حقوق البيانات (4.13 — قانون 151/2020): طلبات التصدير
 * والحذف الواردة من بوابات أولياء الأمور. التعامل قرار بشري:
 * «تم» بعد التنفيذ الفعلي خارج النظام أو داخله، والحذف لا ينفذ
 * تلقائياً أبداً (docs/DATA-PROTECTION.md).
 */
export function DataRequestsCard({ nurseryId }: { nurseryId: string }) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const requests = useQuery({
    queryKey: ['data-requests', nurseryId],
    queryFn: async (): Promise<DataRequestRow[]> => {
      const db = requireSupabase()
      const { data, error } = await db
        .from('data_requests')
        .select('id, kind, status, created_at, guardians(full_name)')
        .eq('nursery_id', nurseryId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as unknown as DataRequestRow[]
    },
  })

  async function handle(row: DataRequestRow, status: 'done' | 'rejected') {
    try {
      const db = requireSupabase()
      const { data: userData } = await db.auth.getUser()
      const { error } = await db
        .from('data_requests')
        .update({
          status,
          handled_by: userData.user?.id ?? null,
          handled_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (error) throw error
      await logActivityAuto(
        nurseryId,
        'data_request_handled',
        `data request ${row.kind} -> ${status}`,
      )
      void qc.invalidateQueries({ queryKey: ['data-requests', nurseryId] })
    } catch {
      showToast(t('common.errorGeneric'), 'error')
    }
  }

  const pending = (requests.data ?? []).filter((r) => r.status === 'pending')
  if (!requests.isPending && pending.length === 0) return null

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="type-section flex items-center gap-2">
        <ShieldCheck size={18} />
        {t('dataRights.cardTitle')}
      </h2>
      {pending.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2">
          <span className="type-body">
            {r.guardians?.full_name ?? '—'} —{' '}
            {r.kind === 'export' ? t('dataRights.export') : t('dataRights.deletion')}
            <span className="type-secondary text-muted block">
              {formatDateTimeAr(r.created_at)}
            </span>
          </span>
          <span className="flex gap-1">
            <Button size="sm" onClick={() => void handle(r, 'done')}>
              {t('dataRights.done')}
            </Button>
            <Button size="sm" variant="soft" onClick={() => void handle(r, 'rejected')}>
              {t('dataRights.reject')}
            </Button>
          </span>
        </div>
      ))}
    </Card>
  )
}
