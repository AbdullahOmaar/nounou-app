import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Fab } from '../../components/ui/Fab'
import { useT } from '../../i18n'
import { formatMoney } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useClasses, useClassMutations } from './hooks'
import { ClassFormSheet } from './ClassFormSheet'

/** الفصول وباقاتها — بطاقة لكل فصل بعدد أطفاله وباقته */
export function ClassesPage() {
  const t = useT()
  const navigate = useNavigate()
  const nursery = useCurrentNursery()
  const canManage =
    nursery.status === 'ready' && nursery.can('can_manage_classes')
  const classes = useClasses()
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
    <div className="flex flex-col gap-2">
      {list.length === 0 ? (
        <EmptyState title={t('classes.emptyTitle')} hint={t('classes.emptyBody')} />
      ) : (
        list.map((c) => (
          <Card
            key={c.id}
            className="cursor-pointer"
            onClick={() => navigate(`/classes/${c.id}`)}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="type-section">{c.name}</div>
                <div className="type-badge text-muted">
                  {c.age_from != null && c.age_to != null
                    ? `${t('classes.ageRange', { from: c.age_from, to: c.age_to })} • `
                    : ''}
                  {t('format.childCount', { count: c.childrenCount })}
                  {c.capacity ? ` / ${c.capacity}` : ''}
                </div>
              </div>
              <span className="type-body font-semibold">
                {formatMoney(c.monthly_fee)}
              </span>
            </div>
          </Card>
        ))
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
