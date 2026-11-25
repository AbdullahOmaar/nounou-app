import { common } from './common'
import { shell } from './shell'
import { auth } from './auth'
import { format } from './format'
import { components } from './components'
import { home } from './home'
import { children } from './children'
import { classes } from './classes'
import { attendance } from './attendance'
import { invoices } from './invoices'
import { paymentProofs } from './paymentProofs'
import { portal } from './portal'
import { reports } from './reports'
import { bus } from './bus'
import { announcements } from './announcements'
import { notifications } from './notifications'
import { iso } from './iso'
import { licensing } from './licensing'
import { staff } from './staff'
import { licensingTrack } from './licensingTrack'
import { settings } from './settings'
import { activity } from './activity'
import { finance } from './finance'
import { suppliers } from './suppliers'
import { messages } from './messages'
import { qa } from './qa'
import { pub } from './pub'
import { tours } from './tours'
import { events } from './events'

/**
 * قاموس العربية — لغة نونو الأولى (والإنجليزية مرآة بنيوية كاملة في
 * ../en تُفرض بالأنواع: أي مفتاح ناقص هناك خطأ ترجمة لا نقص صامت).
 * كل namespace ملف مستقل باسم الميزة، والتجميع `as const` حتى تُشتق
 * أنواع المفاتيح من القيم نفسها.
 */
export const ar = {
  common,
  shell,
  auth,
  format,
  components,
  home,
  children,
  classes,
  attendance,
  invoices,
  paymentProofs,
  portal,
  reports,
  bus,
  announcements,
  notifications,
  settings,
  licensing,
  iso,
  staff,
  licensingTrack,
  activity,
  finance,
  suppliers,
  messages,
  qa,
  pub,
  tours,
  events,
} as const
