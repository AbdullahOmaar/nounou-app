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
import type { Dict } from '../dict'

/**
 * English dictionary — a complete structural mirror of the Arabic
 * dictionary in ../ar, enforced by the Dict type annotation: any
 * missing key here is a compile error, never a silent gap.
 * Each namespace is its own feature file, assembled in the same
 * order as ar/index.ts.
 */
export const en: Dict = {
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
}
