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
import time
from datetime import date, timedelta

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
    """SQL عبر Management API بواسطة أداة الموصل (بيانات اعتماد بديلة آمنة).

    يعيد المحاولة 3 مرات بفاصل متزايد: الموصل يتعثر عابراً أحياناً
    (عطل لحظي في API الإدارة) وعطل واحد لا يجب أن يقتل تشغيلة كاملة
    — نفس نمط --retry في rest() أدناه. الفشل الدائم يرفع كالمعتاد.
    """
    last_err = ""
    for attempt in range(3):
        out = subprocess.run(
            [sys.executable, HELPER, "query-inline", ref, query],
            capture_output=True, text=True, timeout=120,
        )
        if out.returncode == 0:
            return json.loads(out.stdout) if out.stdout.strip() else []
        last_err = out.stderr.strip()[:300]
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"SQL failed: {last_err}")


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
    # مسح تحضيري (3A-395): بقايا تشغيل سابق انهار قبل التنظيف —
    # حضانات «authz fixture%» ومستخدمو «authz-%» — حتى يبدأ الأساس
    # نظيفاً وتشغيلتان متتاليتان تعدّيان 100% بلا بقايا. الديمو لا
    # يُمس: أسماؤه لا تطابق النمطين. المسح بذل جهد فقط: عطل عابر
    # في الموصل لا يقتل التشغيلة — فحص الأساس في النهاية هو الحكم.
    try:
        sql(ref, "delete from nurseries where name like 'authz fixture%'")
        sql(ref, "delete from auth.users where email like 'authz-%'")
    except RuntimeError as e:
        print(f"  WARN pre-sweep failed (continuing): {e}")
    base0 = baseline(ref)
    print(f"authz tests against {ref} — baseline: {base0}")
    # يوم فصل قسم الـ staff: غداً دائماً — لا يصطدم أبداً بيوم البذرة
    # (اليوم) ولا يتكرر عبر التشغيلات (التنظيف يمسح الحضانة كلها).
    staff_day_date = (date.today() + timedelta(days=1)).isoformat()

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
        # سلامة المال (3A-363): رقم إيصال تلقائي لكل المسارات + حارس الإلغاء
        s, b = rest(url, anon, "POST", "/rest/v1/payments", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "invoice_id": owner_invoice,
                          "child_id": a_child2, "amount": 200, "method": "cash"})
        check("owner inserts a payment on the 2026-12 invoice",
              s in (200, 201), f"got {s} {str(b)[:120]}")
        inv_payment = one(ref, "select id, receipt_no from payments where "
                               f"invoice_id = '{owner_invoice}' "
                               "and reverses_id is null")
        check("payment inserted without receipt_no gets one from the trigger",
              inv_payment.get("receipt_no") is not None
              and int(inv_payment["receipt_no"]) >= 1,
              f"got {inv_payment.get('receipt_no')}")
        s, b = rest(url, anon, "PATCH", f"/rest/v1/invoices?id=eq.{owner_invoice}",
                    jwt=owner_a_jwt, body={"status": "cancelled"})
        check("cancelling an invoice with a live payment is rejected",
              s >= 400 and "invoice_has_payments" in str(b),
              f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST", "/rest/v1/payments", jwt=owner_a_jwt,
                    body={"nursery_id": nursery_a, "invoice_id": owner_invoice,
                          "child_id": a_child2, "amount": 200, "method": "cash",
                          "reverses_id": inv_payment["id"]})
        check("owner inserts a reversal payment", s in (200, 201),
              f"got {s} {str(b)[:120]}")
        reversal = one(ref, "select id, receipt_no from payments where "
                            f"reverses_id = '{inv_payment['id']}'")
        check("reversal payment also gets a receipt number",
              reversal.get("receipt_no") is not None,
              f"got {reversal.get('receipt_no')}")
        one(ref, "update payments set reversed_by_id = "
                 f"'{reversal['id']}' where id = '{inv_payment['id']}' "
                 "returning id")
        s, b = rest(url, anon, "PATCH", f"/rest/v1/invoices?id=eq.{owner_invoice}",
                    jwt=owner_a_jwt, body={"status": "cancelled"})
        check("cancelling succeeds once the payment is reversed",
              s in (200, 204), f"got {s} {str(b)[:120]}")
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
                            "day_date": staff_day_date}, "can_take_attendance"),
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
                          "day_date": staff_day_date})
        check("staff with can_take_attendance can insert a class day",
              s in (200, 201), f"got {s} {str(b)[:120]}")
        staff_day = one(ref, "select id from class_days where nursery_id = "
                        f"'{nursery_a}' and day_date = '{staff_day_date}'")["id"]
        s, b = rest(url, anon, "POST", "/rest/v1/attendance", jwt=staff_jwt,
                    body={"nursery_id": nursery_a, "class_day_id": staff_day,
                          "child_id": a_child1, "status": "present"})
        check("staff with can_take_attendance can insert attendance",
              s in (200, 201), f"got {s} {str(b)[:120]}")

        # ---------- 3A-378: حراس السلامة (0017) ----------
        print("3A-378 GUARDS (0017):")
        # 0017 تُطبَّق حية بعد الدمج — قبلها فحوص الحراسة تفشل
        # (لا تنهار): تحقق عمود باب البيت مرة واحدة، وتحقق
        # قبول باب البيت يقرأ العمود فقط إن وُجد.
        has_0017 = int(one(ref,
                           "select count(*) as c from information_schema.columns "
                           "where table_schema = 'public' "
                           "and table_name = 'bus_day_entries' "
                           "and column_name = 'handed_to_doorstep'")["c"]) > 0
        if not has_0017:
            print("  NOTE 0017 not applied live yet — guard checks expected to fail")
        # X1: قايمة نزول + دخول معلّق + شخص استلام مصرّح
        x1_route = one(ref,
                       "insert into bus_routes (nursery_id, name) values "
                       f"('{nursery_a}', 'authz route X1') returning id")["id"]
        x1_list = one(ref,
                      "insert into bus_day_lists (nursery_id, route_id, day_date, direction) "
                      f"values ('{nursery_a}', '{x1_route}', current_date, 'to_home') "
                      "returning id")["id"]
        x1_entry = one(ref,
                       "insert into bus_day_entries (nursery_id, list_id, child_id) "
                       f"values ('{nursery_a}', '{x1_list}', '{a_child1}') returning id")["id"]
        x1_person = one(ref,
                        "insert into pickup_persons (nursery_id, child_id, full_name) "
                        f"values ('{nursery_a}', '{a_child1}', 'authz pickup') returning id")["id"]
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/bus_day_entries?id=eq.{x1_entry}", jwt=staff_jwt,
                    body={"status": "done"})
        still = one(ref, f"select status from bus_day_entries where id = '{x1_entry}'")
        check("delivery without a recipient is rejected (handed_to_required)",
              s not in (200, 204) and still.get("status") == "pending",
              f"got {s} {str(b)[:80]} / {still}")
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/bus_day_entries?id=eq.{x1_entry}", jwt=staff_jwt,
                    body={"status": "done", "handed_to_doorstep": True})
        cols = "status, handed_to_doorstep" if has_0017 else "status"
        done = one(ref, f"select {cols} from bus_day_entries "
                        f"where id = '{x1_entry}'")
        check("delivery with explicit doorstep is accepted",
              s in (200, 204) and done.get("status") == "done"
              and (done.get("handed_to_doorstep") is True if has_0017 else False),
              f"got {s} {str(b)[:80]} / {done}")
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/bus_day_entries?id=eq.{x1_entry}", jwt=staff_jwt,
                    body={"status": "pending"})
        check("delivery can be undone back to pending",
              s in (200, 204), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "PATCH",
                    f"/rest/v1/bus_day_entries?id=eq.{x1_entry}", jwt=staff_jwt,
                    body={"status": "done", "handed_to": x1_person,
                          "handed_to_doorstep": False})
        done = one(ref, f"select status, handed_to from bus_day_entries "
                        f"where id = '{x1_entry}'")
        check("delivery with a named recipient is accepted",
              s in (200, 204) and done.get("status") == "done"
              and done.get("handed_to") == x1_person,
              f"got {s} {str(b)[:80]} / {done}")
        # X2: طفل ثالث بحضور غائب — تقريره مرفوض عند المصدر
        a_child3 = one(ref,
                       "insert into children (nursery_id, full_name) values "
                       f"('{nursery_a}', 'authz child A3') returning id")["id"]
        sql(ref, "insert into attendance (nursery_id, class_day_id, child_id, status) "
                 f"values ('{nursery_a}', '{a_day}', '{a_child3}', 'absent')")
        s, b = rest(url, anon, "POST", "/rest/v1/daily_reports", jwt=staff_jwt,
                    body={"nursery_id": nursery_a, "class_day_id": a_day,
                          "child_id": a_child3, "mood": "calm"})
        gone = one(ref, "select count(*) as c from daily_reports "
                        f"where class_day_id = '{a_day}' and child_id = '{a_child3}'")
        check("report for an absent child is rejected (report_for_absent_child)",
              s not in (200, 201) and int(gone["c"]) == 0,
              f"got {s} {str(b)[:80]} / {gone}")
        # X3: ربط صورة بطفل بلا موافقة مرفوض؛ وبموافقة مقبول
        # (a_child1 موافقة true في البذرة، a_child2 بلا موافقة — الافتراضي false)
        x3_photo = one(ref,
                       "insert into child_photos (nursery_id, storage_path) "
                       f"values ('{nursery_a}', '{nursery_a}/authz-x3.jpg') "
                       "returning id")["id"]
        s, b = rest(url, anon, "POST", "/rest/v1/photo_children", jwt=staff_jwt,
                    body={"photo_id": x3_photo, "child_id": a_child2})
        gone = one(ref, "select count(*) as c from photo_children "
                        f"where photo_id = '{x3_photo}' and child_id = '{a_child2}'")
        check("photo link for a no-consent child is rejected (photo_consent_required)",
              s not in (200, 201) and int(gone["c"]) == 0,
              f"got {s} {str(b)[:80]} / {gone}")
        s, b = rest(url, anon, "POST", "/rest/v1/photo_children", jwt=staff_jwt,
                    body={"photo_id": x3_photo, "child_id": a_child1})
        check("photo link for a consenting child is accepted",
              s in (200, 201), f"got {s} {str(b)[:80]}")

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
        # عدّاد فتحات البوابة (3A-350): الاستدعاء الصالح حدّث last_used_at
        # عبر portal_token_resolve، والتوكن الملغي لم يُلمس أبداً
        valid_row = one(ref, "select last_used_at from guardian_access_tokens "
                             f"where token_hash = '{token_hash(raw_valid)}'")
        check("portal overview updates last_used_at for a valid token (3A-350)",
              valid_row.get("last_used_at") is not None,
              f"got {valid_row}")
        revoked_row = one(ref, "select last_used_at from guardian_access_tokens "
                               f"where token_hash = '{token_hash(raw_revoked)}'")
        check("rejected token never updates last_used_at (3A-350)",
              revoked_row.get("last_used_at") is None,
              f"got {revoked_row}")
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
        # إنفاذ الاحتفاظ بالصور (0011 — 3A-335): دالتا الخدمة فقط،
        # فلا المجهول ولا حتى المالك يستدعيهما من العميل أبداً.
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/expired_child_photos",
                    body={"p_limit": 1})
        check("anon cannot call expired_child_photos (service_role only)",
              s in (401, 403, 404), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/expired_child_photos",
                    jwt=owner_a_jwt, body={"p_limit": 1})
        check("even the owner cannot call expired_child_photos",
              s in (401, 403, 404), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/delete_expired_child_photo",
                    body={"p_photo_id": a_child1})
        check("anon cannot call delete_expired_child_photo (service_role only)",
              s in (401, 403, 404), f"got {s} {str(b)[:80]}")
        # استبدال رابط البوابة ذرياً (0014 — 3A-374/W1): الإصدار الجديد
        # يُلغي القديم فوراً — لا رابطان حيّان لنفس الوصي أبداً.
        raw_replaced = "authz-replaced-" + secrets.token_urlsafe(24)
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/replace_guardian_portal_token",
                    body={"p_nursery": nursery_a, "p_guardian": a_guardian,
                          "p_child": None, "p_token_hash": token_hash(raw_replaced)})
        check("anon cannot replace a portal token",
              s >= 400, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/replace_guardian_portal_token",
                    jwt=owner_a_jwt,
                    body={"p_nursery": nursery_a, "p_guardian": a_guardian,
                          "p_child": None, "p_token_hash": token_hash(raw_replaced)})
        check("owner replaces the guardian portal token via the RPC",
              s == 200, f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_overview_by_token",
                    body={"p_token": raw_valid})
        check("the replaced (old) portal token is rejected immediately",
              s >= 400, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_overview_by_token",
                    body={"p_token": raw_replaced})
        check("the replacement portal token works",
              s == 200 and isinstance(b, dict), f"got {s} {str(b)[:120]}")
        # 3A-395 بند 2: الإلغاء التعويضي لدفعة غير مؤكدة (0018 — تفشل
        # قبل تطبيقه حيةً كما في 0017؛ الدفعة اليتيمة تُمسح مع الحضانة)
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_submit_payment",
                    body={"p_token": raw_replaced, "p_child_id": a_child1,
                          "p_amount": 100, "p_method": "instapay", "p_ext": "jpg"})
        x2_pay = b.get("payment_id") if isinstance(b, dict) else None
        check("portal payment can be submitted (unconfirmed)",
              s == 200 and bool(x2_pay), f"got {s} {str(b)[:120]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_cancel_payment",
                    body={"p_token": raw_replaced, "p_payment_id": x2_pay})
        gone = one(ref, "select count(*) as c from payments "
                        f"where id = '{x2_pay}'") if x2_pay else {"c": -1}
        check("unconfirmed portal payment can be cancelled by its token",
              s in (200, 204) and int(gone["c"]) == 0, f"got {s} {str(b)[:80]} / {gone}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_cancel_payment",
                    body={"p_token": raw_replaced, "p_payment_id": x2_pay})
        check("cancelling an already-cancelled payment is rejected",
              s >= 400, f"got {s} {str(b)[:80]}")
        # 3A-375: انتهاء منزلق (0019) + جلسة ملغاة تموت
        # توكن جديد تماماً (بانتهاء افتراضي 30 يوماً — لم يُحلّ بعد)؛
        # أي resolve ناجح يجب أن يمدده إلى ما بعد الآن + 170 يوماً.
        # (لا يُعاد استخدام raw_replaced: حلّ مرتين من قبل فامتدّ أصلاً.)
        raw_slide = "authz-slide-" + secrets.token_urlsafe(24)
        sql(ref, "insert into guardian_access_tokens "
                 "(nursery_id, guardian_id, token_hash, label) values "
                 f"('{nursery_a}', '{a_guardian}', '{token_hash(raw_slide)}', 'authz slide')")
        before = one(ref,
                     "select (expires_at > now() + interval '170 days') as extended "
                     "from guardian_access_tokens "
                     f"where token_hash = '{token_hash(raw_slide)}'")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_overview_by_token",
                    body={"p_token": raw_slide})
        after = one(ref,
                    "select (expires_at > now() + interval '170 days') as extended "
                    "from guardian_access_tokens "
                    f"where token_hash = '{token_hash(raw_slide)}'")
        check("successful portal resolve slides expiry to +180 days",
              s == 200 and before.get("extended") is False
              and after.get("extended") is True,
              f"got {s} / {before} -> {after}")
        sql(ref, "update guardian_access_tokens set revoked_at = now() "
                 f"where token_hash = '{token_hash(raw_replaced)}'")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/nursery_portal_overview_by_token",
                    body={"p_token": raw_replaced})
        check("a revoked device session dies on the next call",
              s >= 400, f"got {s} {str(b)[:80]}")
        # 0.7: بوابات دالة إرسال إيميل الدعوة (لا إيميل يُرسل فعلياً في أي فحص)
        sql(ref, "insert into nursery_members "
                 "(nursery_id, user_id, invited_email, role, permissions, status) values "
                 f"('{nursery_a}', null, 'authz-invitee@nounou.test', 'staff', '{{}}', 'invited')")
        s, b = rest(url, anon, "POST", "/functions/v1/send-invite-email",
                    body={"nurseryId": nursery_a, "email": "authz-invitee@nounou.test"})
        check("invite email function rejects anonymous callers",
              s == 401, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/functions/v1/send-invite-email",
                    staff_jwt,
                    body={"nurseryId": nursery_a, "email": "authz-invitee@nounou.test"})
        check("invite email function rejects non-owner staff",
              s == 403, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/functions/v1/send-invite-email",
                    owner_a_jwt,
                    body={"nurseryId": nursery_a, "email": "authz-nobody@nounou.test"})
        check("owner calling for a non-existent invite gets 404 (no send)",
              s == 404, f"got {s} {str(b)[:80]}")

        # ---- verify_pickup_code RPC (420-U2, migration 0021) ----
        today_iso = date.today().isoformat()
        sql(ref, "insert into pickup_codes (nursery_id, child_id, day_date, code) values "
                 f"('{nursery_a}', '{a_child1}', '{today_iso}', '135790')")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/verify_pickup_code",
                    staff_jwt,
                    body={"p_nursery_id": nursery_a, "p_child_id": a_child1,
                          "p_day_date": today_iso, "p_code": "000000"})
        check("pickup code: wrong code rejected as mismatch",
              s == 200 and b.get("ok") is False and b.get("reason") == "mismatch",
              f"got {s} {str(b)[:80]}")
        fails = one(ref, "select count(*) as c from activity_log where "
                         f"nursery_id='{nursery_a}' and kind='pickup_code_failed'")
        check("pickup code: failed attempt written to activity log",
              (fails.get("c") or 0) >= 1, f"count={fails}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/verify_pickup_code",
                    staff_jwt,
                    body={"p_nursery_id": nursery_a, "p_child_id": a_child1,
                          "p_day_date": today_iso, "p_code": "135790"})
        check("pickup code: correct code verifies ok",
              s == 200 and b.get("ok") is True, f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/verify_pickup_code",
                    staff_jwt,
                    body={"p_nursery_id": nursery_a, "p_child_id": a_child1,
                          "p_day_date": today_iso, "p_code": "135790"})
        check("pickup code: second use rejected as used (single-use)",
              s == 200 and b.get("ok") is False and b.get("reason") == "used",
              f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "POST", "/rest/v1/rpc/verify_pickup_code",
                    owner_b_jwt,
                    body={"p_nursery_id": nursery_a, "p_child_id": a_child1,
                          "p_day_date": today_iso, "p_code": "135790"})
        check("pickup code: member of another nursery is forbidden",
              s >= 400, f"got {s} {str(b)[:80]}")
        # ---- nursery_expenses (419, migration 0022): owner-only finance ----
        s, b = rest(url, anon, "POST", "/rest/v1/nursery_expenses",
                    owner_a_jwt,
                    body={"nursery_id": nursery_a, "period": "2026-11",
                          "expense_date": "2026-11-15", "category": "food",
                          "title": "authz expense", "amount": 250})
        check("owner can record an expense", s in (200, 201), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/nursery_expenses?nursery_id=eq.{nursery_a}&select=id",
                    staff_jwt)
        rows = b if isinstance(b, list) else []
        check("staff cannot see expenses (owner-only RLS)",
              s == 200 and len(rows) == 0, f"got {s} rows={len(rows)}")
        s, b = rest(url, anon, "POST", "/rest/v1/nursery_expenses",
                    body={"nursery_id": nursery_a, "period": "2026-11",
                          "expense_date": "2026-11-15", "category": "food",
                          "title": "staff expense", "amount": 10})
        check("staff cannot record an expense", s >= 400, f"got {s}")

        # ---- cashbox ledger + shift close (1.3, migration 0023) ----
        s, b = rest(url, anon, "POST", "/rest/v1/cashbox_entries",
                    owner_a_jwt,
                    body={"nursery_id": nursery_a, "entry_date": "2026-11-16",
                          "direction": "out", "kind": "purchase",
                          "title": "authz purchase", "amount": 90})
        check("owner can add a cashbox entry", s in (200, 201), f"got {s} {str(b)[:80]}")
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/cashbox_entries?nursery_id=eq.{nursery_a}&select=id",
                    staff_jwt)
        rows = b if isinstance(b, list) else []
        check("staff cannot see cashbox entries (owner-only RLS)",
              s == 200 and len(rows) == 0, f"got {s} rows={len(rows)}")
        sql(ref, "insert into cashbox_closes (nursery_id, shift_date, expected_total, "
                 "counted_total, difference, handover_to) values "
                 f"('{nursery_a}', '2026-11-15', 100, 100, 0, 'authz')")
        s, b = rest(url, anon, "POST", "/rest/v1/cashbox_entries",
                    owner_a_jwt,
                    body={"nursery_id": nursery_a, "entry_date": "2026-11-15",
                          "direction": "out", "kind": "purchase",
                          "title": "frozen day entry", "amount": 10})
        check("a closed cashbox day is frozen server-side (trigger)",
              s >= 400, f"got {s}")

        # ---- suppliers ledger (1.4, migration 0026) ----
        s, b = rest(url, anon, "GET",
                    f"/rest/v1/suppliers?nursery_id=eq.{nursery_a}&select=id",
                    staff_jwt)
        rows = b if isinstance(b, list) else []
        check("staff cannot see suppliers (owner-only RLS)",
              s == 200 and len(rows) == 0, f"got {s} rows={len(rows)}")
        s, b = rest(url, anon, "POST", "/rest/v1/suppliers",
                    owner_a_jwt,
                    body={"nursery_id": nursery_a, "name": "authz supplier",
                          "credit_days": 14})
        check("owner can add a supplier", s in (200, 201), f"got {s} {str(b)[:80]}")
        sup = one(ref, "select id from suppliers where "
                       f"nursery_id='{nursery_a}' and name='authz supplier'")
        s, b = rest(url, anon, "POST", "/rest/v1/purchase_orders",
                    owner_a_jwt,
                    body={"nursery_id": nursery_a, "supplier_id": sup.get("id"),
                          "title": "authz order", "total_amount": 500,
                          "order_date": "2026-11-10", "due_date": "2026-11-24"})
        check("owner can add a purchase order", s in (200, 201),
              f"got {s} {str(b)[:80]}")
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
