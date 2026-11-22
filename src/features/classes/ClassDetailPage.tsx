import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow } from '../../components/ui/form'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { formatMoney, todayISO } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useChildren } from '../children/hooks'
import { useClasses, useClassMutations, useClassStaff } from './hooks'
import { ClassFormSheet } from './ClassFormSheet'
import type { ClassRow } from '../../types/database'

/** ملف الفصل: بياناته وباقته ومشرفاته وأطفاله + فتح يوم النهارده */
export function ClassDetailPage() {
  const t = useT()
  const { classId } = useParams()
  const navigate = useNavigate()
  const nursery = useCurrentNursery()
  const canManage =
    nursery.status === 'ready' && nursery.can('can_manage_classes')
  const classes = useClasses()
  const children = useChildren()
  const staff = useClassStaff(classId)
  const mutations = useClassMutations()
  const [editOpen, setEditOpen] = useState(false)

  const classRow: ClassRow | undefined = (classes.data ?? []).find(
    (c) => c.id === classId,
  )
  if (classes.isPending) return <LoadingState />
  if (classes.isError || !classRow)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void classes.refetch()}
      />
    )
  const classChildren = (children.data ?? []).filter((c) => c.classId === classId)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <div className="type-title">{classRow.name}</div>
            <div className="type-secondary text-muted">
              {t('classes.monthlyFee')}: {formatMoney(classRow.monthly_fee)}
              {classRow.capacity ? ` • ${t('classes.capacity')}: ${classRow.capacity}` : ''}
              {classRow.age_from != null && classRow.age_to != null
                ? ` • ${t('classes.ageRange', { from: classRow.age_from, to: classRow.age_to })}`
                : ''}
            </div>
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              {t('common.edit')}
            </Button>
          )}
        </div>
        <Button className="mt-3" full onClick={() => navigate(`/today/${classRow.id}`)}>
          {t('classes.openToday')} — {todayISO()}
        </Button>
      </Card>

      <section>
        <h2 className="type-section mb-2">{t('classes.staff')}</h2>
        {staff.isPending ? (
          <LoadingState />
        ) : (
          <ChipRow>
            {(staff.data?.all ?? []).map((m) => {
              const assigned = staff.data?.assigned.has(m.id) ?? false
              return (
                <Chip
                  key={m.id}
                  active={assigned}
                  onClick={() => {
                    if (canManage) {
                      void mutations.setStaff.mutateAsync({
                        classId: classRow.id,
                        memberId: m.id,
                        assigned: !assigned,
                      })
                    }
                  }}
                >
                  {m.display_name || m.invited_email || '—'}
                </Chip>
              )
            })}
          </ChipRow>
        )}
      </section>

      <section>
        <h2 className="type-section mb-2">
          {t('classes.childrenCount')} ({classChildren.length})
        </h2>
        <div className="flex flex-col gap-2">
          {classChildren.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer py-3"
              onClick={() => navigate(`/children/${c.id}`)}
            >
              <span className="type-body">{c.full_name}</span>
            </Card>
          ))}
        </div>
      </section>

      {canManage && (
        <ClassFormSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          initial={classRow}
          onSubmit={async (input) => {
            await mutations.update.mutateAsync({ classId: classRow.id, patch: input })
          }}
        />
      )}
    </div>
  )
}
