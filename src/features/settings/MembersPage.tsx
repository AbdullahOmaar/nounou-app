import { useState } from 'react'
import { Plus, Send, Trash2 } from 'lucide-react'
import { useToast } from '../../components/ui/toast'
import { sendInviteEmail } from './api'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, FormError, TextInput } from '../../components/ui/form'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import type { MemberPermissions, PermissionKey } from '../../types/database'
import { useMembers, useSettingsMutations } from './hooks'

const PERMISSION_KEYS: PermissionKey[] = [
  'can_manage_children',
  'can_manage_classes',
  'can_take_attendance',
  'can_manage_reports',
  'can_manage_photos',
  'can_manage_bus',
  'can_manage_announcements',
  'can_view_children',
  'can_review_proofs',
]

/**
 * الطاقم والصلاحيات (مالك فقط): دعوة بالبريد + مفاتيح صلاحيات لكل عضو.
 * المالية ليست مفتاحاً أصلاً — للمالك فقط في RLS مهما اتضبط هنا.
 */
export function MembersPage() {
  const t = useT()
  const toast = useToast()
  const nursery = useCurrentNursery()
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const members = useMembers()
  const mutations = useSettingsMutations()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [perms, setPerms] = useState<MemberPermissions>({
    can_take_attendance: true,
    can_manage_reports: true,
    can_manage_photos: true,
    can_view_children: true,
  })
  const [error, setError] = useState<string | null>(null)

  if (!isOwner) return <EmptyState title={t('settings.financeNote')} />
  if (members.isPending) return <LoadingState />
  if (members.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void members.refetch()}
      />
    )
  const list = members.data ?? []

  const permLabel = (key: PermissionKey): string => {
    switch (key) {
      case 'can_manage_children':
        return t('settings.perm.can_manage_children')
      case 'can_manage_classes':
        return t('settings.perm.can_manage_classes')
      case 'can_take_attendance':
        return t('settings.perm.can_take_attendance')
      case 'can_manage_reports':
        return t('settings.perm.can_manage_reports')
      case 'can_manage_photos':
        return t('settings.perm.can_manage_photos')
      case 'can_manage_bus':
        return t('settings.perm.can_manage_bus')
      case 'can_manage_announcements':
        return t('settings.perm.can_manage_announcements')
      case 'can_view_children':
        return t('settings.perm.can_view_children')
      case 'can_review_proofs':
        return t('settings.perm.can_review_proofs')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="type-badge text-muted">{t('settings.financeNote')}</p>
      <Button variant="soft" onClick={() => setInviteOpen(true)}>
        <Plus size={16} />
        {t('settings.addMember')}
      </Button>
      {list.map((m) => (
        <Card key={m.id}>
          <div className="flex items-start justify-between">
            <div>
              <div className="type-body">
                {m.display_name || m.invited_email || '—'}
                <span className="type-badge text-muted">
                  {' '}
                  • {m.role === 'owner' ? t('settings.roleOwner') : t('settings.roleStaff')}
                </span>
              </div>
              <div className="type-badge text-muted">
                {m.status === 'invited'
                  ? t('settings.memberInvited')
                  : m.status === 'active'
                    ? t('settings.memberActive')
                    : t('settings.memberSuspended')}
              </div>
            </div>
            {m.role !== 'owner' && (
              <span className="flex gap-1">
                {m.status === 'invited' && m.invited_email && nursery.status === 'ready' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('settings.resendInviteEmail')}
                    onClick={async () => {
                      const st = await sendInviteEmail(nursery.nurseryId, m.invited_email!)
                      toast(
                        st === 'sent'
                          ? t('settings.inviteEmailResent')
                          : t('settings.inviteEmailFailed'),
                        st === 'sent' ? 'success' : 'error',
                      )
                    }}
                  >
                    <Send size={16} />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void mutations.updateMember.mutateAsync({
                      memberId: m.id,
                      patch: {
                        status: m.status === 'suspended' ? 'active' : 'suspended',
                      },
                    })
                  }
                >
                  {m.status === 'suspended'
                    ? t('settings.activate')
                    : t('settings.suspend')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void mutations.removeMember.mutateAsync(m.id)}
                  aria-label={t('settings.removeMember')}
                >
                  <Trash2 size={16} />
                </Button>
              </span>
            )}
          </div>
          {m.role !== 'owner' && (
            <div className="mt-2">
              <ChipRow>
                {PERMISSION_KEYS.filter((k) => k !== 'can_review_proofs').map((key) => {
                  const on = m.permissions?.[key] === true
                  return (
                    <Chip
                      key={key}
                      active={on}
                      onClick={() =>
                        void mutations.updateMember.mutateAsync({
                          memberId: m.id,
                          patch: {
                            permissions: { ...m.permissions, [key]: !on },
                          },
                        })
                      }
                    >
                      {permLabel(key)}
                    </Chip>
                  )
                })}
              </ChipRow>
            </div>
          )}
        </Card>
      ))}

      <Sheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('settings.addMember')}
        footer={
          <Button
            full
            disabled={!email.includes('@') || mutations.invite.isPending}
            onClick={async () => {
              setError(null)
              try {
                const emailStatus = await mutations.invite.mutateAsync({ email, permissions: perms })
                setEmail('')
                setInviteOpen(false)
                toast(
                  emailStatus === 'sent'
                    ? t('settings.inviteEmailSent')
                    : t('settings.inviteEmailFailed'),
                  emailStatus === 'sent' ? 'success' : 'error',
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : t('common.errorGeneric'))
              }
            }}
          >
            {t('settings.addMember')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('settings.memberEmail')}>
            <TextInput
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t('settings.permissionsTitle')}>
            <ChipRow>
              {PERMISSION_KEYS.filter((k) => k !== 'can_review_proofs').map((key) => (
                <Chip
                  key={key}
                  active={perms[key] === true}
                  onClick={() => setPerms({ ...perms, [key]: perms[key] !== true })}
                >
                  {permLabel(key)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          {error && <FormError message={error} />}
        </div>
      </Sheet>
    </div>
  )
}
