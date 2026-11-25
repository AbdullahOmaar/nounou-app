import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Field, TextInput } from '../../components/ui/form'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { formatMoney } from '../../lib/format'
import { logActivityAuto } from '../settings/api'
import * as api from './api'
import type { StaffStatus } from './api'
import type { NurseryMemberRow } from '../../types/database'

const STATUSES: StaffStatus[] = ['present', 'absent', 'late', 'leave']

function memberLabel(m: NurseryMemberRow): string {
  return m.invited_email ?? m.user_id ?? m.id
}

export function StaffPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const showToast = useToast()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [period, setPeriod] = useState(today.slice(0, 7))
  const [salaryDrafts, setSalaryDrafts] = useState<Record<string, string>>({})

  const members = useQuery({
    queryKey: ['staff-members', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listActiveMembers(nurseryId!),
  })
  const profiles = useQuery({
    queryKey: ['staff-profiles', nurseryId],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.listStaffProfiles(nurseryId!),
  })
  const attendance = useQuery({
    queryKey: ['staff-attendance', nurseryId, today],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listStaffAttendance(nurseryId!, today),
  })
  const payroll = useQuery({
    queryKey: ['staff-payroll', nurseryId, period],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.listStaffPayroll(nurseryId!, period),
  })

  const profileByMember = useMemo(
    () => new Map((profiles.data ?? []).map((p) => [p.member_id, p])),
    [profiles.data],
  )
  const statusByMember = useMemo(
    () => new Map((attendance.data ?? []).map((a) => [a.member_id, a.status])),
    [attendance.data],
  )
  const paidByMember = useMemo(
    () => new Map((payroll.data ?? []).map((p) => [p.member_id, p])),
    [payroll.data],
  )

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['staff-profiles', nurseryId] })
    void qc.invalidateQueries({ queryKey: ['staff-attendance', nurseryId] })
    void qc.invalidateQueries({ queryKey: ['staff-payroll', nurseryId] })
  }

  if (!nurseryId) return <LoadingState />
  if (members.isPending) return <LoadingState />
  if (members.isError)
    return <ErrorState message={t('common.errorGeneric')} onRetry={() => void members.refetch()} />

  const statusLabel = (s: StaffStatus): string =>
    s === 'present'
      ? t('staff.present')
      : s === 'absent'
        ? t('staff.absent')
        : s === 'late'
          ? t('staff.late')
          : t('staff.leave')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="type-title flex items-center gap-2">
        <Wallet size={22} />
        {t('staff.title')}
      </h1>

      {(members.data ?? []).length === 0 ? (
        <EmptyState title={t('staff.empty')} />
      ) : (
        (members.data ?? []).map((m) => {
          const profile = profileByMember.get(m.id)
          const paid = paidByMember.get(m.id)
          const status = statusByMember.get(m.id)
          return (
            <Card key={m.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="type-body font-semibold">{memberLabel(m)}</span>
                {paid && (
                  <span className="type-badge text-good-text bg-good-soft rounded-full px-2 py-1">
                    {t('staff.paidBadge', { amount: formatMoney(paid.amount) })}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={status === s ? 'primary' : 'soft'}
                    onClick={async () => {
                      try {
                        await api.setStaffAttendance(nurseryId, m.id, today, s)
                        refresh()
                      } catch {
                        showToast(t('common.errorGeneric'), 'error')
                      }
                    }}
                  >
                    {statusLabel(s)}
                  </Button>
                ))}
              </div>

              {isOwner && (
                <div className="flex items-end gap-2">
                  <Field label={t('staff.salary')}>
                    <TextInput
                      type="number"
                      min="0"
                      value={salaryDrafts[m.id] ?? String(profile?.monthly_salary ?? '')}
                      onChange={(e) =>
                        setSalaryDrafts((d) => ({ ...d, [m.id]: e.target.value }))
                      }
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={async () => {
                      const value = Number(salaryDrafts[m.id] ?? profile?.monthly_salary ?? 0)
                      if (!Number.isFinite(value) || value < 0) {
                        showToast(t('common.errorGeneric'), 'error')
                        return
                      }
                      try {
                        await api.upsertStaffProfile(
                          nurseryId,
                          m.id,
                          value,
                          profile?.job_title ?? null,
                        )
                        showToast(t('common.savedOk'))
                        refresh()
                      } catch {
                        showToast(t('common.errorGeneric'), 'error')
                      }
                    }}
                  >
                    {t('common.save')}
                  </Button>
                  {!paid && profile && profile.monthly_salary > 0 && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const amount = await api.payStaffSalary(nurseryId, m.id, period)
                          await logActivityAuto(
                            nurseryId,
                            'salary_paid',
                            `salary ${period} — ${memberLabel(m)} — ${amount}`,
                          )
                          showToast(t('staff.paidOk', { amount: formatMoney(amount) }))
                          refresh()
                        } catch (err) {
                          showToast(
                            err instanceof Error && err.message.includes('already_paid')
                              ? t('staff.alreadyPaid')
                              : t('common.errorGeneric'),
                            'error',
                          )
                        }
                      }}
                    >
                      {t('staff.pay')}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )
        })
      )}

      {isOwner && (
        <Field label={t('staff.period')}>
          <TextInput
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
      )}
      <p className="type-secondary text-muted">{t('staff.ruleNote')}</p>
    </div>
  )
}
