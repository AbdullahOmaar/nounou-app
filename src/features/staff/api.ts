import { requireSupabase } from '../../lib/supabase'
import type {
  NurseryMemberRow,
  StaffAttendanceRow,
  StaffPayrollRow,
  StaffProfileRow,
} from '../../types/database'

export type StaffStatus = StaffAttendanceRow['status']

export async function listActiveMembers(
  nurseryId: string,
): Promise<NurseryMemberRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_members')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('status', 'active')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as NurseryMemberRow[]
}

export async function listStaffProfiles(
  nurseryId: string,
): Promise<StaffProfileRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('staff_profiles')
    .select('*')
    .eq('nursery_id', nurseryId)
  if (error) throw error
  return (data ?? []) as StaffProfileRow[]
}

export async function upsertStaffProfile(
  nurseryId: string,
  memberId: string,
  monthlySalary: number,
  jobTitle: string | null,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('staff_profiles').upsert(
    {
      nursery_id: nurseryId,
      member_id: memberId,
      monthly_salary: monthlySalary,
      job_title: jobTitle,
    },
    { onConflict: 'nursery_id,member_id' },
  )
  if (error) throw error
}

export async function listStaffAttendance(
  nurseryId: string,
  day: string,
): Promise<StaffAttendanceRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('staff_attendance')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('day', day)
  if (error) throw error
  return (data ?? []) as StaffAttendanceRow[]
}

export async function setStaffAttendance(
  nurseryId: string,
  memberId: string,
  day: string,
  status: StaffStatus,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('staff_attendance').upsert(
    { nursery_id: nurseryId, member_id: memberId, day, status },
    { onConflict: 'nursery_id,member_id,day' },
  )
  if (error) throw error
}

export async function listStaffPayroll(
  nurseryId: string,
  period: string,
): Promise<StaffPayrollRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('staff_payroll')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('period', period)
  if (error) throw error
  return (data ?? []) as StaffPayrollRow[]
}

export async function payStaffSalary(
  nurseryId: string,
  memberId: string,
  period: string,
): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('pay_staff_salary', {
    p_nursery: nurseryId,
    p_member: memberId,
    p_period: period,
  })
  if (error) throw error
  return Number(data)
}
