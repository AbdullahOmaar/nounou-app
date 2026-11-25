import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, TextInput } from '../../components/ui/form'
import { LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useT } from '../../i18n'
import { requireSupabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { setActiveNurseryId } from '../../lib/workspace'
import { createNursery } from '../auth/api'

interface BranchStat {
  children: number
  outstanding: number | null
}

async function fetchStats(
  ids: string[],
  ownerIds: string[],
): Promise<Record<string, BranchStat>> {
  const db = requireSupabase()
  const out: Record<string, BranchStat> = {}
  for (const id of ids) out[id] = { children: 0, outstanding: null }
  const { data: kids, error } = await db
    .from('children')
    .select('nursery_id')
    .in('nursery_id', ids)
    .is('archived_at', null)
  if (error) throw error
  for (const r of (kids ?? []) as { nursery_id: string }[]) {
    out[r.nursery_id].children += 1
  }
  if (ownerIds.length > 0) {
    const { data: bals, error: bErr } = await db
      .from('child_balances')
      .select('nursery_id, balance')
      .in('nursery_id', ownerIds)
      .gt('balance', 0)
    if (bErr) throw bErr
    for (const id of ownerIds) out[id].outstanding = 0
    for (const r of (bals ?? []) as {
      nursery_id: string
      balance: number | string
    }[]) {
      out[r.nursery_id].outstanding =
        (out[r.nursery_id].outstanding ?? 0) + Number(r.balance)
    }
  }
  return out
}

/**
 * إدارة الفروع (4.19): مشغّل واحد، عدة حضانات — قائمة
 * عضوياتي بعدّادات سريعة + تبديل فوري + إضافة فرع جديد.
 * الدمج المالي عبر الفروع (HQ) فيز لاحقة بحكم دراسة السوق؛
 * مدير فرع لا يرى فروعاً شقيقة إلا بعضويته فيها.
 */
export function BranchesPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const nursery = useCurrentNursery()
  const [newName, setNewName] = useState('')

  const memberships =
    nursery.status === 'ready' ? nursery.memberships : []
  const activeId = nursery.status === 'ready' ? nursery.nurseryId : null
  const ids = memberships.map((m) => m.nursery_id)
  const ownerIds = memberships
    .filter((m) => m.role === 'owner')
    .map((m) => m.nursery_id)

  const stats = useQuery({
    queryKey: ['branch-stats', ids.join(',')],
    queryFn: () => fetchStats(ids, ownerIds),
    enabled: ids.length > 0,
  })

  const create = useMutation({
    mutationFn: () => createNursery(newName.trim()),
    onSuccess: (id) => {
      setActiveNurseryId(id)
      toast(t('common.savedOk'))
      void qc.invalidateQueries()
      navigate('/')
    },
    onError: () => toast(t('common.errorGeneric')),
  })

  if (nursery.status !== 'ready') return <LoadingState />

  return (
    <div className="space-y-3">
      {memberships.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('branches.empty')}
          hint={t('branches.emptyHint')}
        />
      ) : (
        memberships.map((m) => {
          const s = stats.data?.[m.nursery_id]
          const isActive = m.nursery_id === activeId
          return (
            <Card
              key={m.id}
              className="cursor-pointer space-y-1"
              onClick={() => {
                if (!isActive) {
                  setActiveNurseryId(m.nursery_id)
                  navigate('/')
                }
              }}
            >
              <p className="flex items-center gap-2 font-bold">
                <Building2 size={18} />
                {m.nursery.name}
                {isActive && <Check size={16} />}
              </p>
              <p className="text-sm text-muted">
                {m.role === 'owner'
                  ? t('branches.roleOwner')
                  : t('branches.roleStaff')}
                {' · '}
                {t('branches.children')}: {s?.children ?? '…'}
                {s?.outstanding !== null && s?.outstanding !== undefined
                  ? ` · ${t('branches.outstanding')}: ${formatMoney(s.outstanding)}`
                  : ''}
              </p>
            </Card>
          )
        })
      )}

      <Card className="space-y-2">
        <p className="font-bold">{t('branches.addTitle')}</p>
        <Field label={t('branches.nameLabel')}>
          <TextInput
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('branches.namePlaceholder')}
          />
        </Field>
        <Button
          onClick={() => create.mutate()}
          disabled={newName.trim().length < 2 || create.isPending}
        >
          <Plus size={18} /> {t('branches.add')}
        </Button>
      </Card>
    </div>
  )
}
