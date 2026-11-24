import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QrCode, Upload } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Fab } from '../../components/ui/Fab'
import { ListRow } from '../../components/ui/ListRow'
import { PageToolBar } from '../../components/ui/PageToolBar'
import { Select } from '../../components/ui/form'
import { useT } from '../../i18n'
import { ageLabel, formatMoney } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useClasses } from '../classes/hooks'
import { useChildren, useChildMutations } from './hooks'
import { ChildFormSheet } from './ChildFormSheet'
import { ChildImportSheet } from './ChildImportSheet'

/** قائمة الأطفال: بحث فوري + تصفية بالفصل + رصيد للمالك + إضافة/استيراد */
export function ChildrenPage() {
  const t = useT()
  const navigate = useNavigate()
  const nursery = useCurrentNursery()
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const canManage = nursery.status === 'ready' && nursery.can('can_manage_children')
  const children = useChildren()
  const classes = useClasses()
  const mutations = useChildMutations()
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim()
    return (children.data ?? []).filter((c) => {
      if (classFilter && c.classId !== classFilter) return false
      if (!q) return true
      return c.full_name.includes(q) || c.public_code.toUpperCase().includes(q.toUpperCase())
    })
  }, [children.data, search, classFilter])

  return (
    <div>
      <PageToolBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('children.searchPlaceholder'),
        }}
        chips={
          <Select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-36"
            aria-label={t('children.filterAllClasses')}
          >
            <option value="">{t('children.filterAllClasses')}</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
        resultCount={filtered.length}
      />

      {children.isPending ? (
        <LoadingState />
      ) : children.isError ? (
        <ErrorState
          message={t('common.errorGeneric')}
          onRetry={() => void children.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('children.emptyTitle')}
          hint={t('children.emptyBody')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((child) => (
            <button
              key={child.id}
              type="button"
              className="text-start cursor-pointer bg-transparent border-0 p-0"
              onClick={() => navigate(`/children/${child.id}`)}
            >
            <ListRow
              leading={<Avatar name={child.full_name} />}
              title={child.full_name}
              secondary={
                [
                  child.className ?? t('children.noClass'),
                  ageLabel(child.birth_date) ?? '',
                  `#${child.public_code}`,
                ]
                  .filter(Boolean)
                  .join(' • ')
              }
              trailing={
                isOwner && child.balance > 0 ? (
                  <span className="type-badge text-bad-text bg-bad-soft rounded-full px-2 py-1">
                    {formatMoney(child.balance)}
                  </span>
                ) : undefined
              }
            />
            </button>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <button
            onClick={() => navigate('/qr-cards')}
            className="fixed bottom-56 end-4 z-10 w-12 h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center text-text cursor-pointer"
            aria-label={t('children.qr.title')}
          >
            <QrCode size={20} />
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="fixed bottom-40 end-4 z-10 w-12 h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center text-text cursor-pointer"
            aria-label={t('children.import.title')}
          >
            <Upload size={20} />
          </button>
          <Fab
            label={t('children.addChild')}
            ariaLabel={t('children.addChild')}
            onClick={() => setFormOpen(true)}
          />
          <ChildFormSheet
            open={formOpen}
            onClose={() => setFormOpen(false)}
            onSubmit={async (input) => {
              await mutations.create.mutateAsync(input)
            }}
          />
          <ChildImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
        </>
      )}
    </div>
  )
}
