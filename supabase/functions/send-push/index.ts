// ============================================================================
// نونو — Edge Function: send-push
// ----------------------------------------------------------------------------
// إفراغ صندوق إشعارات الدفع (push_outbox — هجرة 0061): يقرأ الصفوف
// queued (حد 50، الأقدم أولاً)، ويجلب توكنات FCM لكل مستخدم مستهدف
// من push_tokens، ويرسل عبر FCM HTTP v1، ثم يعلّم الصف sent/failed.
// تُستدعى كل دقيقة من pg_cron (push-outbox-minute) بمفتاح الخدمة.
// الأسرار: FCM_SERVICE_ACCOUNT (JSON حساب خدمة Firebase كاملاً —
// project_id + private_key + client_email) — غيابه = 503
// push_not_configured والصفوف تبقى queued. التوكنات الميتة (UNREGISTERED)
// تُحذف من push_tokens حتى لا تُعاد محاولتها للأبد.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FCM_SERVICE_ACCOUNT = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 5;
const BATCH = 50;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface OutboxRow {
  id: string;
  nursery_id: string;
  user_id: string;
  kind: string;
  data: Record<string, unknown>;
  attempts: number;
}

function textFor(kind: string, data: Record<string, unknown>): { title: string; body: string } {
  if (kind === "proof_submitted") {
    const amount = typeof data.amount === "number" ? ` بمبلغ ${data.amount}` : "";
    return {
      title: "إثبات دفع جديد",
      body: `وصل إثبات دفع جديد${amount} — راجعه من المدفوعات.`,
    };
  }
  // tour_requested
  const parent = typeof data.parent_name === "string" ? data.parent_name : "ولي أمر";
  const child = typeof data.child_name === "string" ? data.child_name : "طفل";
  return {
    title: "طلب جولة جديد",
    body: `${parent} طلب جولة لطفل ${child} — تواصل معه.`,
  };
}

async function fcmAccessToken(sa: {
  project_id: string;
  private_key: string;
  client_email: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const body = await res.json() as { access_token?: string };
  if (!body.access_token) throw new Error("token exchange: no access_token");
  return body.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "not_configured" }, 500);
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  if (!FCM_SERVICE_ACCOUNT) return json({ error: "push_not_configured" }, 503);

  let sa: { project_id: string; private_key: string; client_email: string };
  try {
    sa = JSON.parse(FCM_SERVICE_ACCOUNT);
    if (!sa.project_id || !sa.private_key || !sa.client_email) {
      return json({ error: "push_not_configured" }, 503);
    }
  } catch {
    return json({ error: "push_not_configured" }, 503);
  }

  let accessToken: string;
  try {
    accessToken = await fcmAccessToken(sa);
  } catch (e) {
    console.error("send-push: FCM token exchange failed", e);
    return json({ error: "fcm_auth_failed" }, 502);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error: rowsErr } = await db
    .from("push_outbox")
    .select("id, nursery_id, user_id, kind, data, attempts")
    .eq("status", "queued")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (rowsErr) {
    console.error("send-push: outbox read failed", rowsErr);
    return json({ error: "outbox_read_failed" }, 500);
  }

  let sent = 0;
  let failed = 0;
  for (const row of (rows ?? []) as OutboxRow[]) {
    const { data: tokens, error: tokErr } = await db
      .from("push_tokens")
      .select("id, token")
      .eq("nursery_id", row.nursery_id)
      .eq("user_id", row.user_id);
    if (tokErr) {
      console.error("send-push: tokens read failed", row.id, tokErr);
      await db.from("push_outbox").update({
        attempts: row.attempts + 1,
        status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "queued",
      }).eq("id", row.id);
      failed++;
      continue;
    }
    if (!tokens || tokens.length === 0) {
      // المستخدم بلا جهاز مسجّل — لا شيء يُعاد محاولته
      await db.from("push_outbox").update({
        attempts: row.attempts + 1,
        status: "failed",
      }).eq("id", row.id);
      failed++;
      continue;
    }
    const { title, body } = textFor(row.kind, row.data ?? {});
    const dataStrings: Record<string, string> = { kind: row.kind };
    for (const [k, v] of Object.entries(row.data ?? {})) {
      dataStrings[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    let okCount = 0;
    let transient = false;
    for (const t of tokens as { id: string; token: string }[]) {
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: t.token,
                notification: { title, body },
                data: dataStrings,
              },
            }),
          },
        );
        if (res.ok) {
          okCount++;
          await db.from("push_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
        } else {
          const errBody = await res.json().catch(() => ({})) as {
            error?: { status?: string; message?: string };
          };
          const status = errBody.error?.status ?? "";
          if (status === "NOT_FOUND" || status === "INVALID_ARGUMENT") {
            // توكن ميت — احذفه حتى لا يُعاد إرساله للأبد
            await db.from("push_tokens").delete().eq("id", t.id);
          } else {
            transient = true;
          }
        }
      } catch (e) {
        console.error("send-push: FCM send failed", row.id, e);
        transient = true;
      }
    }
    if (okCount > 0 && !transient) {
      await db.from("push_outbox").update({
        attempts: row.attempts + 1,
        status: "sent",
        sent_at: new Date().toISOString(),
      }).eq("id", row.id);
      sent++;
    } else if (okCount > 0) {
      // وُصل لبعض الأجهزة — يُعاد للباقي في الدورة التالية
      await db.from("push_outbox").update({
        attempts: row.attempts + 1,
        status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "queued",
      }).eq("id", row.id);
      sent++;
    } else {
      await db.from("push_outbox").update({
        attempts: row.attempts + 1,
        status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "queued",
      }).eq("id", row.id);
      failed++;
    }
  }
  return json({ processed: (rows ?? []).length, sent, failed }, 200);
});
