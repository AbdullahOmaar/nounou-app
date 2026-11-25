import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarCheck2,
  ChevronRight,
  Home,
  LayoutGrid,
  Moon,
  ReceiptText,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { prefetchRoute } from '../../lib/routePrefetch'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAlertSummary } from '../../features/notifications/hooks'
import { Onboarding } from '../../features/auth/Onboarding'
import { OfflineStrip } from './OfflineStrip'
import { InstallButton } from '../InstallButton'
import { LoadingState } from '../ui/states'
import { VersionLine } from '../ui/VersionLine'
import { Mascot } from '../mascot/Mascot'
import { useT, type I18nKey } from '../../i18n'
import { useLocale } from '../../i18n/locale'

type TabKey = 'home' | 'children' | 'today' | 'invoices' | 'more'

function resolveRoute(pathname: string): {
  screen: string
  tab: TabKey
  title: I18nKey
} {
  if (pathname === '/') return { screen: 'home', tab: 'home', title: 'shell.title.home' }
  if (pathname.startsWith('/notifications'))
    return { screen: 'notifications', tab: 'home', title: 'shell.title.notifications' }
  if (pathname.startsWith('/children/'))
    return { screen: 'child', tab: 'children', title: 'shell.title.child' }
  if (pathname.startsWith('/children'))
    return { screen: 'children', tab: 'children', title: 'shell.title.children' }
  if (pathname.startsWith('/today/'))
    return { screen: 'classday', tab: 'today', title: 'shell.title.today' }
  if (pathname.startsWith('/today'))
    return { screen: 'today', tab: 'today', title: 'shell.title.today' }
  if (pathname.startsWith('/invoices/'))
    return { screen: 'invoice', tab: 'invoices', title: 'shell.title.invoice' }
  if (pathname.startsWith('/invoices'))
    return { screen: 'invoices', tab: 'invoices', title: 'shell.title.invoices' }
  if (pathname.startsWith('/proofs'))
    return { screen: 'proofs', tab: 'invoices', title: 'shell.title.proofs' }
  if (pathname.startsWith('/classes'))
    return { screen: 'classes', tab: 'more', title: 'shell.title.classes' }
  if (pathname.startsWith('/reports'))
    return { screen: 'reports', tab: 'more', title: 'shell.title.reports' }
  if (pathname.startsWith('/bus'))
    return { screen: 'bus', tab: 'more', title: 'shell.title.bus' }
  if (pathname.startsWith('/announcements'))
    return { screen: 'announcements', tab: 'more', title: 'shell.title.announcements' }
  if (pathname.startsWith('/portal-links'))
    return { screen: 'portalLinks', tab: 'more', title: 'shell.title.portalLinks' }
  if (pathname.startsWith('/finance'))
    return { screen: 'finance', tab: 'more', title: 'shell.title.finance' }
  if (pathname.startsWith('/suppliers'))
    return { screen: 'suppliers', tab: 'more', title: 'shell.title.suppliers' }
  if (pathname.startsWith('/messages'))
    return { screen: 'messages', tab: 'more', title: 'shell.title.messages' }
  if (pathname.startsWith('/qa'))
    return { screen: 'qa', tab: 'more', title: 'shell.title.qa' }
  if (pathname.startsWith('/tours'))
    return { screen: 'tours', tab: 'more', title: 'shell.title.tours' }
  if (pathname.startsWith('/events'))
    return { screen: 'events', tab: 'more', title: 'shell.title.events' }
  if (pathname.startsWith('/activity'))
    return { screen: 'activity', tab: 'more', title: 'shell.title.activity' }
  if (pathname.startsWith('/members'))
    return { screen: 'members', tab: 'more', title: 'shell.title.members' }
  if (pathname.startsWith('/settings'))
    return { screen: 'settings', tab: 'more', title: 'shell.title.settings' }
  if (pathname.startsWith('/export'))
    return { screen: 'export', tab: 'more', title: 'shell.title.export' }
  if (pathname.startsWith('/more'))
    return { screen: 'more', tab: 'more', title: 'shell.title.more' }
  return { screen: 'other', tab: 'home', title: 'shell.appName' }
}

const ROOT_SCREENS = new Set(['home', 'children', 'today', 'invoices', 'more'])

/**
 * قشرة نونو: ترويسة (رجوع/شعار + اسم الحضانة + جرس بشارة أنواع التنبيهات
 * + مظهر + حساب) وشريط سفلي بخمس وجهات. بوابة الهوية: بلا حضانة نشطة
 * تُعرض شاشة الإعداد الأول بدل المحتوى (نمط هيكل المدرس).
 */
