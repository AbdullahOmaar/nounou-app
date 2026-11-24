import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './lib/AuthProvider'
import { registerRouteLoaders } from './lib/routePrefetch'
import { ToastProvider } from './components/ui/Toast'
import { AppShell } from './components/layout/AppShell'
import { LoadingState } from './components/ui/states'
import { HomePage } from './features/home/HomePage'
import { LoginPage } from './features/auth/LoginPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { RequireAuth } from './features/auth/RequireAuth'
import { useLocale, localeDir } from './i18n/locale'

/*
 * تقسيم المسارات (نمط المدرس): الشاشات غير الأولية كسولة في chunks
 * مستقلة. في الحزمة الأولية: القشرة + الدخول + الرئيسية فقط.
 * البوابة العامة /p/:token خارج القشرة والمصادقة تماماً (وصول بالتوكن).
 */
const ChildrenPage = lazy(() =>
  import('./features/children/ChildrenPage').then((m) => ({ default: m.ChildrenPage })),
)
const ChildDetailPage = lazy(() =>
  import('./features/children/ChildDetailPage').then((m) => ({
    default: m.ChildDetailPage,
  })),
)
const QrCardsPage = lazy(() =>
  import('./features/children/QrCardsPage').then((m) => ({ default: m.QrCardsPage })),
)
const ClassesPage = lazy(() =>
  import('./features/classes/ClassesPage').then((m) => ({ default: m.ClassesPage })),
)
const ClassDetailPage = lazy(() =>
  import('./features/classes/ClassDetailPage').then((m) => ({
    default: m.ClassDetailPage,
  })),
)
const TodayPage = lazy(() =>
  import('./features/classday/TodayPage').then((m) => ({ default: m.TodayPage })),
)
const ClassDayPage = lazy(() =>
  import('./features/classday/ClassDayPage').then((m) => ({ default: m.ClassDayPage })),
)
const InvoicesPage = lazy(() =>
  import('./features/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage })),
)
const InvoiceDetailPage = lazy(() =>
  import('./features/invoices/InvoiceDetailPage').then((m) => ({
    default: m.InvoiceDetailPage,
  })),
)
const ProofsPage = lazy(() =>
  import('./features/proofs/ProofsPage').then((m) => ({ default: m.ProofsPage })),
)
const ReportsPage = lazy(() =>
  import('./features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
)
const BusPage = lazy(() =>
  import('./features/bus/BusPage').then((m) => ({ default: m.BusPage })),
)
const AnnouncementsPage = lazy(() =>
  import('./features/announcements/AnnouncementsPage').then((m) => ({
    default: m.AnnouncementsPage,
  })),
)
const PortalLinksPage = lazy(() =>
  import('./features/portal/PortalLinksPage').then((m) => ({
    default: m.PortalLinksPage,
  })),
)
const PortalPage = lazy(() =>
  import('./features/portal/PortalPage').then((m) => ({ default: m.PortalPage })),
)
const PublicPage = lazy(() => import('./features/public/PublicPage'))
const PublicHome = lazy(() =>
  import('./features/public/PublicPage').then((m) => ({ default: m.PublicHome })),
)
const PublicClasses = lazy(() =>
  import('./features/public/PublicPage').then((m) => ({ default: m.PublicClasses })),
)
const VisitPage = lazy(() => import('./features/public/VisitPage'))
const PublicAbout = lazy(() =>
  import('./features/public/PublicPage').then((m) => ({ default: m.PublicAbout })),
)
const NotificationsPage = lazy(() =>
  import('./features/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)
const ActivityLogPage = lazy(() =>
  import('./features/activity/ActivityLogPage').then((m) => ({
    default: m.ActivityLogPage,
  })),
)
const FinancePage = lazy(() =>
  import('./features/finance/FinancePage').then((m) => ({
    default: m.FinancePage,
  })),
)
const MessagesPage = lazy(() =>
  import('./features/messages/MessagesPage').then((m) => ({
    default: m.MessagesPage,
  })),
)
const SuppliersPage = lazy(() =>
  import('./features/suppliers/SuppliersPage').then((m) => ({
    default: m.SuppliersPage,
  })),
)
const SettingsPage = lazy(() =>
  import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const MembersPage = lazy(() =>
  import('./features/settings/MembersPage').then((m) => ({ default: m.MembersPage })),
)
const ExportPage = lazy(() =>
  import('./features/settings/ExportPage').then((m) => ({ default: m.ExportPage })),
)
const MorePage = lazy(() =>
  import('./features/settings/MorePage').then((m) => ({ default: m.MorePage })),
)
const NotFoundPage = lazy(() =>
  import('./features/notfound/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)

registerRouteLoaders({
  '/children': () => import('./features/children/ChildrenPage'),
  '/today': () => import('./features/classday/TodayPage'),
  '/invoices': () => import('./features/invoices/InvoicesPage'),
  '/more': () => import('./features/settings/MorePage'),
  '/classes': () => import('./features/classes/ClassesPage'),
  '/reports': () => import('./features/reports/ReportsPage'),
  '/bus': () => import('./features/bus/BusPage'),
  '/announcements': () => import('./features/announcements/AnnouncementsPage'),
  '/portal-links': () => import('./features/portal/PortalLinksPage'),
  '/proofs': () => import('./features/proofs/ProofsPage'),
  '/activity': () => import('./features/activity/ActivityLogPage'),
  '/finance': () => import('./features/finance/FinancePage'),
  '/suppliers': () => import('./features/suppliers/SuppliersPage'),
  '/messages': () => import('./features/messages/MessagesPage'),
  '/qa': () => import('./features/qa/QaPage'),
  '/tours': () => import('./features/tours/ToursPage'),
  '/settings': () => import('./features/settings/SettingsPage'),
  '/members': () => import('./features/settings/MembersPage'),
  '/export': () => import('./features/settings/ExportPage'),
  '/notifications': () => import('./features/notifications/NotificationsPage'),
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function LocaleEffect() {
  const locale = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = localeDir(locale)
  }, [locale])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <LocaleEffect />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/n/:slug"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <PublicPage />
                  </Suspense>
                }
              >
                <Route
                  index
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <PublicHome />
                    </Suspense>
                  }
                />
                <Route
                  path="classes"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <PublicClasses />
                    </Suspense>
                  }
                />
                <Route
                  path="about"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <PublicAbout />
                    </Suspense>
                  }
                />
                <Route
                  path="visit"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <VisitPage />
                    </Suspense>
                  }
                />
              </Route>
              <Route
                path="/p/:token"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <PortalPage />
                  </Suspense>
                }
              />
              {/* جذر البوابة بلا توكن (3A-375): يقرأ جلسة الجهاز المخزنة */}
              <Route
                path="/p"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <PortalPage />
                  </Suspense>
                }
              />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route
                    path="/children"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ChildrenPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/children/:childId"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ChildDetailPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/qr-cards"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <QrCardsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/classes"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ClassesPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/classes/:classId"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ClassDetailPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/today"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <TodayPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/today/:classId"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ClassDayPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/invoices"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <InvoicesPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/invoices/:invoiceId"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <InvoiceDetailPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/proofs"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ProofsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ReportsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/bus"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <BusPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/announcements"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <AnnouncementsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/portal-links"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <PortalLinksPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/notifications"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <NotificationsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/finance"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <FinancePage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/suppliers"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <SuppliersPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/messages"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <MessagesPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/activity"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ActivityLogPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <SettingsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/members"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <MembersPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/export"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <ExportPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/more"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <MorePage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <Suspense fallback={<LoadingState />}>
                        <NotFoundPage />
                      </Suspense>
                    }
                  />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
