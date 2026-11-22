#!/usr/bin/env python3
"""
اختبارات تفويض آلية دائمة لمنتج «نونو» (إدارة الحضانات):
تتحقق حياً من عزل المستأجرين (nurseries) وصلاحيات الأعضاء وبوابة ولي الأمر
بأدوار: مالك حضانة أ / مالك حضانة ب (مستأجر آخر) / مشرفة بلا صلاحيات ثم
بكل الصلاحيات / ولي أمر عبر توكن البوابة / مجهول (anon — بلا JWT).

- تعمل على مشروع Supabase الحقيقي لكن ببيانات اختبار وهمية واضحة فقط
  (مستخدمون وحضانتان «authz fixture» يُنشؤون ويُحذفون في نفس التشغيل)،
  وتتحقق في النهاية أن عدّادات الأساس رجعت كما كانت.
- لا حساب ديمو في نونو: كل الـ fixtures تُبنى ذاتياً — المالكان يُنشئان
  حضانتيهما عبر RPC ‏create_nursery نفسه موضع الاختبار.
- تتخطى نفسها بنعومة (exit 0 + رسالة SKIP) عندما لا تتوفر بيئة الموصل
  المحلية أو .env.local — حتى يبقى `npm run check` أخضر في CI.
- كلمات مرور حسابات الاختبار وتوكنات البوابة تُولّد عشوائياً لكل تشغيل
  ولا تُطبع أبداً؛ التوكن يُخزَّن في القاعدة hash ‏SHA-256 فقط كما في 0006.

التشغيل: npm run test:authz
"""
import hashlib
import json
import os
import secrets
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.supabase/bin/supabase_api.py"
)

FAILURES = []
CHECKS = 0

ALL_PERMISSIONS = {
    "can_manage_children": True,
    "can_manage_classes": True,
    "can_take_attendance": True,
    "can_manage_reports": True,
    "can_manage_photos": True,
    "can_manage_bus": True,
    "can_manage_announcements": True,
    "can_view_children": True,
    "can_review_proofs": True,
}

# جداول المستأجر التي يجب ألا يراها/يلمسها المجهول إطلاقاً
TENANT_TABLES = [
    "nurseries", "nursery_members", "nursery_settings", "children",
    "classes", "guardians", "invoices", "invoice_lines", "payments",
    "receipt_counters", "daily_reports", "announcements", "bus_routes",
    "guardian_access_tokens",
]

FINANCE_TABLES = ["invoices", "invoice_lines", "payments", "receipt_counters"]


