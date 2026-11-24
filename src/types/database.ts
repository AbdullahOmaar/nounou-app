/**
 * أنواع صفوف قاعدة بيانات نونو — منقولة من supabase/migrations/0001–0007
 * (لا أعمدة مخترعة). numeric في Postgres يصل من PostgREST كـ number عادةً.
 */

export type MemberRole = 'owner' | 'staff'
export type MemberStatus = 'invited' | 'active' | 'suspended'

export type PaymentMethod = 'cash' | 'vodafone_cash' | 'instapay' | 'bank_transfer'
export type ProofStatus = 'not_required' | 'pending' | 'approved' | 'rejected'
export type PaymentSource = 'admin' | 'portal'

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled'
export type InvoiceLineType = 'base' | 'discount' | 'adjustment' | 'bus' | 'extra'

export type EnrollmentStatus = 'active' | 'paused' | 'left'
export type PickupRelation = 'father' | 'mother' | 'grandparent' | 'driver' | 'other'

export type DayStatus = 'open' | 'closed'
export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'early_leave'
export type ArrivalMethod = 'manual' | 'qr'

export type BusDirection = 'to_nursery' | 'to_home'
export type BusEntryStatus = 'pending' | 'done' | 'absent'

export type AnnouncementAudience = 'all' | 'class'
export type Mood = 'happy' | 'calm' | 'sad' | 'tired' | 'sick'
export type MealKind = 'breakfast' | 'snack' | 'lunch'
export type AteAmount = 'all' | 'most' | 'some' | 'none'
export type MealSource = 'home' | 'nursery'

/** مفتاح صلاحية مشرفة — المالية ليست بينها إطلاقاً (للمالك فقط في RLS) */
export type PermissionKey =
  | 'can_manage_children'
  | 'can_manage_classes'
  | 'can_take_attendance'
  | 'can_manage_reports'
  | 'can_manage_photos'
  | 'can_manage_bus'
  | 'can_manage_announcements'
  | 'can_view_children'
  | 'can_review_proofs'

export type MemberPermissions = Partial<Record<PermissionKey, boolean>>

