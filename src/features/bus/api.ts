import { requireSupabase } from '../../lib/supabase'
import type {
  BusDayEntryRow,
  BusDayListRow,
  BusDirection,
  BusRouteRow,
  BusSubscriptionRow,
  ChildRow,
} from '../../types/database'

export async function listRoutes(nurseryId: string): Promise<BusRouteRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('bus_routes')
    .select('*')
    .eq('nursery_id', nurseryId)
    .order('name')
  if (error) throw error
  return (data ?? []) as BusRouteRow[]
}

export async function saveRoute(
  nurseryId: string,
  input: { id?: string; name: string; supervisor_member_id: string | null },
): Promise<void> {
  const db = requireSupabase()
  if (input.id) {
    const { error } = await db
      .from('bus_routes')
      .update({ name: input.name, supervisor_member_id: input.supervisor_member_id })
      .eq('id', input.id)
    if (error) throw error
  } else {
    const { error } = await db.from('bus_routes').insert({
      nursery_id: nurseryId,
      name: input.name.trim(),
      supervisor_member_id: input.supervisor_member_id,
    })
    if (error) throw error
  }
}

export async function listSubscriptions(
  routeId: string,
): Promise<(BusSubscriptionRow & { childName: string })[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('bus_subscriptions')
    .select('*, child:children(full_name)')
    .eq('route_id', routeId)
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as BusSubscriptionRow & {
      child: { full_name: string } | null
    }
    return { ...r, childName: r.child?.full_name ?? '' }
  })
}

export async function saveSubscription(
  nurseryId: string,
  input: { id?: string; child_id: string; route_id: string; monthly_fee: number },
): Promise<void> {
  const db = requireSupabase()
  if (input.id) {
    const { error } = await db
      .from('bus_subscriptions')
      .update({ monthly_fee: input.monthly_fee })
      .eq('id', input.id)
    if (error) throw error
  } else {
    const { error } = await db.from('bus_subscriptions').insert({
      nursery_id: nurseryId,
      child_id: input.child_id,
      route_id: input.route_id,
      monthly_fee: input.monthly_fee,
    })
    if (error) throw error
  }
}

export async function deleteSubscription(id: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('bus_subscriptions').delete().eq('id', id)
  if (error) throw error
}

export interface BusListBundle {
  list: BusDayListRow
  entries: (BusDayEntryRow & { childName: string; pickupPersons: { id: string; full_name: string }[] })[]
}

/** قائمة يوم لخط واتجاه — تُبنى كسولاً من الاشتراكات النشطة عند أول فتح */
export async function getOrBuildDayList(
  nurseryId: string,
  routeId: string,
  date: string,
  direction: BusDirection,
): Promise<BusListBundle> {
  const db = requireSupabase()
  const { data: list, error } = await db
    .from('bus_day_lists')
    .upsert(
      { nursery_id: nurseryId, route_id: routeId, day_date: date, direction },
      { onConflict: 'route_id,day_date,direction' },
    )
    .select('*')
    .single()
  if (error) throw error
  const listRow = list as BusDayListRow

  const { data: existing, error: exErr } = await db
    .from('bus_day_entries')
    .select('id')
    .eq('list_id', listRow.id)
    .limit(1)
  if (exErr) throw exErr
  if ((existing ?? []).length === 0) {
    const subs = await listSubscriptions(routeId)
    const active = subs.filter((s) => s.is_active)
    if (active.length > 0) {
      const { error: insErr } = await db.from('bus_day_entries').insert(
        active.map((s, i) => ({
          nursery_id: nurseryId,
          list_id: listRow.id,
          child_id: s.child_id,
          sort_order: i,
        })),
      )
      if (insErr) throw insErr
    }
  }

  const { data: entries, error: eErr } = await db
    .from('bus_day_entries')
    .select('*, child:children(full_name)')
    .eq('list_id', listRow.id)
    .order('sort_order')
  if (eErr) throw eErr
  const rows = (entries ?? []).map((row) => {
    const r = row as unknown as BusDayEntryRow & {
      child: { full_name: string } | null
    }
    return { ...r, childName: r.child?.full_name ?? '', pickupPersons: [] as { id: string; full_name: string }[] }
  })
  if (direction === 'to_home' && rows.length > 0) {
    const { data: persons } = await db
      .from('pickup_persons')
      .select('id, full_name, child_id')
      .in('child_id', rows.map((r) => r.child_id))
      .eq('is_active', true)
    const byChild = new Map<string, { id: string; full_name: string }[]>()
    for (const p of persons ?? []) {
      const arr = byChild.get(p.child_id as string) ?? []
      arr.push({ id: p.id as string, full_name: p.full_name as string })
      byChild.set(p.child_id as string, arr)
    }
    for (const r of rows) r.pickupPersons = byChild.get(r.child_id) ?? []
  }
  return { list: listRow, entries: rows }
}

export async function setEntryStatus(
  entryId: string,
  status: BusDayEntryRow['status'],
  actorId: string | null,
  handedTo: string | null = null,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('bus_day_entries')
    .update({
      status,
      done_at: status === 'pending' ? null : new Date().toISOString(),
      done_by: actorId,
      handed_to: handedTo,
    })
    .eq('id', entryId)
  if (error) throw error
}

export async function listAllChildren(nurseryId: string): Promise<ChildRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('children')
    .select('*')
    .eq('nursery_id', nurseryId)
    .is('archived_at', null)
    .order('full_name')
  if (error) throw error
  return (data ?? []) as ChildRow[]
}
