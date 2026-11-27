// ============================================================================
// نونو — Edge Function: photo-retention
// ----------------------------------------------------------------------------
// إنفاذ سياسة الاحتفاظ بالصور (قرار ق٨ — هجرة 0011): تُستدعى بالـ
// service role فقط، فتجمع الصور منتهية الاحتفاظ عبر
// expired_child_photos، وتحذف كل كائن تخزين من حاوية child-media عبر
// واجهة التخزين، ثم تحذف سجله عبر delete_expired_child_photo (التي
// تعيد فحص الانتهاء لحظة الحذف). الترتيب آمن عند الفشل: ملف يُحذف
// وسجله يبقى = جولة قادمة تنظّفه؛ وسجل لا يُحذف أبداً قبل نجاح حذف ملفه.
//
// التفويض (ترحيل مفاتيح Supabase — 2026-11-23): المفاتيح السرية
// الجديدة (sb_secret_*) ليست JWT، فالبوابة تعمل بـ verify_jwt=false
// والتفويض داخل الدالة نفسها: يُقبل الطلب فقط إن طابق المفتاح
// المقدَّم (رأس apikey أو Authorization: Bearer) أحد مفاتيح المشروع
// السرية من SUPABASE_SECRET_KEYS المحقونة — مقارنة ثابتة الزمن.
// المتصل المجدول (pg_cron) يرسل مفتاح Vault 'service_role_key'
// (المفتاح السري الجديد) على رأسي apikey وAuthorization (هجرة 0020).
// تاريخياً كانت البوابة verify_jwt + فكّ دور JWT — أُلغي: فكّ الدور
// بلا تحقق توقيع قابل للتزوير متى غاب verify_jwt.
//
// التشغيل: يدوياً من المشغّل (curl بقناع الخدمة) أو مجدولاً لاحقاً
// (pg_cron + pg_net أو مجدول خارجي) — انظر docs/OPERATIONS.md.
// الجسم اختياري: { "batch": 200 } بحد أقصى 10 جولات في الاستدعاء.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// مفاتيح المشروع السرية الجديدة (sb_secret_*) — تحقنها المنصة JSON
// بأسمائها في SUPABASE_SECRET_KEYS. مفتاح الإدارة هو 'default'،
// وبغيابه نرجع للمفتاح القديم المحقون (صالح حتى تعطيل القديم).
function secretKeys(): Record<string, string> {
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) out[name] = value;
    }
    return out;
  } catch {
    return {}; // بيئة بلا مفاتيح جديدة — يبقى الرجوع للقديم وحده
  }
}
const SECRET_KEYS = secretKeys();
const SERVICE_ROLE_KEY = SECRET_KEYS["default"] ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "child-media";
const MAX_ROUNDS = 10;

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

// مقارنة ثابتة الزمن (على بصمات SHA-256 حتى لا يتسرب الطول ولا
// المحتوى بزمن المقارنة).
async function keyMatches(presented: string, expected: string): Promise<boolean> {
  if (!presented || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

// بوابة الخدمة: المفتاح المقدَّم (رأس apikey أو Authorization:
// Bearer) لازم يطابق أحد مفاتيح المشروع السرية. أي شيء آخر —
// بما فيه JWT مزوّر بأي دور — مرفوض قبل أي عمل.
async function callerAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const presented = [req.headers.get("apikey") ?? "", bearer];
  for (const candidate of presented) {
    if (!candidate) continue;
    for (const expected of Object.values(SECRET_KEYS)) {
      if (await keyMatches(candidate, expected)) return true;
    }
  }
  return false;
}

interface ExpiredPhoto {
  photo_id: string;
  nursery_id: string;
  storage_path: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "not_configured" }, 500);
  }
  // بوابة الخدمة: المفتاح المقدَّم لازم يطابق أحد مفاتيح المشروع
  // السرية (SUPABASE_SECRET_KEYS) — التفويض داخل الدالة لأن البوابة
  // تعمل بـ verify_jwt=false (المفاتيح الجديدة ليست JWT).
  if (!(await callerAuthorized(req))) {
    return json({ error: "unauthorized" }, 401);
  }

  let batch = 200;
  try {
    const body = (await req.json().catch(() => ({}))) as { batch?: unknown };
    if (typeof body.batch === "number" && body.batch > 0 && body.batch <= 1000) {
      batch = Math.floor(body.batch);
    }
  } catch {
    // جسم غير صالح = الافتراضي؛ لا فشل.
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let scanned = 0;
  let deleted = 0;
  let failed = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await admin.rpc("expired_child_photos", {
      p_limit: batch,
    });
    if (error) {
      return json({ error: "rpc_failed", scanned, deleted, failed }, 500);
    }
    const photos = (data ?? []) as ExpiredPhoto[];
    if (photos.length === 0) break;
    scanned += photos.length;

    for (const photo of photos) {
      const { error: rmError } = await admin.storage
        .from(BUCKET)
        .remove([photo.storage_path]);
      if (rmError) {
        failed++;
        continue; // السجل يبقى — جولة قادمة تعيد المحاولة
      }
      const { data: gone, error: delError } = await admin.rpc(
        "delete_expired_child_photo",
        { p_photo_id: photo.photo_id },
      );
      if (delError || gone !== true) {
        failed++;
        continue;
      }
      deleted++;
    }
    if (photos.length < batch) break;
  }

  return json({ scanned, deleted, failed }, 200);
});