def check(name, cond, detail=""):
    global CHECKS
    CHECKS += 1
    if cond:
        print(f"  PASS {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


def skip(reason):
    print(f"SKIP authz tests: {reason}")
    sys.exit(0)


def load_env():
    path = os.path.join(REPO, ".env.local")
    if not os.path.exists(path):
        skip(".env.local غير موجود (بيئة CI) — الاختبارات الحية تحتاج بيئة المطوّر المحلية")
    env = {}
    for line in open(path, encoding="utf8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    url = env.get("VITE_SUPABASE_URL", "")
    anon = env.get("VITE_SUPABASE_ANON_KEY", "")
    if not url or not anon:
        skip("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ناقصة في .env.local")
    ref = url.split("//", 1)[-1].split(".", 1)[0]
    return url, anon, ref


def sql(ref, query):
    """SQL عبر Management API بواسطة أداة الموصل (بيانات اعتماد بديلة آمنة)."""
    out = subprocess.run(
        [sys.executable, HELPER, "query-inline", ref, query],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout) if out.stdout.strip() else []


def rest(url, anon, method, path, jwt=None, body=None, expect_json=True):
    """REST عبر curl — urllib ينهار أحياناً مع بروكسي الخروج (RemoteDisconnected)."""
    args = [
        "curl", "-sS", "--retry", "3", "--retry-all-errors", "--max-time", "60",
        "-X", method,
        "-H", f"apikey: {anon}",
        "-H", f"Authorization: Bearer {jwt or anon}",
        "-w", "\n%{http_code}",
    ]
    if body is not None:
        args += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    args.append(url + path)
    out = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f"curl failed: {out.stderr.strip()[:200]}")
    raw, _, code = out.stdout.rpartition("\n")
    status = int(code)
    if not raw:
        return status, {}
    if not expect_json:
        return status, raw
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, {"raw": raw[:200]}


def sign_in(url, anon, email, password):
    status, body = rest(
        url, anon, "POST", "/auth/v1/token?grant_type=password",
        body={"email": email, "password": password},
    )
    if status != 200 or "access_token" not in body:
        raise RuntimeError(f"sign-in failed for fixture user: HTTP {status}")
    return body["access_token"], body["user"]["id"]


def create_user_sql(ref, email, password):
    pw = password.replace("'", "''")
    em = email.replace("'", "''")
    rows = sql(
        ref,
        "insert into auth.users (instance_id, id, aud, role, email, "
        "encrypted_password, email_confirmed_at, raw_app_meta_data, "
        "raw_user_meta_data, created_at, updated_at, confirmation_token, "
        "email_change, email_change_token_new, recovery_token) values "
        "('00000000-0000-0000-0000-000000000000', gen_random_uuid(), "
        f"'authenticated', 'authenticated', '{em}', "
        f"crypt('{pw}', gen_salt('bf')), now(), "
        '\'{"provider":"email","providers":["email"]}\', \'{}\', now(), now(), '
        "'', '', '', '') returning id",
    )
    uid = rows[0]["id"]
    sql(
        ref,
        "insert into auth.identities (id, user_id, provider_id, identity_data, "
        "provider, last_sign_in_at, created_at, updated_at) values "
        f"(gen_random_uuid(), '{uid}', '{uid}', "
        f"jsonb_build_object('sub', '{uid}', 'email', '{em}'), 'email', "
        "now(), now(), now())",
    )
    return uid


def baseline(ref):
    rows = sql(
        ref,
        "select (select count(*) from nurseries) as nurseries, "
        "(select count(*) from nursery_members) as members, "
        "(select count(*) from children) as children, "
        "(select count(*) from invoices) as invoices, "
        "(select count(*) from payments) as payments, "
        "(select count(*) from guardian_access_tokens) as tokens, "
        "(select count(*) from auth.users) as users",
    )
    return rows[0]


def one(ref, query):
    rows = sql(ref, query)
    return rows[0] if rows else {}


def main():
    if not os.path.exists(HELPER):
        skip("أداة موصل Supabase غير موجودة في هذه البيئة")
    url, anon, ref = load_env()
    base0 = baseline(ref)
    print(f"authz tests against {ref} — baseline: {base0}")

    pw_owner_a = secrets.token_urlsafe(18)
    pw_owner_b = secrets.token_urlsafe(18)
    pw_staff = secrets.token_urlsafe(18)
    owner_a_uid = owner_b_uid = staff_uid = None
    nursery_a = nursery_b = None
    try:
        # ---------- fixtures ----------
        owner_a_uid = create_user_sql(ref, "authz-owner-a@nounou.test", pw_owner_a)
        owner_b_uid = create_user_sql(ref, "authz-owner-b@nounou.test", pw_owner_b)
        staff_uid = create_user_sql(ref, "authz-staff@nounou.test", pw_staff)
        owner_a_jwt, _ = sign_in(url, anon, "authz-owner-a@nounou.test", pw_owner_a)
        owner_b_jwt, _ = sign_in(url, anon, "authz-owner-b@nounou.test", pw_owner_b)
        staff_jwt, _ = sign_in(url, anon, "authz-staff@nounou.test", pw_staff)

        # ---------- CREATE_NURSERY RPC (0001) ----------
        print("CREATE_NURSERY:")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/create_nursery",
                    body={"p_name": "authz nursery anon"})
        check("anon cannot call create_nursery (auth required)",
              s >= 400, f"got {s} {str(b)[:120]}")
        s, nursery_a = rest(url, anon, "POST", "/rest/v1/rpc/create_nursery",
                            jwt=owner_a_jwt, body={"p_name": "authz fixture nursery A"})
        s2, nursery_b = rest(url, anon, "POST", "/rest/v1/rpc/create_nursery",
                             jwt=owner_b_jwt, body={"p_name": "authz fixture nursery B"})
        check("create_nursery returns a nursery id for each owner",
              s == 200 and s2 == 200 and bool(nursery_a) and bool(nursery_b)
              and nursery_a != nursery_b,
              f"got {s}/{s2}")
        row = one(ref, "select count(*) as c from nursery_settings "
                       f"where nursery_id = '{nursery_a}'")
        check("create_nursery creates the settings row atomically",
              int(row.get("c", 0)) == 1, f"got {row}")
        row = one(ref, "select role, status from nursery_members "
                       f"where nursery_id = '{nursery_a}' and user_id = '{owner_a_uid}'")
        check("create_nursery creates an active owner membership",
              row.get("role") == "owner" and row.get("status") == "active",
              f"got {row}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/create_nursery",
                    jwt=owner_a_jwt, body={"p_name": "   "})
        check("create_nursery rejects a blank name", s >= 400, f"got {s}")

        # بذور الحضانة أ: فصل + طفلان + وصي مرتبط بالأول فقط + تسجيل +
        # فاتورة صادرة 800 + يوم فصل + تقرير منشور + توكنات بوابة.
        a_class = one(ref,
                      "insert into classes (nursery_id, name, monthly_fee) values "
                      f"('{nursery_a}', 'authz class A', 800) returning id")["id"]
        a_child1 = one(ref,
                       "insert into children (nursery_id, full_name, photo_consent) "
                       f"values ('{nursery_a}', 'authz child A1', true) returning id")["id"]
        a_child2 = one(ref,
                       "insert into children (nursery_id, full_name) values "
                       f"('{nursery_a}', 'authz child A2') returning id")["id"]
        a_guardian = one(ref,
                         "insert into guardians (nursery_id, full_name, phone) values "
                         f"('{nursery_a}', 'authz guardian A', '01000000001') returning id")["id"]
        sql(ref, "insert into guardian_children (guardian_id, child_id, is_payer) "
                 f"values ('{a_guardian}', '{a_child1}', true)")
        sql(ref, "insert into enrollments (nursery_id, child_id, class_id) values "
                 f"('{nursery_a}', '{a_child1}', '{a_class}')")
        a_invoice = one(ref,
                        "insert into invoices (nursery_id, child_id, period, status) "
                        f"values ('{nursery_a}', '{a_child1}', '2026-11', 'issued') "
                        "returning id")["id"]
        a_line = one(ref,
                     "insert into invoice_lines (nursery_id, invoice_id, type, label, amount) "
                     f"values ('{nursery_a}', '{a_invoice}', 'base', 'authz base fee', 800) "
                     "returning id")["id"]
        a_day = one(ref,
                    "insert into class_days (nursery_id, class_id, day_date) values "
                    f"('{nursery_a}', '{a_class}', current_date) returning id")["id"]
        a_report = one(ref,
                       "insert into daily_reports (nursery_id, class_day_id, child_id, "
                       "mood, published_at) values "
                       f"('{nursery_a}', '{a_day}', '{a_child1}', 'happy', now()) "
                       "returning id")["id"]

        # توكنات البوابة: الخام يُولّد هنا ولا يُخزَّن — hash SHA-256 فقط (0006)
        raw_valid = "authz-valid-" + secrets.token_urlsafe(24)
        raw_expired = "authz-expired-" + secrets.token_urlsafe(24)
        raw_revoked = "authz-revoked-" + secrets.token_urlsafe(24)

        def token_hash(raw):
            return hashlib.sha256(raw.encode()).hexdigest()

        sql(ref, "insert into guardian_access_tokens "
                 "(nursery_id, guardian_id, token_hash, label) values "
                 f"('{nursery_a}', '{a_guardian}', '{token_hash(raw_valid)}', 'authz valid')")
        sql(ref, "insert into guardian_access_tokens "
                 "(nursery_id, guardian_id, token_hash, label, expires_at) values "
                 f"('{nursery_a}', '{a_guardian}', '{token_hash(raw_expired)}', "
                 "'authz expired', now() - interval '1 day')")
        sql(ref, "insert into guardian_access_tokens "
                 "(nursery_id, guardian_id, token_hash, label, revoked_at) values "
                 f"('{nursery_a}', '{a_guardian}', '{token_hash(raw_revoked)}', "
                 "'authz revoked', now())")

        # بذور الحضانة ب (المستأجر الآخر): طفل + فاتورة + تقرير + توكن
        b_class = one(ref,
                      "insert into classes (nursery_id, name, monthly_fee) values "
                      f"('{nursery_b}', 'authz class B', 700) returning id")["id"]
        b_child = one(ref,
                      "insert into children (nursery_id, full_name) values "
                      f"('{nursery_b}', 'authz child B1') returning id")["id"]
        b_invoice = one(ref,
                        "insert into invoices (nursery_id, child_id, period, status) "
                        f"values ('{nursery_b}', '{b_child}', '2026-11', 'issued') "
                        "returning id")["id"]
        b_day = one(ref,
                    "insert into class_days (nursery_id, class_id, day_date) values "
                    f"('{nursery_b}', '{b_class}', current_date) returning id")["id"]
        sql(ref, "insert into daily_reports (nursery_id, class_day_id, child_id, "
                 f"published_at) values ('{nursery_b}', '{b_day}', '{b_child}', now())")
        b_guardian = one(ref,
                         "insert into guardians (nursery_id, full_name, phone) values "
                         f"('{nursery_b}', 'authz guardian B', '01000000002') returning id")["id"]
        sql(ref, "insert into guardian_access_tokens "
                 "(nursery_id, guardian_id, token_hash, label) values "
                 f"('{nursery_b}', '{b_guardian}', '{token_hash('authz-b-' + secrets.token_urlsafe(24))}', "
                 "'authz B token')")

        # مشرفة في الحضانة أ بلا أي صلاحيات مبدئياً
        sql(ref, "insert into nursery_members (nursery_id, user_id, role, "
                 "permissions, status) values "
                 f"('{nursery_a}', '{staff_uid}', 'staff', '{{}}'::jsonb, 'active')")

        # ---------- ANON (بلا JWT — مفتاح anon فقط) ----------
        print("ANON:")
        for table in TENANT_TABLES:
            s, b = rest(url, anon, "GET", f"/rest/v1/{table}?select=*")
            check(f"anon reads no {table}", s == 200 and b == [],
                  f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "GET", "/rest/v1/child_balances?select=*")
        check("anon reads no child_balances", s == 200 and b == [], f"got {s}")
        s, b = rest(url, anon, "POST", "/rest/v1/children",
                    body={"nursery_id": nursery_a, "full_name": "authz intruder"})
        check("anon cannot insert a child", s in (401, 403), f"got {s}")
        s, b = rest(url, anon, "POST", "/rest/v1/invoices",
                    body={"nursery_id": nursery_a, "child_id": a_child1,
                          "period": "2027-01"})
        check("anon cannot insert an invoice", s in (401, 403), f"got {s}")

        # ---------- OWNER A (صلاحية كاملة في حضانته) ----------
        print("OWNER A:")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/nurseries?select=id&id=eq.{nursery_a}",
                    jwt=owner_a_jwt)
        check("owner reads his own nursery row",
              s == 200 and len(b) == 1, f"got {s} {str(b)[:80]}")
        admin_children = one(ref, "select count(*) as c from children "
                                  f"where nursery_id = '{nursery_a}'")["c"]
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/children?select=id&nursery_id=eq.{nursery_a}",
                    jwt=owner_a_jwt)
        check("owner reads exactly his own children",
              s == 200 and len(b) == int(admin_children),
              f"got {s} len={len(b) if isinstance(b, list) else '?'} admin={admin_children}")
        s, b = rest(url, anon, "POST", "/rest/v1/classes", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "name": "authz owner class",
                          "monthly_fee": 900})
        check("owner inserts a class", s in (200, 201), f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST", "/rest/v1/children", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "full_name": "authz owner child"})
        check("owner inserts a child", s in (200, 201), f"got {s} {str(b)[:120]}")
        owner_child = one(ref, "select id from children where nursery_id = "
                               f"'{nursery_a}' and full_name = 'authz owner child'")["id"]
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/children?id=eq.{owner_child}", jwt=owner_a_jwt,
                    body={"full_name": "authz owner child renamed"})
        after = one(ref, f"select full_name from children where id = '{owner_child}'")
        check("owner updates his child", after.get("full_name") == "authz owner child renamed",
              f"got {after}")
        s, b = rest(url, anon, "DELETE",
                    f"/rest/v1/children?id=eq.{owner_child}", jwt=owner_a_jwt)
        gone = one(ref, "select count(*) as c from children "
                        f"where id = '{owner_child}'")
        check("owner deletes his child", int(gone.get("c", 1)) == 0, f"got {gone}")
        admin_invoices = one(ref, "select count(*) as c from invoices "
                                  f"where nursery_id = '{nursery_a}'")["c"]
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/invoices?select=id&nursery_id=eq.{nursery_a}",
                    jwt=owner_a_jwt)
        check("owner reads exactly his own invoices",
              s == 200 and len(b) == int(admin_invoices),
              f"got {s} admin={admin_invoices}")
        s, b = rest(url, anon, "POST", "/rest/v1/invoices", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "child_id": a_child2,
                          "period": "2026-12", "status": "issued"})
        check("owner inserts an invoice", s in (200, 201), f"got {s} {str(b)[:120]}")
        owner_invoice = one(ref, "select id from invoices where nursery_id = "
                                 f"'{nursery_a}' and period = '2026-12'")["id"]
        s, b = rest(url, anon, "POST", "/rest/v1/invoice_lines", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "invoice_id": owner_invoice,
                          "type": "base", "label": "authz owner line", "amount": 500})
        check("owner inserts an invoice line", s in (200, 201),
              f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST", "/rest/v1/payments", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "invoice_id": a_invoice,
                          "child_id": a_child1, "amount": 100, "method": "cash"})
        check("owner inserts a cash payment", s in (200, 201),
              f"got {s} {str(b)[:120]}")
        cash_payment = one(ref, "select id from payments where nursery_id = "
                                f"'{nursery_a}' and method = 'cash'")["id"]
        admin_payments = one(ref, "select count(*) as c from payments "
                                  f"where nursery_id = '{nursery_a}'")["c"]
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/payments?select=id&nursery_id=eq.{nursery_a}",
                    jwt=owner_a_jwt)
        check("owner reads exactly his own payments",
              s == 200 and len(b) == int(admin_payments),
              f"got {s} admin={admin_payments}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/next_receipt_no",
                    jwt=owner_a_jwt, body={"p_nursery": nursery_a})
        check("owner gets a receipt number via next_receipt_no",
              s == 200 and int(b) >= 1, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/nursery_settings?select=nursery_id&nursery_id=eq.{nursery_a}",
                    jwt=owner_a_jwt)
        check("owner reads his nursery settings", s == 200 and len(b) == 1,
              f"got {s}")
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/nursery_settings?nursery_id=eq.{nursery_a}",
                    jwt=owner_a_jwt, body={"reminder_template": "authz template"})
        after = one(ref, "select reminder_template from nursery_settings "
                         f"where nursery_id = '{nursery_a}'")
        check("owner updates his nursery settings",
              after.get("reminder_template") == "authz template", f"got {after}")
        s, b = rest(url, anon, "GET",
                    "/rest/v1/child_balances?select=*"
                    f"&nursery_id=eq.{nursery_a}&child_id=eq.{a_child1}",
                    jwt=owner_a_jwt)
        check("owner sees his child's balance row (800 total, 100 cash paid)",
              s == 200 and len(b) == 1 and float(b[0]["total_due"]) == 800
              and float(b[0]["total_paid"]) == 100,
              f"got {s} {str(b)[:160]}")

        # ---------- STAFF بلا صلاحيات (عضوة فقط) ----------
        print("STAFF (no permissions):")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/children?select=id&nursery_id=eq.{nursery_a}",
                    jwt=staff_jwt)
        check("staff member reads children of her nursery",
              s == 200 and len(b) == int(admin_children), f"got {s}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/daily_reports?select=id&nursery_id=eq.{nursery_a}",
                    jwt=staff_jwt)
        check("staff member reads daily reports of her nursery",
              s == 200 and len(b) >= 1, f"got {s}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/guardian_access_tokens?select=*&nursery_id=eq.{nursery_a}",
                    jwt=staff_jwt)
        check("staff sees token rows but never a raw token (hash only)",
              s == 200 and len(b) >= 1 and raw_valid not in json.dumps(b),
              f"got {s}")
        denied_writes = [
            ("children", {"nursery_id": nursery_a, "full_name": "authz staff child"},
             "can_manage_children"),
            ("classes", {"nursery_id": nursery_a, "name": "authz staff class"},
             "can_manage_classes"),
            ("guardians", {"nursery_id": nursery_a, "full_name": "authz staff guardian",
                           "phone": "01000000099"}, "can_manage_children"),
            ("class_days", {"nursery_id": nursery_a, "class_id": a_class,
                            "day_date": "2026-11-23"}, "can_take_attendance"),
            ("attendance", {"nursery_id": nursery_a, "class_day_id": a_day,
                            "child_id": a_child2, "status": "present"},
             "can_take_attendance"),
            ("daily_reports", {"nursery_id": nursery_a, "class_day_id": a_day,
                               "child_id": a_child2, "mood": "calm"},
             "can_manage_reports"),
            ("child_photos", {"nursery_id": nursery_a,
                              "storage_path": f"{nursery_a}/authz-staff-photo.jpg"},
             "can_manage_photos"),
            ("bus_routes", {"nursery_id": nursery_a, "name": "authz staff route"},
             "can_manage_bus"),
            ("announcements", {"nursery_id": nursery_a, "title": "authz staff ann",
                               "body": "authz"}, "can_manage_announcements"),
            ("guardian_access_tokens",
             {"nursery_id": nursery_a, "guardian_id": a_guardian,
              "token_hash": "authz-staff-denied-token-hash"}, "can_manage_children"),
        ]
        for table, body, key in denied_writes:
            s, b = rest(url, anon, "POST", f"/rest/v1/{table}",
                        jwt=staff_jwt, body=body)
            check(f"staff without {key} cannot insert into {table}",
                  s in (401, 403), f"got {s} {str(b)[:80]}")

        # ---------- STAFF بكل الصلاحيات ----------
        print("STAFF (all permissions):")
        sql(ref, "update nursery_members set permissions = "
                 f"'{json.dumps(ALL_PERMISSIONS)}'::jsonb "
                 f"where nursery_id = '{nursery_a}' and user_id = '{staff_uid}'")
        allowed_writes = [
            ("children", {"nursery_id": nursery_a, "full_name": "authz staff child ok"},
             "can_manage_children"),
            ("classes", {"nursery_id": nursery_a, "name": "authz staff class ok"},
             "can_manage_classes"),
            ("daily_reports", {"nursery_id": nursery_a, "class_day_id": a_day,
                               "child_id": a_child2, "mood": "calm"},
             "can_manage_reports"),
            ("child_photos", {"nursery_id": nursery_a,
                              "storage_path": f"{nursery_a}/authz-staff-photo-ok.jpg"},
             "can_manage_photos"),
            ("bus_routes", {"nursery_id": nursery_a, "name": "authz staff route ok"},
             "can_manage_bus"),
            ("announcements", {"nursery_id": nursery_a, "title": "authz staff ann ok",
                               "body": "authz"}, "can_manage_announcements"),
        ]
        for table, body, key in allowed_writes:
            s, b = rest(url, anon, "POST", f"/rest/v1/{table}",
                        jwt=staff_jwt, body=body)
            check(f"staff with {key} can insert into {table}",
                  s in (200, 201), f"got {s} {str(b)[:120]}")
        # الحضور يحتاج يوم فصل جديداً أولاً (بنفس الصلاحية)
        s, b = rest(url, anon, "POST", "/rest/v1/class_days", jwt=staff_jwt,
                    body={"nursery_id": nursery_a, "class_id": a_class,
                          "day_date": "2026-11-23"})
        check("staff with can_take_attendance can insert a class day",
              s in (200, 201), f"got {s} {str(b)[:120]}")
        staff_day = one(ref, "select id from class_days where nursery_id = "
                             f"'{nursery_a}' and day_date = '2026-11-23'")["id"]
        s, b = rest(url, anon, "POST", "/rest/v1/attendance", jwt=staff_jwt,
                    body={"nursery_id": nursery_a, "class_day_id": staff_day,
                          "child_id": a_child1, "status": "present"})
        check("staff with can_take_attendance can insert attendance",
              s in (200, 201), f"got {s} {str(b)[:120]}")

        # ---------- STAFF × FINANCE (المال للمالك فقط — حتى بكل المفاتيح) ----------
        print("STAFF x FINANCE (owner-only even with every permission key):")
        for table in FINANCE_TABLES:
            s, b = rest(url, anon, "GET",
                        f"/rest/v1/{table}?select=*&nursery_id=eq.{nursery_a}",
                        jwt=staff_jwt)
            check(f"staff reads no {table}", s == 200 and b == [], f"got {s}")
        finance_inserts = [
            ("invoices", {"nursery_id": nursery_a, "child_id": a_child1,
                          "period": "2027-02"}),
            ("invoice_lines", {"nursery_id": nursery_a, "invoice_id": a_invoice,
                               "type": "extra", "label": "authz staff line",
                               "amount": 1}),
            ("payments", {"nursery_id": nursery_a, "child_id": a_child1,
                          "amount": 1, "method": "cash"}),
            ("receipt_counters", {"nursery_id": nursery_a, "last_no": 5}),
        ]
        for table, body in finance_inserts:
            s, b = rest(url, anon, "POST", f"/rest/v1/{table}",
                        jwt=staff_jwt, body=body)
            check(f"staff cannot insert into {table}", s in (401, 403),
                  f"got {s} {str(b)[:80]}")
        # تحديث: لا أثر فعلياً في القاعدة (RLS تُخفي الصفوف عن المشرفة)
        s, b = rest(url, anon, "PATCH", f"/rest/v1/invoices?id=eq.{a_invoice}",
                    jwt=staff_jwt, body={"notes": "authz tampered"})
        after = one(ref, f"select notes from invoices where id = '{a_invoice}'")
        check("staff cannot update an invoice", after.get("notes") is None,
              f"got {after}")
        s, b = rest(url, anon, "PATCH", f"/rest/v1/invoice_lines?id=eq.{a_line}",
                    jwt=staff_jwt, body={"label": "authz tampered"})
        after = one(ref, f"select label from invoice_lines where id = '{a_line}'")
        check("staff cannot update an invoice line",
              after.get("label") == "authz base fee", f"got {after}")
        s, b = rest(url, anon, "PATCH", f"/rest/v1/payments?id=eq.{cash_payment}",
                    jwt=staff_jwt, body={"amount": 999})
        after = one(ref, f"select amount from payments where id = '{cash_payment}'")
        check("staff cannot update a payment", float(after.get("amount", 0)) == 100,
              f"got {after}")
        counter_before = one(ref, "select last_no from receipt_counters "
                                  f"where nursery_id = '{nursery_a}'")
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/receipt_counters?nursery_id=eq.{nursery_a}",
                    jwt=staff_jwt, body={"last_no": 999})
        counter_after = one(ref, "select last_no from receipt_counters "
                                 f"where nursery_id = '{nursery_a}'")
        check("staff cannot update receipt counters",
              counter_after == counter_before, f"{counter_before} -> {counter_after}")
        # حذف: الصفوف تبقى كما هي
        finance_targets = [
            ("invoices", a_invoice), ("invoice_lines", a_line),
            ("payments", cash_payment),
        ]
        for table, row_id in finance_targets:
            s, b = rest(url, anon, "DELETE", f"/rest/v1/{table}?id=eq.{row_id}",
                        jwt=staff_jwt)
            still = one(ref, f"select count(*) as c from {table} "
                             f"where id = '{row_id}'")
            check(f"staff cannot delete from {table}",
                  int(still.get("c", 0)) == 1, f"got {still}")
        s, b = rest(url, anon, "DELETE",
                    f"/rest/v1/receipt_counters?nursery_id=eq.{nursery_a}",
                    jwt=staff_jwt)
        still = one(ref, "select count(*) as c from receipt_counters "
                         f"where nursery_id = '{nursery_a}'")
        check("staff cannot delete receipt counters",
              int(still.get("c", 0)) == 1, f"got {still}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/child_balances?select=*&nursery_id=eq.{nursery_a}",
                    jwt=staff_jwt)
        check("staff reads no child_balances rows", s == 200 and b == [],
              f"got {s} {str(b)[:80]}")

        # ---------- CROSS-TENANT (مالك ب × حضانة أ) ----------
        print("CROSS-TENANT:")
        cross_reads = [
            ("children", a_child1), ("invoices", a_invoice),
            ("daily_reports", a_report), ("guardian_access_tokens", None),
            ("payments", cash_payment),
        ]
        for table, _row_id in cross_reads:
            s, b = rest(url, anon, "GET",
                        f"/rest/v1/{table}?select=*&nursery_id=eq.{nursery_a}",
                        jwt=owner_b_jwt)
            check(f"nursery B owner reads none of A's {table}",
                  s == 200 and b == [], f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/children", jwt=owner_b_jwt,
                    body={"nursery_id": nursery_a, "full_name": "authz cross child"})
        check("nursery B owner cannot insert a child into A",
              s in (401, 403), f"got {s}")
        before = one(ref, f"select full_name from children where id = '{a_child1}'")
        s, b = rest(url, anon, "PATCH", f"/rest/v1/children?id=eq.{a_child1}",
                    jwt=owner_b_jwt, body={"full_name": "authz tampered"})
        after = one(ref, f"select full_name from children where id = '{a_child1}'")
        check("nursery B owner cannot update A's child", after == before,
              f"{before} -> {after}")
        s, b = rest(url, anon, "POST", "/rest/v1/invoices", jwt=owner_b_jwt,
                    body={"nursery_id": nursery_a, "child_id": a_child1,
                          "period": "2027-03"})
        check("nursery B owner cannot insert an invoice into A",
              s in (401, 403), f"got {s}")
        s, b = rest(url, anon, "DELETE",
                    f"/rest/v1/daily_reports?id=eq.{a_report}", jwt=owner_b_jwt)
        still = one(ref, "select count(*) as c from daily_reports "
                         f"where id = '{a_report}'")
        check("nursery B owner cannot delete A's daily report",
              int(still.get("c", 0)) == 1, f"got {still}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/children?select=id&nursery_id=eq.{nursery_b}",
                    jwt=owner_b_jwt)
        check("nursery B owner reads exactly his own children (sanity)",
              s == 200 and len(b) == 1, f"got {s}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/children?select=id&nursery_id=eq.{nursery_b}",
                    jwt=staff_jwt)
        check("staff of A reads nothing of nursery B", s == 200 and b == [],
              f"got {s}")

        # ---------- PORTAL (بوابة ولي الأمر — 0006) ----------
        print("PORTAL:")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_overview_by_token",
                    body={"p_token": raw_valid})
        kids = b.get("children") if isinstance(b, dict) else None
        check("portal overview accepts a valid token",
              s == 200 and isinstance(kids, list), f"got {s} {str(b)[:120]}")
        check("portal overview returns only the guardian's linked child",
              isinstance(kids, list) and len(kids) == 1
              and kids[0].get("id") == a_child1 and a_child2 not in json.dumps(b),
              f"got {str(b)[:160]}")
        for label, raw in [("invalid", "bogus-token-value"),
                           ("expired", raw_expired), ("revoked", raw_revoked)]:
            s, b = rest(url, anon, "POST",
                        "/rest/v1/rpc/nursery_portal_overview_by_token",
                        body={"p_token": raw})
            check(f"portal overview rejects a {label} token",
                  s >= 400, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST",
                    "/rest/v1/rpc/nursery_portal_child_day_by_token",
                    body={"p_token": raw_valid, "p_child_id": a_child1})
        check("portal child day accepts a valid token for the linked child",
              s == 200 and isinstance(b, dict) and "invoices" in b,
              f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST",
                    "/rest/v1/rpc/nursery_portal_child_day_by_token",
                    body={"p_token": raw_valid, "p_child_id": a_child2})
        check("portal child day rejects a child the guardian is not linked to",
              s >= 400, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST",
                    "/rest/v1/rpc/nursery_portal_child_day_by_token",
                    body={"p_token": "bogus-token-value", "p_child_id": a_child1})
        check("portal child day rejects an invalid token", s >= 400, f"got {s}")
        paid_before = float(one(ref, "select total_paid from child_balances "
                                     f"where child_id = '{a_child1}'")["total_paid"])
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_submit_payment",
                    body={"p_token": raw_valid, "p_child_id": a_child1,
                          "p_amount": 300, "p_method": "cash", "p_ext": "jpg"})
        check("portal payment rejects the cash method (no proof possible)",
              s >= 400, f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_submit_payment",
                    body={"p_token": raw_valid, "p_child_id": a_child1,
                          "p_amount": 300, "p_method": "instapay", "p_ext": "jpg"})
        portal_payment = b.get("payment_id") if isinstance(b, dict) else None
        check("portal payment accepts instapay and returns a server proof path",
              s == 200 and bool(portal_payment)
              and b.get("proof_path") == f"{nursery_a}/{portal_payment}.jpg",
              f"got {s} {str(b)[:160]}")
        prow = one(ref, "select proof_status, source from payments "
                        f"where id = '{portal_payment}'")
        check("portal payment is stored pending with source=portal",
              prow.get("proof_status") == "pending" and prow.get("source") == "portal",
              f"got {prow}")
        paid_mid = float(one(ref, "select total_paid from child_balances "
                                  f"where child_id = '{a_child1}'")["total_paid"])
        check("a pending portal payment does NOT count in child_balances",
              paid_mid == paid_before, f"{paid_before} -> {paid_mid}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_confirm_proof",
                    body={"p_token": "bogus-token-value",
                          "p_payment_id": portal_payment})
        check("portal confirm_proof rejects an invalid token", s >= 400,
              f"got {s}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_confirm_proof",
                    body={"p_token": raw_valid, "p_payment_id": portal_payment})
        check("portal confirm_proof accepts the payment's own guardian token",
              s in (200, 204), f"got {s} {str(b)[:80]}")
        # اعتماد المالك: اعتماد الإثبات + ربط الدفعة بفاتورة الطفل المفتوحة.
        # ملاحظة موثقة: nursery_portal_submit_payment لا يقبل invoice_id ولا
        # يربط الدفعة بأي فاتورة، فبدون ربط المالك عند المراجعة لا تدخل
        # الدفعة في child_balances أبداً حتى بعد الاعتماد (انظر تقرير التسليم).
        s, b = rest(url, anon, "PATCH", f"/rest/v1/payments?id=eq.{portal_payment}",
                    jwt=owner_a_jwt,
                    body={"proof_status": "approved", "invoice_id": a_invoice})
        prow = one(ref, "select proof_status from payments "
                        f"where id = '{portal_payment}'")
        check("owner approves the portal payment proof",
              prow.get("proof_status") == "approved", f"got {prow}")
        paid_after = float(one(ref, "select total_paid from child_balances "
                                    f"where child_id = '{a_child1}'")["total_paid"])
        check("the approved portal payment now counts in child_balances",
              paid_after == paid_before + 300, f"{paid_before} -> {paid_after}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_photo_path",
                    body={"p_token": raw_valid, "p_photo_id": a_child1})
        check("anon cannot call nursery_portal_photo_path (service_role only)",
              s in (401, 403, 404), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_photo_path",
                    jwt=owner_a_jwt,
                    body={"p_token": raw_valid, "p_photo_id": a_child1})
        check("even the owner cannot call nursery_portal_photo_path",
              s in (401, 403, 404), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/portal_token_resolve",
                    body={"p_token": raw_valid})
        check("anon cannot call the internal portal_token_resolve",
              s in (401, 403, 404), f"got {s}")
    finally:
        # ---------- cleanup ----------
        ids = [u for u in (owner_a_uid, owner_b_uid, staff_uid) if u]
        nurseries = [n for n in (nursery_a, nursery_b) if n]
        if nurseries:
            in_list = ",".join(f"'{n}'" for n in nurseries)
            # حذف الحضانة يكفي تتالياً (on delete cascade) لكل جداول المستأجر
            sql(ref, f"delete from nurseries where id in ({in_list})")
        if ids:
            in_list = ",".join(f"'{u}'" for u in ids)
            sql(ref, f"delete from auth.users where id in ({in_list})")
        base1 = baseline(ref)
        print(f"cleanup baseline: {base1}")
        check("baseline restored after cleanup", base1 == base0,
              f"{base0} -> {base1}")

    print(f"\nauthz tests: {CHECKS - len(FAILURES)}/{CHECKS} passed")
    if FAILURES:
        print("FAILED:", ", ".join(FAILURES))
        sys.exit(1)


if __name__ == "__main__":
    main()
