import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QrCode, Upload } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Fab } from '../../components/ui/Fab'
import {
  GROUP_HEADER_TOP_WITH_SEARCH,
  PageToolBar,
  StickyGroupHeader,
} from '../../components/ui/PageToolBar'
import { Chip } from '../../components/ui/form'
import { useT } from '../../i18n'
import { ageLabel, formatMoney } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useClasses } from '../classes/hooks'
import { useChildren, useChildMutations } from './hooks'
import type { ChildListItem } from './api'
import { ChildFormSheet } from './ChildFormSheet'
import { ChildImportSheet } from './ChildImportSheet'

/**
 * قائمة الأطفال (موجة الهوية 2، موك أب 2): بحث لاصق + رقائق فصول +
 * تجميع ببطاقة لكل فصل بعنوان لاصق. التصفية والبحث نفسيهما كما هما.
 */
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

  const groups = useMemo(() => {
    const byClass = new Map<string | null, ChildListItem[]>()
    for (const c of filtered) {
      const list = byClass.get(c.classId) ?? []
      list.push(c)
      byClass.set(c.classId, list)
    }
    const out: { key: string; title: string; items: ChildListItem[] }[] = []
    for (const cls of classes.data ?? []) {
      const items = byClass.get(cls.id)
      if (items && items.length > 0) {
        out.push({
          key: cls.id,
          title: t('children.groupTitle', { name: cls.name }),
          items,
        })
      }
    }
    const unclassed = byClass.get(null)
    if (unclassed && unclassed.length > 0) {
      out.push({ key: 'none', title: t('children.noClass'), items: unclassed })
    }
    return out
  }, [filtered, classes.data, t])

  return (
    <div>
      <PageToolBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('children.searchPlaceholder'),
        }}
        chips={
          <>
            <Chip active={classFilter === ''} onClick={() => setClassFilter('')}>
              {t('children.filterAllClasses')}
            </Chip>
            {(classes.data ?? []).map((c) => (
              <Chip
                key={c.id}
                active={classFilter === c.id}
                onClick={() => setClassFilter(c.id)}
              >
                {c.name}
              </Chip>
            ))}
          </>
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
        <div className="flex flex-col">
          {groups.map((g) => (
            <section key={g.key}>
              <StickyGroupHeader top={GROUP_HEADER_TOP_WITH_SEARCH}>
                <span className="flex items-center justify-between">
                  <span className="font-display text-[17px] font-bold text-primary">
                    {g.title}
                  </span>
                  <span className="type-badge text-accent-text">
                    {t('format.childCount', { count: g.items.length })}
                  </span>
                </span>
              </StickyGroupHeader>
              <Card className="p-0 overflow-hidden mb-4">
                <div className="divide-y divide-border">
                  {g.items.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 text-start cursor-pointer bg-transparent border-0 hover:bg-surface"
                      onClick={() => navigate(`/children/${child.id}`)}
                    >
                      <Avatar name={child.full_name} />
                      <span className="flex-1 min-w-0">
                        <span className="type-body block truncate">
                          {child.full_name}
                        </span>
                        <span className="type-badge text-muted block">
                          {[ageLabel(child.birth_date) ?? '', `#${child.public_code}`]
                            .filter(Boolean)
                            .join(' • ')}
                        </span>
                      </span>
                      {isOwner && child.balance > 0 && (
                        <span className="type-badge shrink-0 text-bad-text bg-bad-soft rounded-full px-2 py-1">
                          {formatMoney(child.balance)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </Card>
            </section>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <button
            onClick={() => navigate('/qr-cards')}
            className="fixed bottom-56 end-[max(1rem,calc(50vw-320px+1rem))] z-10 w-12 h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center text-text cursor-pointer"
            aria-label={t('children.qr.title')}
          >
            <QrCode size={20} />
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="fixed bottom-40 end-[max(1rem,calc(50vw-320px+1rem))] z-10 w-12 h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center text-text cursor-pointer"
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
