import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmSheet } from '../../components/ui/ConfirmSheet'
import { Chip, ChipRow, Field, TextArea, TextInput } from '../../components/ui/form'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { invalidatePrefixes } from '../../lib/invalidate'
import { BANNER_KEYS, bannerUrl } from '../public/banners'
import * as postsApi from './posts'
import type { NurseryPost, PostDraft } from './posts'

/**
 * منشورات الصفحة العامة (3A-891): تجهيز المحتوى الدوري داخل
 * التطبيق — مسودات ومنشورات تظهر على صفحة الحضانة العامة.
 * النشر على الحساب الاجتماعي الخارجي ليس هنا (قرار مالك).
 */
export function PublicPostsCard({ nurseryId }: { nurseryId: string }) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [imageKey, setImageKey] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [deleting, setDeleting] = useState<NurseryPost | null>(null)

  const posts = useQuery({
    queryKey: ['public-posts', nurseryId],
    queryFn: () => postsApi.listNurseryPosts(nurseryId),
  })

  const refresh = () => invalidatePrefixes(qc, ['public-posts'])
  const fail = () => showToast(t('common.errorGeneric'), 'error')

  const openNew = () => {
    setEditingId(null)
    setTitle('')
    setBody('')
    setImageKey('')
    setStatus('draft')
    setFormOpen(true)
  }
  const openEdit = (p: NurseryPost) => {
    setEditingId(p.id)
    setTitle(p.title)
    setBody(p.body)
    setImageKey(p.image_key ?? '')
    setStatus(p.status)
    setFormOpen(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const draft: PostDraft = {
        title: title.trim(),
        body: body.trim(),
        image_key: imageKey || null,
        status,
      }
      if (editingId) {
        const prev = (posts.data ?? []).find((p) => p.id === editingId)
        await postsApi.updatePost(editingId, draft, prev?.status ?? 'draft')
      } else {
        await postsApi.createPost(nurseryId, draft)
      }
    },
    onSuccess: () => {
      refresh()
      setFormOpen(false)
      showToast(t('common.savedOk'))
    },
    onError: fail,
  })

  const remove = useMutation({
    mutationFn: (id: string) => postsApi.deletePost(id),
    onSuccess: () => {
      refresh()
      setDeleting(null)
      showToast(t('common.savedOk'))
    },
    onError: fail,
  })

  return (
    <Card className="flex flex-col gap-3">
      <span className="type-section">{t('settings.posts.title')}</span>
      <p className="type-secondary text-muted">{t('settings.posts.hint')}</p>

      {(posts.data ?? []).map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-2 border-b border-border pb-2"
        >
          <span className="type-body flex-1">
            {p.title}
            <span
              className={`type-badge ms-2 rounded-full px-2 py-0.5 ${
                p.status === 'published'
                  ? 'bg-ok-soft text-ok-text'
                  : 'bg-warn-soft text-warn-text'
              }`}
            >
              {p.status === 'published'
                ? t('settings.posts.published')
                : t('settings.posts.draft')}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
            <Pencil size={16} /> {t('common.edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      {(posts.data ?? []).length === 0 && !formOpen && (
        <p className="type-secondary text-muted">{t('settings.posts.empty')}</p>
      )}

      {!formOpen && (
        <Button variant="soft" onClick={openNew}>
          <Plus size={18} /> {t('settings.posts.new')}
        </Button>
      )}

      {formOpen && (
        <div className="flex flex-col gap-3">
          <Field label={t('settings.posts.titleLabel')}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('settings.posts.bodyLabel')}>
            <TextArea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div>
            <div className="type-secondary text-muted mb-2">
              {t('settings.posts.imageLabel')}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setImageKey('')}
                className={`rounded-xl bg-soft aspect-video flex items-center justify-center type-badge ${imageKey === '' ? 'ring-2 ring-text' : ''}`}
              >
                {t('settings.bannerNone')}
              </button>
              {BANNER_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setImageKey(k)}
                  className={`rounded-xl overflow-hidden aspect-video ${imageKey === k ? 'ring-2 ring-text' : ''}`}
                >
                  <img src={bannerUrl(k)} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </div>
          <Field label={t('settings.posts.statusLabel')}>
            <ChipRow>
              <Chip active={status === 'draft'} onClick={() => setStatus('draft')}>
                {t('settings.posts.draft')}
              </Chip>
              <Chip
                active={status === 'published'}
                onClick={() => setStatus('published')}
              >
                {t('settings.posts.published')}
              </Chip>
            </ChipRow>
          </Field>
          <span className="flex gap-2">
            <Button
              className="flex-1"
              disabled={save.isPending || !title.trim() || !body.trim()}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
            <Button
              className="flex-1"
              variant="soft"
              onClick={() => setFormOpen(false)}
            >
              {t('common.cancel')}
            </Button>
          </span>
        </div>
      )}

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('settings.posts.deleteTitle')}
        body={deleting?.title ?? ''}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </Card>
  )
}
