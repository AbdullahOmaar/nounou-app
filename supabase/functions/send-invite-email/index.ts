// ============================================================================
// نونو — Edge Function: send-invite-email
// ----------------------------------------------------------------------------
// إرسال بريد دعوة عضو طاقم عبر Brevo (مهمة فيز 2 رقم 0.7). الدعوة نفسها
// تُنشأ من التطبيق (صف nursery_members بحالة invited — هجرة 0007)، وهذه
// الدالة ترسل الإيميل فقط، وتتحقق قبل أي إرسال من:
//   ١) المستدعي مالك فعّال في نفس الحضانة (بعميل JWT المستخدم — RLS يحكم).
//   ٢) توجد دعوة معلّقة بنفس البريد في نفس الحضانة.
// الإيميل يحمل رابط الدخول؛ إنشاء الحساب بنفس البريد «يدّعي» الدعوة تلقائياً
// (claim_nursery_invites). الأسرار: BREVO_API_KEY + BREVO_SENDER_EMAIL
// (+ BREVO_SENDER_NAME وAPP_URL اختياريان). غيابها = 503 email_not_configured
// والدعوة المحفوظة لا تتأثر (الإيميل طبقة إشعار فقط).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
const SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") ?? "نونو";
const APP_URL = Deno.env.get("APP_URL") ?? "https://nounou-app-psi.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: "not_configured" }, 500);
  if (!BREVO_API_KEY || !SENDER_EMAIL) return json({ error: "email_not_configured" }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
  const uid = userData.user.id;

  let body: { nurseryId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_body" }, 400);
  }
  const nurseryId = (body.nurseryId ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  if (!nurseryId || !email || !email.includes("@")) return json({ error: "bad_body" }, 400);

  // بوابة المالك: عضوية فعّالة بدور owner في نفس الحضانة
  const { data: mine } = await userClient
    .from("nursery_members")
    .select("id")
    .eq("nursery_id", nurseryId)
    .eq("user_id", uid)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();
  if (!mine) return json({ error: "forbidden" }, 403);

  // الدعوة المعلّقة موجودة فعلاً؟
  const { data: invite } = await userClient
    .from("nursery_members")
    .select("id")
    .eq("nursery_id", nurseryId)
    .eq("invited_email", email)
    .eq("status", "invited")
    .maybeSingle();
  if (!invite) return json({ error: "invite_not_found" }, 404);

  const { data: nursery } = await userClient
    .from("nurseries")
    .select("name")
    .eq("id", nurseryId)
    .maybeSingle();
  const nurseryName = nursery?.name ?? "حضانتك";

  const loginUrl = `${APP_URL}/login`;
  const subject = `دعوة للانضمام إلى طاقم ${nurseryName} على نونو`;
  const textContent =
    `أهلاً بك،\n\nتمت دعوتك للانضمام إلى طاقم «${nurseryName}» على تطبيق نونو لإدارة الحضانات.\n` +
    `للقبول: افتح الرابط التالي وأنشئ حسابك بنفس هذا البريد الإلكتروني (${email}) — ستُفعّل عضويتك تلقائياً عند أول دخول.\n\n${loginUrl}\n\n` +
    `لو لم تتوقع هذه الدعوة، تجاهل الرسالة.\n— فريق نونو`;
  const htmlContent =
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#1f2430">` +
    `<h2 style="margin:0 0 8px">دعوة للانضمام إلى طاقم ${escapeHtml(nurseryName)}</h2>` +
    `<p>أهلاً بك،<br>تمت دعوتك للانضمام إلى طاقم «${escapeHtml(nurseryName)}» على تطبيق <b>نونو</b> لإدارة الحضانات.</p>` +
    `<p>للقبول: أنشئ حسابك <b>بنفس هذا البريد الإلكتروني</b> (${escapeHtml(email)}) — ستُفعّل عضويتك تلقائياً عند أول دخول.</p>` +
    `<p style="margin:20px 0"><a href="${loginUrl}" style="background:#5b4bd6;color:#fff;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:bold">فتح نونو وإنشاء الحساب</a></p>` +
    `<p style="color:#666;font-size:13px">لو لم تتوقع هذه الدعوة، تجاهل الرسالة.</p></div>`;

  const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email }],
      subject,
      textContent,
      htmlContent,
    }),
  });
  if (!brevoRes.ok) {
    console.error("brevo send failed:", brevoRes.status, await brevoRes.text().catch(() => ""));
    return json({ error: "email_send_failed" }, 502);
  }
  return json({ sent: true }, 200);
});