export function AppShell() {
  const t = useT()
  const locale = useLocale()
  const location = useLocation()
  const navigate = useNavigate()
  const { mode, toggle } = useTheme()
  const [sysDark, setSysDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  const isDark = mode === 'dark' || (mode === 'auto' && sysDark)
  const nurseryRes = useCurrentNursery()
  const alerts = useAlertSummary(
    nurseryRes.status === 'ready' ? nurseryRes.nurseryId : null,
    nurseryRes.status === 'ready' ? nurseryRes.isOwner : false,
  )
  const { screen, tab, title } = resolveRoute(location.pathname)
  const isRoot = ROOT_SCREENS.has(screen)
  const containerCls = 'max-w-[640px]'
  const badgeCount = alerts.data ?? 0

  const TABS: { key: TabKey; path: string; icon: LucideIcon; label: string }[] = [
    { key: 'home', path: '/', icon: Home, label: t('shell.nav.home') },
    { key: 'children', path: '/children', icon: Users, label: t('shell.nav.children') },
    { key: 'today', path: '/today', icon: CalendarCheck2, label: t('shell.nav.today') },
    { key: 'invoices', path: '/invoices', icon: ReceiptText, label: t('shell.nav.invoices') },
    { key: 'more', path: '/more', icon: LayoutGrid, label: t('shell.nav.more') },
  ]

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-b border-border">
        <div className={`mx-auto ${containerCls} flex items-center gap-1 px-2 h-14`}>
          {!isRoot ? (
            <button
              onClick={() => navigate(-1)}
              className="w-12 h-12 shrink-0 flex items-center justify-center cursor-pointer bg-transparent border-0 text-text"
              aria-label={t('shell.back')}
            >
              <ChevronRight
                size={24}
                className={locale === 'ar' ? undefined : 'rotate-180'}
              />
            </button>
          ) : (
            <span className="w-12 h-12 shrink-0 flex items-center justify-center">
              <Mascot size={34} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="type-section truncate">{t(title)}</div>
            {nurseryRes.status === 'ready' && (
              <div className="type-badge text-muted truncate">
                {nurseryRes.nursery.name}
              </div>
            )}
          </div>
          <button
            onClick={() => navigate('/notifications')}
            onPointerDown={() => prefetchRoute('/notifications')}
            className="relative w-12 h-12 shrink-0 flex items-center justify-center cursor-pointer bg-transparent border-0 text-text"
            aria-label={t('shell.notifications')}
          >
            <Bell size={24} />
            {badgeCount > 0 && (
              <span className="absolute top-1.5 end-1.5 min-w-[18px] h-[18px] px-0.5 rounded-full bg-bad text-white text-[11px] font-bold flex items-center justify-center">
                {badgeCount}
              </span>
            )}
          </button>
          <button
            onClick={toggle}
            className="w-12 h-12 shrink-0 flex items-center justify-center cursor-pointer bg-transparent border-0 text-text"
            aria-label={t('shell.toggleTheme')}
          >
            {isDark ? <Sun size={24} /> : <Moon size={24} />}
          </button>
          <button
            onClick={() => navigate('/settings')}
            onPointerDown={() => prefetchRoute('/settings')}
            className="w-12 h-12 shrink-0 flex items-center justify-center cursor-pointer bg-transparent border-0"
            aria-label={t('shell.settings')}
          >
            <span className="w-9 h-9 rounded-full bg-primary text-on-primary font-bold flex items-center justify-center overflow-hidden">
              {t('shell.avatarFallback')}
            </span>
          </button>
        </div>
      </header>

      <OfflineStrip containerCls={containerCls} />

      <main
        className={`mx-auto ${containerCls} px-4 pt-[14px] pb-[calc(88px+env(safe-area-inset-bottom,0px))]`}
      >
        <div key={location.pathname} className="route-in">
          {nurseryRes.status === 'loading' ? (
            <LoadingState />
          ) : nurseryRes.status === 'no-nursery' ? (
            <Onboarding />
          ) : (
            <Outlet />
          )}
        </div>
        <VersionLine className="mt-6" />
      </main>

      <InstallButton />

      <nav className="fixed bottom-0 inset-x-0 z-20 bg-card border-t border-border pb-[env(safe-area-inset-bottom,0px)]">
        <div className={`mx-auto ${containerCls} flex`}>
          {TABS.map((item) => {
            const active = tab === item.key
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.path)}
                onPointerDown={() => prefetchRoute(item.path)}
                aria-current={active ? 'page' : undefined}
                className={`flex-1 min-h-[64px] py-1.5 flex flex-col items-center justify-center gap-1 border-0 bg-transparent cursor-pointer type-badge ${
                  active ? 'text-primary' : 'text-muted'
                }`}
              >
                <span
                  className={`flex items-center justify-center rounded-full px-4 py-1 ${
                    active ? 'bg-soft' : ''
                  }`}
                >
                  <Icon size={24} fill={active ? 'currentColor' : 'none'} />
                </span>
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
