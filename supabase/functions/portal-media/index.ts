// ============================================================================
// نونو — Edge Function: portal-media
// ----------------------------------------------------------------------------
// وسيط صور بوابة ولي الأمر: البوابة (زائر بلا حساب) لا تلمس التخزين
// مباشرة أبداً. هذه الدالة:
// • تستقبل { token, photo_id } من صفحة البوابة العامة.
// • تتحقق عبر RPC ‏nursery_portal_photo_path (service_role فقط) التي
//   تفرض: توكن صالح + الصورة مرتبطة بطفل هذا الوصي + موافقة تصوير
//   سارية لحظة الطلب — وتعيد مسار التخزين أو ترفض.
// • تولّد رابطاً موقّعاً قصيراً (١٥ دقيقة) بالـ service role وتعيده.
// أي فشل في أي خطوة = 403 بلا أي تسريب (لا وجود الصورة ولا سبب دقيق).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SIGNED_URL_TTL_SECONDS = 900;

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let token = "";
  let photoId = "";
  try {
    const body = (await req.json()) as { token?: unknown; photo_id?: unknown };
    token = typeof body.token === "string" ? body.token : "";
    photoId = typeof body.photo_id === "string" ? body.photo_id : "";
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!token || !photoId) return json({ error: "bad_request" }, 400);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "not_configured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: path, error: rpcError } = await admin.rpc(
    "nursery_portal_photo_path",
    { p_token: token, p_photo_id: photoId },
  );
  if (rpcError || typeof path !== "string" || !path) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: signed, error: signError } = await admin.storage
    .from("child-media")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return json({ error: "forbidden" }, 403);
  }

  return json({ url: signed.signedUrl }, 200);
});
