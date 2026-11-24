import { requireSupabase } from '../../lib/supabase'
import { logActivityAuto } from '../settings/api'

export interface QaSession {
  id: string
  title: string
  starts_at: string
  status: 'scheduled' | 'live' | 'ended'
  created_at: string
}

export interface QaQuestion {
  id: string
  body: string
  answer: string | null
  answered_at: string | null
  created_at: string
  guardianName: string
}

export async function listSessions(nurseryId: string): Promise<QaSession[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('qa_sessions')
    .select('id, title, starts_at, status, created_at')
    .eq('nursery_id', nurseryId)
    .order('starts_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data ?? []) as QaSession[]
}

export async function createSession(
  nurseryId: string,
  title: string,
  startsAtIso: string,
): Promise<void> {
  const db = requireSupabase()
  const { data: auth } = await db.auth.getUser()
  const { error } = await db.from('qa_sessions').insert({
    nursery_id: nurseryId,
    title,
    starts_at: startsAtIso,
    created_by: auth.user?.id ?? null,
  })
  if (error) throw error
  await logActivityAuto(nurseryId, 'qa_session_created', title, 'qa_session')
}

export async function setSessionStatus(
  sessionId: string,
  status: QaSession['status'],
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('qa_sessions')
    .update({ status })
    .eq('id', sessionId)
  if (error) throw error
}

export async function listQuestions(sessionId: string): Promise<QaQuestion[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('qa_questions')
    .select('id, body, answer, answered_at, created_at, guardian_id')
    .eq('session_id', sessionId)
    .order('created_at')
    .limit(200)
  if (error) throw error
  const rows = (data ?? []) as {
    id: string
    body: string
    answer: string | null
    answered_at: string | null
    created_at: string
    guardian_id: string
  }[]
  const names = new Map<string, string>()
  if (rows.length > 0) {
    const { data: gs } = await db
      .from('guardians')
      .select('id, full_name')
      .in('id', [...new Set(rows.map((r) => r.guardian_id))])
    for (const g of (gs ?? []) as { id: string; full_name: string }[]) {
      names.set(g.id, g.full_name)
    }
  }
  return rows.map((r) => ({ ...r, guardianName: names.get(r.guardian_id) ?? '' }))
}

export async function answerQuestion(
  questionId: string,
  answer: string,
): Promise<void> {
  const db = requireSupabase()
  const { data: auth } = await db.auth.getUser()
  const { error } = await db
    .from('qa_questions')
    .update({
      answer,
      answered_by: auth.user?.id ?? null,
      answered_at: new Date().toISOString(),
    })
    .eq('id', questionId)
  if (error) throw error
}
