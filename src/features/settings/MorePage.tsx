import { useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarCheck,
  PartyPopper,
  MessageCircle, MessageCircleQuestion,
  Bus,
  ClipboardList,
  Download,
  FileText,
  LayoutGrid,
  Link2,
  LogOut,
  Megaphone,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useT } from '../../i18n'
import { useLocale, setLocale } from '../../i18n/locale'
import { prefetchRoutesIdle } from '../../lib/routePrefetch'
import { useEffect } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { setActiveNurseryId } from '../../lib/workspace'

/** «المزيد»: كل وجهات نونو الثانوية + مبدّل الحضانة + اللغة + الخروج */
export function MorePage() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const nursery = useCurrentNursery()
  const isOwner = nursery.status === 'ready' && nursery.isOwner

  useEffect(() => {
    return prefetchRoutesIdle([
      '/classes',
      '/reports',
      '/bus',
      '/announcements',
      '/portal-links',
      '/activity',
      '/finance',
      '/settings',
      '/members',
    ])
  }, [])

  const items: {
    icon: typeof LayoutGrid
    label: string
    path: string
    ownerOnly?: boolean
  }[] = [
    { icon: LayoutGrid, label: t('shell.more.classes'), path: '/classes' },
    { icon: FileText, label: t('shell.more.reports'), path: '/reports' },
    { icon: Bus, label: t('shell.more.bus'), path: '/bus' },
    { icon: Megaphone, label: t('shell.more.announcements'), path: '/announcements' },
    { icon: Link2, label: t('shell.more.portalLinks'), path: '/portal-links' },
    { icon: Wallet, label: t('shell.more.finance'), path: '/finance', ownerOnly: true },
    { icon: Truck, label: t('shell.more.suppliers'), path: '/suppliers', ownerOnly: true },
    { icon: MessageCircle, label: t('shell.more.messages'), path: '/messages' },
    { icon: MessageCircleQuestion, label: t('shell.more.qa'), path: '/qa' },
    { icon: CalendarCheck, label: t('shell.more.tours'), path: '/tours' },
    { icon: PartyPopper, label: t('shell.more.events'), path: '/events' },
    {
      icon: ShieldCheck,
      label: t('shell.more.proofs'),
      path: '/proofs',
      ownerOnly: true,
    },
    { icon: ClipboardList, label: t('shell.more.activity'), path: '/activity' },
    { icon: Users, label: t('shell.more.members'), path: '/members', ownerOnly: true },
    { icon: Bell, label: t('shell.title.notifications'), path: '/notifications' },
    { icon: SettingsIcon, label: t('shell.more.settings'), path: '/settings' },
    { icon: Download, label: t('shell.more.export'), path: '/export' },
    { icon: ReceiptText, label: t('shell.nav.invoices'), path: '/invoices', ownerOnly: true },
  ]

  return (
    <div className="flex flex-col gap-2">
      {nursery.status === 'ready' && nursery.memberships.length > 1 && (
        <Card>
          <div className="type-section mb-2">{t('shell.switchNursery')}</div>
          <div className="flex flex-col gap-1">
            {nursery.memberships.map((m) => (
              <button
                key={m.id}
                className={`text-start rounded-xl px-3 py-2 type-body cursor-pointer border-0 ${
                  m.nursery_id === nursery.nurseryId
                    ? 'bg-soft text-primary font-semibold'
                    : 'bg-transparent text-text'
                }`}
                onClick={() => setActiveNurseryId(m.nursery_id)}
              >
                {m.nursery.name}
              </button>
            ))}
          </div>
        </Card>
      )}
      {items
        .filter((i) => !i.ownerOnly || isOwner)
        .map((item) => {
          const Icon = item.icon
          return (
            <Card
              key={item.path}
              className="flex items-center gap-3 cursor-pointer py-3"
              onClick={() => navigate(item.path)}
            >
              <span className="w-10 h-10 rounded-full bg-soft text-primary flex items-center justify-center">
                <Icon size={20} />
              </span>
              <span className="type-body">{item.label}</span>
            </Card>
          )
        })}
      <Card
        className="flex items-center gap-3 cursor-pointer py-3"
        onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      >
        <span className="w-10 h-10 rounded-full bg-soft text-primary flex items-center justify-center type-body font-bold">
          {locale === 'ar' ? 'EN' : t('common.langAr')}
        </span>
        <span className="type-body">{t('shell.more.language')}</span>
      </Card>
      <Card
        className="flex items-center gap-3 cursor-pointer py-3"
        onClick={() => void signOut()}
      >
        <span className="w-10 h-10 rounded-full bg-bad-soft text-bad-text flex items-center justify-center">
          <LogOut size={20} />
        </span>
        <span className="type-body">{t('shell.more.signOut')}</span>
      </Card>
    </div>
  )
}
