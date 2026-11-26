import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, Link2, MessageCircle, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { formatDateTimeAr, waLink } from '../../lib/format'
import { requireSupabase } from '../../lib/supabase'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { invalidatePrefixes } from '../../lib/invalidate'
import type { GuardianRow } from '../../types/database'
import * as api from './api'

interface GuardianGroup {
  guardian: GuardianRow
  childrenNames: string[]
  activeToken: { id: string; expires_at: string; last_used_at: string | null } | null
  viewToken: { id: string } | null
}

/** إدارة روابط البوابة: رابط لكل وصي (قرار ق١٠) — إصدار/نسخ/إرسال/إلغاء */
export function PortalLinksPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const canManage =
    nursery.status === 'ready' && nursery.can('can_manage_children')
  const qc = useQueryClient()
  const showToast = useToast()
  const [freshLinks, setFreshLinks] = useState<Map<string, string>>(new Map())
  const [freshViewLinks, setFreshViewLinks] = useState<Map<string, string>>(new Map())

  const groups = useQuery({
    queryKey: ['portal-links', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: async (): Promise<GuardianGroup[]> => {
      const db = requireSupabase()
      const [guardiansRes, linksRes, tokensRes] = await Promise.all([
        db.from('guardians').select('*').eq('nursery_id', nurseryId!).order('full_name'),
        db
          .from('guardian_children')
          .select('guardian_id, child:children(full_name)')
          .order('created_at'),
        api.listTokens(nurseryId!),
      ])
      if (guardiansRes.error) throw guardiansRes.error
      if (linksRes.error) throw linksRes.error
      const childrenByGuardian = new Map<string, string[]>()
      for (const l of linksRes.data ?? []) {
        const row = l as unknown as {
          guardian_id: string
          child: { full_name: string } | null
        }
        if (!row.child) continue
        const arr = childrenByGuardian.get(row.guardian_id) ?? []
        arr.push(row.child.full_name)
        childrenByGuardian.set(row.guardian_id, arr)
      }
      const activeByGuardian = new Map<string, GuardianGroup['activeToken']>()
      const viewByGuardian = new Map<string, GuardianGroup['viewToken']>()
      for (const token of tokensRes) {
        if (token.child_id) continue
        if (token.revoked_at) continue
        if (new Date(token.expires_at) <= new Date()) continue
        if (token.access_scope === 'view') {
          if (!viewByGuardian.has(token.guardian_id)) {
            viewByGuardian.set(token.guardian_id, { id: token.id })
          }
          continue
        }
        if (!activeByGuardian.has(token.guardian_id)) {
          activeByGuardian.set(token.guardian_id, {
            id: token.id,
            expires_at: token.expires_at,
            last_used_at: token.last_used_at,
          })
        }
      }
      return ((guardiansRes.data ?? []) as GuardianRow[]).map((g) => ({
        guardian: g,
        childrenNames: childrenByGuardian.get(g.id) ?? [],
        activeToken: activeByGuardian.get(g.id) ?? null,
        viewToken: viewByGuardian.get(g.id) ?? null,
      }))
    },
  })

  const refresh = () => invalidatePrefixes(qc, ['portal-links', 'child'])
  const issue = useMutation({
    mutationFn: async (guardianId: string) => {
      const url = await api.issueToken(nurseryId!, guardianId, null)
      return { guardianId, url }
    },
    onSuccess: ({ guardianId, url }) => {
      setFreshLinks((prev) => new Map(prev).set(guardianId, url))
      showToast(t('children.linkIssued'))
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const revoke = useMutation({
    mutationFn: (tokenId: string) => api.revokeToken(tokenId),
    onSuccess: refresh,
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const issueView = useMutation({
    mutationFn: async (guardianId: string) => {
      const url = await api.issueViewToken(nurseryId!, guardianId, null)
      return { guardianId, url }
    },
    onSuccess: ({ guardianId, url }) => {
      setFreshViewLinks((prev) => new Map(prev).set(guardianId, url))
      showToast(t('children.linkIssued'))
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  const list = useMemo(
    () => (groups.data ?? []).filter((g) => g.childrenNames.length > 0),
    [groups.data],
  )

  if (groups.isPending) return <LoadingState />
  if (groups.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void groups.refetch()}
      />
    )
  if (list.length === 0)
    return <EmptyState title={t('children.emptyTitle')} hint={t('children.emptyBody')} />

  return (
    <div className="flex flex-col gap-2">
      {list.map(({ guardian, childrenNames, activeToken, viewToken }) => {
        const fresh = freshLinks.get(guardian.id)
        const freshView = freshViewLinks.get(guardian.id)
        const wa = fresh ? waLink(guardian.phone) : null
        return (
          <Card key={guardian.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="type-body">{guardian.full_name}</div>
                <div className="type-badge text-muted">
                  {childrenNames.join(' • ')} — <span dir="ltr">{guardian.phone}</span>
                </div>
                <div className="type-badge text-muted">
                  {activeToken
                    ? `${t('children.linkActive')} • ${t('children.linkExpires', { date: activeToken.expires_at.slice(0, 10) })} • ${
                        activeToken.last_used_at
                          ? t('children.linkLastUsed', {
                              date: formatDateTimeAr(activeToken.last_used_at),
                            })
                          : t('children.linkNeverUsed')
                      }`
                    : t('children.portalLinkHint')}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {canManage && !activeToken && (
                <Button
                  size="sm"
                  disabled={issue.isPending}
                  onClick={() => issue.mutate(guardian.id)}
                >
                  <Link2 size={16} />
                  {t('children.issueLink')}
                </Button>
              )}
              {fresh && (
                <>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={async () => {
                      await navigator.clipboard.writeText(fresh)
                      showToast(t('common.copied'))
                    }}
                  >
                    <Copy size={16} />
                    {t('children.copyLink')}
                  </Button>
                  {wa && (
                    <a
                      href={`${wa}?text=${encodeURIComponent(fresh)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" variant="soft">
                        <MessageCircle size={16} />
                        {t('children.sendWhatsapp')}
                      </Button>
                    </a>
                  )}
                </>
              )}
              {canManage && activeToken && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(activeToken.id)}
                >
                  <X size={16} />
                  {t('children.revokeLink')}
                </Button>
              )}
              {canManage && (
                <span className="flex gap-2 flex-wrap">
                  {!viewToken && !freshView && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={issueView.isPending}
                      onClick={() => issueView.mutate(guardian.id)}
                    >
                      <Eye size={16} />
                      {t('children.issueViewLink')}
                    </Button>
                  )}
                  {freshView && (
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={() => void navigator.clipboard.writeText(freshView)}
                    >
                      <Copy size={16} />
                      {t('children.copyViewLink')}
                    </Button>
                  )}
                  {viewToken && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(viewToken.id)}
                    >
                      <X size={16} />
                      {t('children.revokeViewLink')}
                    </Button>
                  )}
                </span>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
