// ============================================================================
// نونو — Edge Function: photo-retention
// ----------------------------------------------------------------------------
// إنفاذ سياسة الاحتفاظ بالصور (قرار ق٨ — هجرة 0011): تُستدعى بالـ
// service role فقط (رأس Authorization يطابق مفتاح الخدمة نفسه)، فتجمع
// الصور منتهية الاحتفاظ عبر expired_child_photos، وتحذف كل كائن تخزين
// من حاوية child-media عبر واجهة التخزين، ثم تحذف سجله عبر
// delete_expired_child_photo (التي تعيد فحص الانتهاء لحظة الحذف).
// الترتيب آمن عند الفشل: ملف يُحذف وسجله يبقى = جولة قادمة تنظّفه؛
// وسجل لا يُحذف أبداً قبل نجاح حذف ملفه.
//
// التشغيل: يدوياً من المشغّل (curl بقناع الخدمة) أو مجدولاً لاحقاً
// (pg_cron + pg_net أو مجدول خارجي) — انظر docs/OPERATIONS.md.
// الجسم اختياري: { "batch": 200 } بحد أقصى 10 جولات في الاستدعاء.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
  // بوابة الخدمة: لا يقبل إلا حامل مفتاح الخدمة نفسه — أي JWT مستخدم
  // (مالك/مشرفة/مجهول) مرفوض هنا قبل أي عمل.
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_ROLE_KEY}`) {
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
