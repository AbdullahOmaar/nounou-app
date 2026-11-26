import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Fab } from '../../components/ui/Fab'
import { useT } from '../../i18n'
import { formatMoney, todayISO } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import {
  useClasses,
  useClassesStaffNames,
  useClassesToday,
  useClassMutations,
} from './hooks'
import { ClassFormSheet } from './ClassFormSheet'

/**
 * الفصول — بطاقة لكل فصل (موجة الهوية 2، موك أب 14): المشرفة والعدد
 * وحالة اليوم بعدّاداته + زرّا «حضور اليوم/تفاصيل الفصل» جنب بعض،
 * والإضافة بزر عائم واحد. حالة اليوم قراءة فقط من جداول الحضور.
 */
export function ClassesPage() {
  const t = useT()
  const navigate = useNavigate()
  const nursery = useCurrentNursery()
  const canManage =
    nursery.status === 'ready' && nursery.can('can_manage_classes')
  const classes = useClasses()
  const today = useClassesToday(todayISO())
  const staffNames = useClassesStaffNames(
    (classes.data ?? []).map((c) => c.id),
  )
  const mutations = useClassMutations()
  const [formOpen, setFormOpen] = useState(false)

  if (classes.isPending) return <LoadingState />
  if (classes.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void classes.refetch()}
      />
    )
  const list = classes.data ?? []

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <EmptyState title={t('classes.emptyTitle')} hint={t('classes.emptyBody')} />
      ) : (
        list.map((c) => {
          const status = today.data?.get(c.id)
          const opened = status?.opened ?? false
          const present = status?.present ?? 0
          const absent = status?.absent ?? 0
          const notYet = Math.max(0, c.childrenCount - present - absent)
          const staff = staffNames.data?.get(c.id) ?? []
          return (
            <Card key={c.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="type-title truncate">{c.name}</div>
                {today.data &&
                  (opened ? (
                    <span className="type-badge shrink-0 rounded-full bg-ok-soft text-ok-text px-2 py-1">
                      {t('classes.openedChip')}
                    </span>
                  ) : (
                    <span className="type-badge shrink-0 rounded-full bg-soft text-muted px-2 py-1">
                      {t('classes.notOpenedChip')}
                    </span>
                  ))}
              </div>
              <div className="type-secondary text-muted mt-1">
                {[
                  ...staff,
                  t('format.childCount', { count: c.childrenCount }) +
                    (c.capacity ? ` / ${c.capacity}` : ''),
                  c.age_from != null && c.age_to != null
                    ? t('classes.ageRange', { from: c.age_from, to: c.age_to })
                    : '',
                  formatMoney(c.monthly_fee),
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </div>

              {today.data &&
                (opened ? (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-surface rounded-xl py-2 text-center">
                      <div className="type-section text-ok-text">{present}</div>
                      <div className="type-badge text-muted">
                        {t('attendance.present')}
                      </div>
                    </div>
                    <div className="bg-surface rounded-xl py-2 text-center">
                      <div className="type-section text-bad-text">{absent}</div>
                      <div className="type-badge text-muted">
                        {t('attendance.absent')}
                      </div>
                    </div>
                    <div className="bg-surface rounded-xl py-2 text-center">
                      <div className="type-section">{notYet}</div>
                      <div className="type-badge text-muted">
                        {t('attendance.notYetArrived')}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="bg-surface rounded-xl py-2 text-center">
                      <div className="type-section">—</div>
                      <div className="type-badge text-muted">
                        {t('classes.notStarted')}
                      </div>
                    </div>
                    <div className="bg-surface rounded-xl py-2 text-center">
                      <div className="type-section">{c.childrenCount}</div>
                      <div className="type-badge text-muted">
                        {t('classes.childrenCount')}
                      </div>
                    </div>
                  </div>
                ))}

              <div className="flex gap-2 mt-3">
                <Button
                  className="flex-1"
                  variant={opened ? 'primary' : 'accent'}
                  onClick={() => navigate(`/today/${c.id}`)}
                >
                  {opened
                    ? t('classes.openAttendance')
                    : t('classes.startDay')}
                </Button>
                <Button
                  className="flex-1"
                  variant="ghost"
                  onClick={() => navigate(`/classes/${c.id}`)}
                >
                  {t('classes.details')}
                </Button>
              </div>
            </Card>
          )
        })
      )}
      {canManage && (
        <>
          <Fab
            label={t('classes.addClass')}
            ariaLabel={t('classes.addClass')}
            onClick={() => setFormOpen(true)}
          />
          <ClassFormSheet
            open={formOpen}
            onClose={() => setFormOpen(false)}
            onSubmit={async (input) => {
              await mutations.create.mutateAsync(input)
            }}
          />
        </>
      )}
    </div>
  )
}
