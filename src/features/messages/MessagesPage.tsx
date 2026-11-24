import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Send } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ListRow } from '../../components/ui/ListRow'
import { Sheet } from '../../components/ui/Sheet'
import { TextArea } from '../../components/ui/form'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { invalidatePrefixes } from '../../lib/invalidate'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import * as api from './api'

/**
 * رسائل الأهالي (2.5 / 3A-411): خيوط محادثة مع أولياء الأمور من
 * بواباتهم — قائمة خيوط + خيط مفتوح + رد. فتح الخيط يعلّم رسائل
 * الوصيّ مقروءة عند الطاقم.
 */
export function MessagesPage() {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : ''
  const [openGuardian, setOpenGuardian] = useState<api.ThreadSummary | null>(null)
  const [draft, setDraft] = useState('')

  const threads = useQuery({
    queryKey: ['message-threads', nurseryId],
    queryFn: () => api.listThreads(nurseryId),
    enabled: Boolean(nurseryId),
  })
  const thread = useQuery({
    queryKey: ['message-thread', nurseryId, openGuardian?.guardianId],
    queryFn: () => api.listThreadMessages(nurseryId, openGuardian!.guardianId),
    enabled: Boolean(nurseryId && openGuardian),
  })
  const refresh = () =>
    invalidatePrefixes(qc, ['message-threads', 'message-thread'])
  const openThread = async (th: api.ThreadSummary) => {
    setOpenGuardian(th)
    if (th.unread > 0) {
      await api.markThreadRead(nurseryId, th.guardianId)
      refresh()
    }
  }
  const send = useMutation({
    mutationFn: () =>
      api.sendStaffMessage(nurseryId, openGuardian!.guardianId, draft),
    onSuccess: () => {
      setDraft('')
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  if (!nurseryId || threads.isLoading) return <LoadingState />
  if (threads.isError) return <ErrorState message={t('common.errorGeneric')} onRetry={() => threads.refetch()} />

  return (
    <div className="flex flex-col gap-3">
      {(threads.data ?? []).length === 0 ? (
        <EmptyState
          title={t('messages.emptyTitle')}
          hint={t('messages.emptyBody')}
        />
      ) : (
        (threads.data ?? []).map((th) => (
          <button key={th.guardianId} onClick={() => openThread(th)}>
            <ListRow
              leading={<Avatar name={th.guardianName} />}
              title={th.guardianName}
              secondary={th.lastBody}
              trailing={
                th.unread > 0 ? (
                  <span className="min-w-6 h-6 px-1 rounded-full bg-bad text-white type-badge flex items-center justify-center">
                    {th.unread}
                  </span>
                ) : (
                  <MessageCircle size={18} className="text-muted" />
                )
              }
            />
          </button>
        ))
      )}

      <Sheet
        open={Boolean(openGuardian)}
        onClose={() => setOpenGuardian(null)}
        title={openGuardian?.guardianName ?? ''}
      >
        <div className="flex flex-col gap-2">
          {(thread.data ?? []).map((m) => (
            <div
              key={m.id}
              className={
                m.sender === 'staff'
                  ? 'self-start max-w-[85%]'
                  : 'self-end max-w-[85%]'
              }
            >
              <Card
                className={
                  m.sender === 'staff'
                    ? 'py-2 bg-primary-soft'
                    : 'py-2 bg-soft'
                }
              >
                <p className="type-body whitespace-pre-wrap">{m.body}</p>
                <span className="type-badge text-muted">
                  {m.created_at.slice(0, 16).replace('T', ' ')}
                </span>
              </Card>
            </div>
          ))}
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('messages.replyPlaceholder')}
            rows={3}
          />
          <Button
            disabled={!draft.trim() || send.isPending}
            onClick={() => send.mutate()}
          >
            <Send size={16} />
            {t('messages.send')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
