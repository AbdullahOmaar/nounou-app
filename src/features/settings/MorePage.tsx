import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Bot,
  ChevronLeft,
  Building2,
  CalendarCheck,
  Route,
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
import { useQuery } from '@tanstack/react-query'
import { checkIsOperator } from '../ops/api'
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
  const operator = useQuery({
    queryKey: ['is-platform-operator'],
    queryFn: checkIsOperator,
  })
  const isOperator = operator.data === true

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
    opsOnly?: boolean
  }[] = [
    { icon: LayoutGrid, label: t('shell.more.classes'), path: '/classes' },
    { icon: FileText, label: t('shell.more.reports'), path: '/reports' },
    { icon: Bus, label: t('shell.more.bus'), path: '/bus' },
    { icon: Megaphone, label: t('shell.more.announcements'), path: '/announcements' },
    { icon: Link2, label: t('shell.more.portalLinks'), path: '/portal-links' },
    { icon: Wallet, label: t('shell.more.finance'), path: '/finance', ownerOnly: true },
    { icon: Truck, label: t('shell.more.suppliers'), path: '/suppliers', ownerOnly: true },
    { icon: Wallet, label: t('shell.more.staff'), path: '/staff', ownerOnly: true },
    { icon: MessageCircle, label: t('shell.more.messages'), path: '/messages' },
    { icon: MessageCircleQuestion, label: t('shell.more.qa'), path: '/qa' },
    { icon: CalendarCheck, label: t('shell.more.tours'), path: '/tours' },
    { icon: Route, label: t('shell.more.licensing'), path: '/licensing', ownerOnly: true },
    { icon: ShieldCheck, label: t('shell.more.ops'), path: '/ops', opsOnly: true },
    { icon: Bot, label: t('shell.more.assistant'), path: '/assistant', ownerOnly: true },
    { icon: Building2, label: t('shell.more.branches'), path: '/branches' },
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

  // تجميع الهوية (الموجة 5): 3 مجموعات مسمّاة بحد أقصى (قاعدة الخطة —
  // «المزيد» سلة ترحيل مقصودة لا مقبرة بنود)، صفوف مدمجة في بطاقة
  // واحدة لكل مجموعة بدل بطاقة لكل وجهة.
  const visible = items
    .filter((i) => !i.ownerOnly || isOwner)
    .filter((i) => !i.opsOnly || isOperator)
  const ADMIN_PATHS = new Set([
    '/classes', '/members', '/settings', '/export', '/finance', '/invoices',
    '/proofs', '/suppliers', '/staff', '/branches', '/licensing', '/assistant', '/ops',
  ])
  const leadFirst = (paths: string[]) => (a: (typeof items)[number], b: (typeof items)[number]) => {
    const ia = paths.indexOf(a.path)
    const ib = paths.indexOf(b.path)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  }
  const groups = [
    {
      key: 'admin',
      label: t('shell.more.groupAdmin'),
      items: visible
        .filter((i) => ADMIN_PATHS.has(i.path))
        .sort(leadFirst(['/classes', '/members', '/settings', '/export'])),
    },
    {
      key: 'comms',
      label: t('shell.more.groupComms'),
      items: visible
        .filter((i) => !ADMIN_PATHS.has(i.path))
        .sort(leadFirst(['/portal-links', '/activity', '/announcements', '/bus'])),
    },
  ].filter((g) => g.items.length > 0)

  const row = (
    icon: typeof LayoutGrid,
    label: string,
    onClick: () => void,
    opts?: { danger?: boolean; active?: boolean },
  ) => {
    const Icon = icon
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 py-3 px-1 cursor-pointer border-0 text-start ${
          opts?.active ? 'bg-soft rounded-xl' : 'bg-transparent'
        }`}
      >
        <span
          className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${
            opts?.danger ? 'bg-bad-soft text-bad-text' : 'bg-soft text-primary'
          }`}
        >
          <Icon size={20} />
        </span>
        <span
          className={`type-body flex-1 ${opts?.danger ? 'text-bad-text font-semibold' : ''}`}
        >
          {label}
        </span>
        <ChevronLeft
          size={18}
          className={`text-muted ${locale === 'ar' ? '' : 'rotate-180'}`}
        />
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <Card key={g.key} className="py-2">
          <div className="type-section px-1 pb-1">{g.label}</div>
          <div className="flex flex-col divide-y divide-border">
            {g.items.map((item) => row(item.icon, item.label, () => navigate(item.path)))}
          </div>
        </Card>
      ))}
      <Card className="py-2">
        <div className="type-section px-1 pb-1">{t('shell.more.groupAccount')}</div>
        <div className="flex flex-col divide-y divide-border">
          {nursery.status === 'ready' &&
            nursery.memberships.length > 1 &&
            nursery.memberships.map((m) => (
              <div key={m.id}>
                {row(Building2, m.nursery.name, () => setActiveNurseryId(m.nursery_id), {
                  active: m.nursery_id === nursery.nurseryId,
                })}
              </div>
            ))}
          <button
            type="button"
            onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            className="flex w-full items-center gap-3 py-3 px-1 cursor-pointer bg-transparent border-0 text-start"
          >
            <span className="w-10 h-10 shrink-0 rounded-xl bg-soft text-primary flex items-center justify-center type-body font-bold">
              {locale === 'ar' ? 'EN' : t('common.langAr')}
            </span>
            <span className="type-body flex-1">{t('shell.more.language')}</span>
            <ChevronLeft size={18} className={`text-muted ${locale === 'ar' ? '' : 'rotate-180'}`} />
          </button>
          {row(LogOut, t('shell.more.signOut'), () => void signOut(), { danger: true })}
        </div>
      </Card>
    </div>
  )
}
