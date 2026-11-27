import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, MessageCircleQuestion, Send } from 'lucide-react'
import * as api from './api'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useT } from '../../i18n'
import { useToast } from '../../components/ui/toast'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ListRow } from '../../components/ui/ListRow'
import { Sheet } from '../../components/ui/Sheet'
import { Field, TextArea, TextInput } from '../../components/ui/form'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { formatDateTimeAr } from '../../lib/format'

export default function QaPage() {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const nurseryRes = useCurrentNursery()
  const nurseryId = nurseryRes.status === 'ready' ? nurseryRes.nurseryId : ''
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [openSession, setOpenSession] = useState<api.QaSession | null>(null)
  const [answers, setAnswers] = useState<Map<string, string>>(new Map())

  const sessions = useQuery({
    queryKey: ['qa-sessions', nurseryId],
    queryFn: () => api.listSessions(nurseryId!),
    enabled: !!nurseryId,
  })
  const questions = useQuery({
    queryKey: ['qa-questions', openSession?.id],
    queryFn: () => api.listQuestions(openSession!.id),
    enabled: !!openSession,
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['qa-sessions', nurseryId] })
    void qc.invalidateQueries({ queryKey: ['qa-questions', openSession?.id] })
  }
  const create = useMutation({
    mutationFn: () =>
      api.createSession(nurseryId!, title.trim(), new Date(startsAt).toISOString()),
    onSuccess: () => {
      setCreateOpen(false)
      setTitle('')
      setStartsAt('')
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: api.QaSession['status'] }) =>
      api.setSessionStatus(v.id, v.status),
    onSuccess: refresh,
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const answer = useMutation({
    mutationFn: (v: { id: string; text: string }) =>
      api.answerQuestion(v.id, v.text),
    onSuccess: refresh,
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  if (!nurseryId || sessions.isLoading) return <LoadingState />
  if (sessions.isError) {
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void sessions.refetch()}
      />
    )
  }
  const list = sessions.data ?? []
  const statusLabel = (s: api.QaSession['status']) =>
    s === 'live' ? t('qa.live') : s === 'ended' ? t('qa.ended') : t('qa.scheduled')

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => setCreateOpen(true)}>
        <CalendarPlus size={18} />
        {t('qa.create')}
      </Button>
      {list.length === 0 ? (
        <EmptyState
          icon={MessageCircleQuestion}
          title={t('qa.emptyTitle')}
          hint={t('qa.emptyBody')}
        />
      ) : (
        list.map((s) => (
          <ListRow
            key={s.id}
            title={s.title}
            secondary={`${formatDateTimeAr(s.starts_at)} • ${statusLabel(s.status)}`}
            trailing={
              <Button size="sm" variant="ghost" onClick={() => setOpenSession(s)}>
                {t('qa.open')}
              </Button>
            }
          />
        ))
      )}

      <Sheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('qa.create')}
      >
        <div className="flex flex-col gap-3">
          <Field label={t('qa.titleLabel')}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('qa.startsLabel')}>
            <TextInput
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Button
            disabled={!title.trim() || !startsAt || create.isPending}
            onClick={() => create.mutate()}
          >
            {t('qa.create')}
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={!!openSession}
        onClose={() => setOpenSession(null)}
        title={openSession?.title ?? ''}
      >
        {openSession && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 flex-wrap">
              {openSession.status === 'scheduled' && (
                <Button
                  size="sm"
                  onClick={() =>
                    setStatus.mutate({ id: openSession.id, status: 'live' })
                  }
                >
                  {t('qa.startNow')}
                </Button>
              )}
              {openSession.status !== 'ended' && (
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() =>
                    setStatus.mutate({ id: openSession.id, status: 'ended' })
                  }
                >
                  {t('qa.endNow')}
                </Button>
              )}
            </div>
            {questions.isLoading ? (
              <LoadingState />
            ) : (questions.data ?? []).length === 0 ? (
              <div className="type-secondary text-muted">{t('qa.noQuestions')}</div>
            ) : (
              (questions.data ?? []).map((q) => (
                <Card key={q.id}>
                  <div className="type-body">{q.body}</div>
                  <div className="type-badge text-muted">{q.guardianName}</div>
                  {q.answer ? (
                    <div className="type-secondary mt-2 bg-soft rounded-xl p-2">
                      {q.answer}
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-2 items-start">
                      <TextArea
                        rows={2}
                        value={answers.get(q.id) ?? ''}
                        placeholder={t('qa.answerPlaceholder')}
                        onChange={(e) =>
                          setAnswers((prev) => new Map(prev).set(q.id, e.target.value))
                        }
                      />
                      <Button
                        size="sm"
                        disabled={!(answers.get(q.id) ?? '').trim() || answer.isPending}
                        onClick={() =>
                          answer.mutate({
                            id: q.id,
                            text: (answers.get(q.id) ?? '').trim(),
                          })
                        }
                      >
                        <Send size={16} />
                        {t('qa.answerSend')}
                      </Button>
                    </div>
                  )}
                </Card>
              ))
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