export interface UserRow {
  id: string
  display_name: string
  phone: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface NurseryRow {
  id: string
  name: string
  logo_url: string | null
  phone: string | null
  address: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface NurseryMemberRow {
  id: string
  nursery_id: string
  user_id: string | null
  invited_email: string | null
  role: MemberRole
  permissions: MemberPermissions
  status: MemberStatus
  created_at: string
  updated_at: string
}

export interface NurserySettingsRow {
  nursery_id: string
  receipt_message_template: string
  reminder_template: string
  sibling_discount_percent: number
  photo_daily_cap: number | null
  photo_retention_days: number
  pickup_code_enabled: boolean
  day_end_time: string // 'HH:MM:SS'
  theme: string // 'auto' | 'light' | 'dark'
  last_export_at: string | null
  created_at: string
  updated_at: string
}

export interface ActivityLogRow {
  id: string
  nursery_id: string
  actor_id: string | null
  kind: string
  entity_type: string | null
  entity_id: string | null
  summary: string
  meta: Record<string, unknown>
  created_at: string
}

export interface ClassRow {
  id: string
  nursery_id: string
  name: string
  monthly_fee: number
  capacity: number | null
  age_from: number | null
  age_to: number | null
  nap_enabled: boolean
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ClassStaffRow {
  class_id: string
  member_id: string
  created_at: string
}

export interface ChildRow {
  id: string
  nursery_id: string
  full_name: string
  birth_date: string | null
  gender: 'male' | 'female' | null
  photo_url: string | null
  public_code: string
  photo_consent: boolean
  notes: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface GuardianRow {
  id: string
  nursery_id: string
  full_name: string
  phone: string
  relation: string | null
  created_at: string
  updated_at: string
}

export interface GuardianChildRow {
  guardian_id: string
  child_id: string
  is_payer: boolean
  created_at: string
}

export interface PickupPersonRow {
  id: string
  nursery_id: string
  child_id: string
  full_name: string
  relation: PickupRelation
  phone: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EnrollmentRow {
  id: string
  nursery_id: string
  child_id: string
  class_id: string
  starts_on: string
  ends_on: string | null
  price_override: number | null
  status: EnrollmentStatus
  created_at: string
  updated_at: string
}

export interface InvoiceRow {
  id: string
  nursery_id: string
  child_id: string
  period: string // 'YYYY-MM'
  status: InvoiceStatus
  due_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceLineRow {
  id: string
  nursery_id: string
  invoice_id: string
  type: InvoiceLineType
  label: string
  amount: number
  created_at: string
}

export interface PaymentRow {
  id: string
  nursery_id: string
  invoice_id: string | null
  child_id: string
  amount: number
  method: PaymentMethod
  receipt_no: number | null
  paid_at: string
  proof_path: string | null
  proof_status: ProofStatus
  proof_confirmed_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  reverses_id: string | null
  reversed_by_id: string | null
  recorded_by: string | null
  source: PaymentSource
  guardian_id: string | null
  created_at: string
  updated_at: string
}

export type ExpenseCategory =
  | 'salaries'
  | 'rent'
  | 'food'
  | 'transport'
  | 'supplies'
  | 'maintenance'
  | 'other'

/** صف ‏nursery_expenses (419 — مهمة 1.2؛ مالك فقط بـRLS) */
export interface NurseryExpenseRow {
  id: string
  nursery_id: string
  period: string
  expense_date: string
  category: ExpenseCategory
  title: string
  amount: number
  note: string | null
  created_by: string | null
  created_at: string
}

export type CashboxKind = 'purchase' | 'sale' | 'misc_in' | 'misc_out'

/** صف ‏cashbox_entries (مهمة 1.3؛ مالك فقط بـRLS) */
export interface CashboxEntryRow {
  id: string
  nursery_id: string
  entry_date: string
  direction: 'in' | 'out'
  kind: CashboxKind
  title: string
  amount: number
  ref_type: string | null
  ref_id: string | null
  created_by: string | null
  created_at: string
}

/** صف ‏cashbox_closes (إقفال وردية — وثيقة تسليم) */
export interface CashboxCloseRow {
  id: string
  nursery_id: string
  shift_date: string
  expected_total: number
  counted_total: number
  difference: number
  handover_to: string
  note: string | null
  closed_by: string | null
  created_at: string
}

/** صف ‏suppliers (مهمة 1.4؛ مالك فقط بـRLS) */
export interface SupplierRow {
  id: string
  nursery_id: string
  name: string
  phone: string | null
  credit_days: number
  note: string | null
  created_by: string | null
  created_at: string
}

/** صف ‏purchase_orders */
export interface PurchaseOrderRow {
  id: string
  nursery_id: string
  supplier_id: string
  title: string
  total_amount: number
  order_date: string
  due_date: string
  created_by: string | null
  created_at: string
}

/** صف ‏supplier_payments */
export interface SupplierPaymentRow {
  id: string
  nursery_id: string
  order_id: string
  amount: number
  paid_date: string
  cashbox_entry_id: string | null
  created_by: string | null
  created_at: string
}

export type ApprovalKind =
  | 'proof_approve'
  | 'cashbox_close_diff'
  | 'invoice_cancel_paid'
  | 'expense_large'

/** صف ‏pending_approvals (مهمة 1.5؛ مالك فقط بـRLS) */
export interface PendingApprovalRow {
  id: string
  nursery_id: string
  action_kind: ApprovalKind
  payload: Record<string, unknown>
  summary: string
  requested_by: string | null
  status: 'pending' | 'approved' | 'rejected'
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

/** صف view ‏invoice_balances */
export interface InvoiceBalanceRow {
  invoice_id: string
  nursery_id: string
  child_id: string
  period: string
  status: InvoiceStatus
  total: number
  paid: number
  balance: number
}

/** صف view ‏child_balances */
export interface ChildBalanceRow {
  nursery_id: string
  child_id: string
  total_due: number
  total_paid: number
  balance: number
}

export interface ClassDayRow {
  id: string
  nursery_id: string
  class_id: string
  day_date: string
  status: DayStatus
  created_at: string
  updated_at: string
}

export interface AttendanceRow {
  id: string
  nursery_id: string
  class_day_id: string
  child_id: string
  status: AttendanceStatus
  arrived_at: string | null
  arrived_by: string | null
  arrival_method: ArrivalMethod | null
  picked_up_at: string | null
  picked_up_by: string | null
  picked_up_guardian: boolean
  picked_up_guardian_id: string | null
  handed_by: string | null
  pickup_code_used: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export interface PickupCodeRow {
  id: string
  nursery_id: string
  child_id: string
  day_date: string
  code: string
  created_at: string
}

export interface BusRouteRow {
  id: string
  nursery_id: string
  name: string
  supervisor_member_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BusDayListRow {
  id: string
  nursery_id: string
  route_id: string
  day_date: string
  direction: BusDirection
  created_at: string
}

export interface BusDayEntryRow {
  id: string
  nursery_id: string
  list_id: string
  child_id: string
  status: BusEntryStatus
  done_at: string | null
  done_by: string | null
  handed_to: string | null
  handed_to_doorstep: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface BusSubscriptionRow {
  id: string
  nursery_id: string
  child_id: string
  route_id: string
  monthly_fee: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AllergyEntry {
  name: string
  severity?: string
  notes?: string
}

export interface ChildHealthProfileRow {
  child_id: string
  nursery_id: string
  blood_type: string | null
  allergies: AllergyEntry[]
  chronic_conditions: string | null
  doctor_name: string | null
  doctor_phone: string | null
  emergency_notes: string | null
  vaccinations_note: string | null
  created_at: string
  updated_at: string
}

export interface MedicationScheduleRow {
  id: string
  nursery_id: string
  child_id: string
  medicine: string
  dose: string
  times: string[]
  starts_on: string
  ends_on: string | null
  guardian_note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MealEntry {
  meal: MealKind
  ate: AteAmount
  source: MealSource
  note?: string
}

export interface DailyReportRow {
  id: string
  nursery_id: string
  class_day_id: string
  child_id: string
  meals: MealEntry[]
  nap_from: string | null
  nap_to: string | null
  nap_slept: boolean | null
  activities: string[]
  mood: Mood | null
  note: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ChildPhotoRow {
  id: string
  nursery_id: string
  class_day_id: string | null
  storage_path: string
  taken_by: string | null
  caption: string | null
  created_at: string
}

export interface PhotoChildRow {
  photo_id: string
  child_id: string
  created_at: string
}

export interface AnnouncementRow {
  id: string
  nursery_id: string
  title: string
  body: string
  audience: AnnouncementAudience
  class_id: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface GuardianAccessTokenRow {
  id: string
  nursery_id: string
  guardian_id: string
  child_id: string | null
  token_hash: string
  label: string | null
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  created_by: string | null
  created_at: string
}
