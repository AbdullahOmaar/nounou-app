#!/usr/bin/env python3
"""تدريب استعادة نونو (3A-347) — تصدير منطقي ← استعادة محلية معزولة ← تحقق ← تنظيف.

الهدف (قرار المدير 2026-11-23): إثبات أن سكربت الاستعادة يعمل ضد
مخطط نونو نفسه، على قاعدة Postgres محلية مؤقتة — **ممنوع تماماً
ضد مشروع الإنتاج**.

المسار:
  1. لقطة أساس من المشروع الحي (قراءة فقط — SELECTs فقط، بلا أي كتابة):
     عدد صفوف كل جدول عام + auth.users + storage.objects، وأرصدة
     invoice_balances / child_balances، وفحوص أيتام صريحة.
  2. تصدير منطقي عبر Management API (query-inline): كل جدول عام
     كصفوف JSON + هوية auth.users (id/email/created_at فقط) +
     بيانات storage.objects الوصفية فقط.
  3. قاعدة محلية مؤقتة `nounou_drill_<ts>`: مخطط auth/storage
     مصغّر + أدوار anon/authenticated/service_role + دالة auth.uid
     الصورية، ثم تطبيق الهجرات 0001–0019 من git عبر psql مع تخطٍّ
     صريح ومُسجَّل لبيانات Supabase فقط (pg_cron/pg_net وجدولة cron)
     — المشروع الحي لا يُمسّ أبداً إلا عبر run_migration.py.
  4. تحميل البيانات (وضع replica أثناء التحميل — نفس سلوك pg_restore
     القياسي) ثم تحقق: الأعداد والأرصدة والأيتام مطابقة للمصدر تماماً.
  5. تنظيف: حذف القاعدة المؤقتة + ملف التفريغ + إعادة التحقق أن
     أساس المصدر لم يتغير. حكم GO/NO-GO مطبوع.

الحدود الموثقة (ليست فشلاً صامتاً):
  - بيانات اعتماد Auth (hashes/tokens) ليست جزءاً من هذا التصدير
    المنطقي — استعادة Auth الحقيقية تتم عبر تصدير Supabase نفسه؛
    التدريب يستعيد صفوف الهوية فقط (ما تحتاجه مفاتيح FK).
  - ملفات التخزين (blobs) لا تُستعاد محلياً — لا خدمة Storage هنا؛
    تُستعاد بيانات objects الوصفية فقط. تغطية الـblobs تتطلب هدفاً
    سحابياً (البديل الاحتياطي في 3A-347).
  - ملف التفريغ يحوي بيانات ديمو + هواتف أولياء — يعيش في /tmp
    ويُحذف في النهاية دائماً؛ لا يُلتزم في git أبداً.

الاستخدام:  python3 scripts/restore_drill.py [--keep]
  --keep: يُبقي القاعدة المؤقتة وملف التفريغ للفحص اليدوي.
الخروج: 0 = GO، 1 = NO-GO، 2 = عطل بيئة (لا Postgres محلي مثلاً).
"""

import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from decimal import Decimal

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.supabase/bin/supabase_api.py")
MIGRATIONS = os.path.join(REPO, "supabase", "migrations")
DRILL_PREFIX = "nounou_drill_"

# بيانات Supabase فقط — تُتخطى صراحةً عند تطبيق الهجرات محلياً.
SKIP_PREFIXES = (
    "create extension if not exists pg_cron",
    "create extension if not exists pg_net",
)
SKIP_SUBSTRINGS = ("cron.schedule(", "cron.unschedule(")

# فحوص أيتام صريحة (تُشغَّل على المصدر والهدف معاً — يجب أن تتطابق).
ORPHAN_CHECKS = {
    "payments without invoice":
        "select count(*) from public.payments p where p.invoice_id is not null "
        "and not exists (select 1 from public.invoices i where i.id = p.invoice_id)",
    "payments without child":
        "select count(*) from public.payments p where p.child_id is not null "
        "and not exists (select 1 from public.children c where c.id = p.child_id)",
    "invoice_lines without invoice":
        "select count(*) from public.invoice_lines l where not exists "
        "(select 1 from public.invoices i where i.id = l.invoice_id)",
    "guardian_children without guardian/child":
        "select count(*) from public.guardian_children gc where not exists "
        "(select 1 from public.guardians g where g.id = gc.guardian_id) "
        "or not exists (select 1 from public.children c where c.id = gc.child_id)",
    "photo_children without photo/child":
        "select count(*) from public.photo_children pc where not exists "
        "(select 1 from public.child_photos p where p.id = pc.photo_id) "
        "or not exists (select 1 from public.children c where c.id = pc.child_id)",
    "bus_day_entries without list/child":
        "select count(*) from public.bus_day_entries e where not exists "
        "(select 1 from public.bus_day_lists l where l.id = e.list_id) "
        "or not exists (select 1 from public.children c where c.id = e.child_id)",
    "daily_reports without child":
        "select count(*) from public.daily_reports r where not exists "
        "(select 1 from public.children c where c.id = r.child_id)",
    "attendance without child":
        "select count(*) from public.attendance a where not exists "
        "(select 1 from public.children c where c.id = a.child_id)",
    "enrollments without child/class":
        "select count(*) from public.enrollments e where not exists "
        "(select 1 from public.children c where c.id = e.child_id) "
        "or not exists (select 1 from public.classes cl where cl.id = e.class_id)",
    "pickup_codes without child":
        "select count(*) from public.pickup_codes pc where not exists "
        "(select 1 from public.children c where c.id = pc.child_id)",
    "class_days without class":
        "select count(*) from public.class_days d where not exists "
        "(select 1 from public.classes cl where cl.id = d.class_id)",
}


def write_file(path, content):
    """اكتب ملفاً بصلاحيات قراءة للجميع: ملفات التدريب تُقرأ من
    مستخدم postgres في النظام، وumask الجذر قد يجعلها 0600 فيموت
    psql بـ Permission denied (درس أول تشغيلة 2026-11-23)."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    os.chmod(path, 0o644)


def log(msg):
    print(f"[drill] {msg}", flush=True)


def fail(msg):
    print(f"[drill] FAIL: {msg}", flush=True)
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# المصدر الحي (قراءة فقط)
# ---------------------------------------------------------------------------
def env():
    path = os.path.join(REPO, ".env.local")
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip()
    url = out.get("VITE_SUPABASE_URL", "")
    if not url:
        fail("VITE_SUPABASE_URL ناقصة في .env.local")
    ref = url.split("//", 1)[-1].split(".", 1)[0]
    return ref


def sql_live(ref, query):
    """SELECT عبر Management API — مع إعادة محاولة عند عطل عابر."""
    last_err = ""
    for attempt in range(3):
        out = subprocess.run(
            [sys.executable, HELPER, "query-inline", ref, query],
            capture_output=True, text=True, timeout=180,
        )
        if out.returncode == 0:
            return json.loads(out.stdout) if out.stdout.strip() else []
        last_err = out.stderr.strip()[:300]
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"live SQL failed: {last_err}")


def live_one(ref, query):
    rows = sql_live(ref, query)
    return rows[0] if rows else {}


# ---------------------------------------------------------------------------
# Postgres المحلي (عبر مستخدم postgres في النظام)
# ---------------------------------------------------------------------------
def psql(db, sql_text=None, sql_file=None, expect_output=False):
    """تشغيل psql محلياً كمستخدم postgres. يرفع RuntimeError عند الفشل."""
    import shlex
    cmd = "psql -v ON_ERROR_STOP=1 -q"
    if db:
        cmd += f" -d {shlex.quote(db)}"
    if sql_file:
        cmd += f" -f {shlex.quote(sql_file)}"
    if expect_output:
        cmd += " -t -A -F '\t'"
    out = subprocess.run(
        ["su", "postgres", "-c", cmd],
        input=sql_text, capture_output=True, text=True, timeout=300,
    )
    if out.returncode != 0:
        raise RuntimeError(f"psql failed: {out.stderr.strip()[:500]}")
    return out.stdout.strip() if expect_output else ""


def psql_query(db, query):
    out = psql(db, sql_text=query, expect_output=True)
    lines = [ln for ln in out.splitlines() if ln.strip()]
    return lines


def psql_count(db, query):
    lines = psql_query(db, query)
    return int(lines[0].strip()) if lines else 0


# ---------------------------------------------------------------------------
# تقسيم الهجرات (واعٍ لاقتباس الدولار $$) + تخطي بيانات Supabase
# ---------------------------------------------------------------------------
def _strip_comment_lines(stmt):
    """أزل سطور التعليق الكاملة `-- ...` من أول البيان (تبقى SQL)."""
    lines = [ln for ln in stmt.splitlines()
             if not ln.strip().startswith("--")]
    return "\n".join(lines).strip()


def split_statements(text):
    """قسّم نص SQL إلى بيانات على حدود `;` خارج أي اقتباس دولار
    وسلسلة نصية (مع معالجة `''` المهرّبة داخل السلاسل)."""
    stmts, cur, i, n = [], [], 0, len(text)
    tag = None
    while i < n:
        if tag is None and text[i] == "$":
            m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[i:])
            if m:
                tag = m.group(0)
                cur.append(tag)
                i += len(tag)
                continue
        if tag is not None:
            if text.startswith(tag, i):
                cur.append(tag)
                i += len(tag)
                tag = None
                continue
            cur.append(text[i])
            i += 1
            continue
        if text[i] == "'":
            # سلسلة نصية: '' داخلها اقتباس مهرّب لا إغلاق
            j = i + 1
            buf = ["'"]
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        buf.append("''")
                        j += 2
                        continue
                    buf.append("'")
                    j += 1
                    break
                buf.append(text[j])
                j += 1
            cur.append("".join(buf))
            i = j
            continue
        if text[i] == ";":
            cur.append(";")
            stmts.append("".join(cur))
            cur = []
            i += 1
            continue
        cur.append(text[i])
        i += 1
    tail = "".join(cur).strip()
    if tail:
        stmts.append(tail)
    return [s for s in (_strip_comment_lines(s) for s in stmts) if s]


def is_skipped(stmt):
    norm = re.sub(r"\s+", " ", stmt.strip().lower())
    if norm.startswith(SKIP_PREFIXES):
        return True
    return any(s in norm for s in SKIP_SUBSTRINGS)


# ---------------------------------------------------------------------------
# تحويل قيم JSON إلى حرفيات SQL
# ---------------------------------------------------------------------------
def lit(value, pgtype, udt_name=""):
    if value is None:
        return "NULL"
    if pgtype in ("boolean",):
        return "true" if value else "false"
    if pgtype in ("integer", "bigint", "smallint", "numeric", "decimal",
                  "real", "double precision"):
        return str(value)
    if pgtype in ("json", "jsonb"):
        return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + f"'::{pgtype}"
    if udt_name.startswith("_"):
        # عمود مصفوفة: udt_name ‎_text‎ مثلاً — data_type تقول ARRAY فقط
        base = udt_name[1:]
        if base in ("int2", "int4", "int8", "numeric", "float4", "float8"):
            elems = ", ".join(str(e) for e in value)
        elif base == "bool":
            elems = ", ".join("true" if e else "false" for e in value)
        elif base in ("text", "varchar", "uuid", "date", "time",
                      "timestamp", "timestamptz"):
            elems = ", ".join("'" + str(e).replace("'", "''") + "'"
                             for e in value)
        else:
            raise ValueError(f"unsupported array base type {udt_name}")
        return f"ARRAY[{elems}]::{base}[]"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    keep = "--keep" in sys.argv
    ref = env()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    db = f"{DRILL_PREFIX}{stamp}"
    workdir = tempfile.mkdtemp(prefix="nounou-drill-")
    os.chmod(workdir, 0o755)
    dump_path = os.path.join(workdir, "dump.sql")
    log(f"source ref={ref} target db={db} workdir={workdir}")
    verdict = "NO-GO"
    src_counts = {}
    try:
        # -- 0. فحوص بيئة ------------------------------------------------
        try:
            psql(None, sql_text="select 1;")
        except RuntimeError as e:
            fail(f"لا Postgres محلي يعمل ({e}) — البديل الاحتياطي في 3A-347: "
                 "مشروع Supabase مجاني مؤقت يُحذف بعد التدريب")
        # -- 1. لقطة أساس المصدر ----------------------------------------
        log("phase 1: source baseline snapshot (read-only)")
        tables = [r["table_name"] for r in sql_live(
            ref, "select table_name from information_schema.tables "
                 "where table_schema='public' and table_type='BASE TABLE' order by 1")]
        cols = {}
        for t in tables:
            cols[t] = [(r["column_name"], r["data_type"], r["udt_name"])
                       for r in sql_live(
                ref, "select column_name, data_type, udt_name "
                     "from information_schema.columns "
                     f"where table_schema='public' and table_name='{t}' "
                     "order by ordinal_position")]
        src_counts = {t: int(live_one(
            ref, f"select count(*) as n from public.{t}")["n"]) for t in tables}
        src_users = int(live_one(ref, "select count(*) as n from auth.users")["n"])
        src_objects = int(live_one(
            ref, "select count(*) as n from storage.objects")["n"])
        src_inv_bal = live_one(
            ref, "select coalesce(sum(balance),0) as s from public.invoice_balances")["s"]
        src_child_bal = live_one(
            ref, "select coalesce(sum(balance),0) as s from public.child_balances")["s"]
        src_orphans = {k: int(live_one(ref, f"select ({q}) as n")["n"])
                       for k, q in ORPHAN_CHECKS.items()}
        log(f"baseline: {len(tables)} tables, {sum(src_counts.values())} rows, "
            f"{src_users} auth users, {src_objects} storage objects, "
            f"invoice balance={src_inv_bal}, child balance={src_child_bal}, "
            f"orphans={sum(src_orphans.values())}")

        # -- 2. التصدير المنطقي ------------------------------------------
        log("phase 2: logical export via Management API")
        rows_total = 0
        parts = ["-- nounou restore drill dump — local scratch only, "
                 "deleted by the drill. DO NOT COMMIT.\n",
                 "SET session_replication_role = replica;\n"]
        for t in tables:
            rows = sql_live(ref, f"select * from public.{t}")
            if not rows:
                continue
            colnames = [c for c, _, _ in cols[t]]
            types = {c: (dt, udt) for c, dt, udt in cols[t]}
            for i in range(0, len(rows), 200):
                batch = rows[i:i + 200]
                vals = []
                for r in batch:
                    vals.append("(" + ", ".join(
                        lit(r.get(c), types[c][0], types[c][1])
                        for c in colnames) + ")")
                parts.append(
                    f"insert into public.{t} ({', '.join(colnames)}) values "
                    + ", ".join(vals) + ";\n")
            rows_total += len(rows)
        # هوية Auth فقط (بلا hashes/tokens — انظر رأس الملف)
        users = sql_live(ref, "select id, email, created_at from auth.users")
        for u in users:
            parts.append(
                "insert into auth.users (id, email, created_at) values ("
                f"{lit(u['id'], 'uuid')}, {lit(u.get('email'), 'text')}, "
                f"{lit(u.get('created_at'), 'timestamptz')});\n")
        objs = sql_live(
            ref, "select id, bucket_id, name, owner, created_at from storage.objects")
        for o in objs:
            parts.append(
                "insert into storage.objects (id, bucket_id, name, owner, created_at) "
                f"values ({lit(o['id'], 'uuid')}, {lit(o.get('bucket_id'), 'text')}, "
                f"{lit(o.get('name'), 'text')}, {lit(o.get('owner'), 'uuid')}, "
                f"{lit(o.get('created_at'), 'timestamptz')});\n")
        parts.append("SET session_replication_role = DEFAULT;\n")
        write_file(dump_path, "".join(parts))
        log(f"exported {rows_total} public rows + {len(users)} auth identities "
            f"+ {len(objs)} storage objects -> {dump_path}")

        # -- 3. بناء الهدف المحلي ----------------------------------------
        log("phase 3: build local target (schema + migrations)")
        psql(None, sql_text=f'create database "{db}";')
        setup = os.path.join(workdir, "setup.sql")
        write_file(setup,
            "create schema auth;\n"
            "create table auth.users (id uuid primary key, email text, "
            "created_at timestamptz);\n"
            "create or replace function auth.uid() returns uuid language sql "
            "stable as $$ select null::uuid $$;\n"
            "create schema storage;\n"
            "create table storage.objects (id uuid primary key, bucket_id text, "
            "name text, owner uuid, created_at timestamptz);\n"
            "-- 0001 يزرع الدلاء في storage.buckets (الأعمدة من نص الـINSERT نفسه)\n"
            "create table storage.buckets (id text primary key, name text, "
            "public boolean, file_size_limit bigint, allowed_mime_types text[]);\n"
            "-- بديل محلي لدالة Supabase storage.foldername (تُستخدم في سياسات "
            "0008 فقط — السياسات لا تُقيَّم في التدريب؛ المالك المحلي يتجاوز RLS)\n"
            "create or replace function storage.foldername(text) returns text[] "
            "language sql immutable as $$ select string_to_array($1, '/') $$;\n"
            "do $$ begin "
            "if not exists (select 1 from pg_roles where rolname='anon') then "
            "create role anon nologin; end if; "
            "if not exists (select 1 from pg_roles where rolname='authenticated') then "
            "create role authenticated nologin; end if; "
            "if not exists (select 1 from pg_roles where rolname='service_role') then "
            "create role service_role nologin; end if; end $$;\n")
        psql(db, sql_file=setup)
        skipped = []
        for fname in sorted(os.listdir(MIGRATIONS)):
            if not fname.endswith(".sql"):
                continue
            with open(os.path.join(MIGRATIONS, fname), encoding="utf-8") as fh:
                stmts = split_statements(fh.read())
            kept = [s for s in stmts if not is_skipped(s)]
            skipped += [s for s in stmts if is_skipped(s)]
            filtered = os.path.join(workdir, fname)
            write_file(filtered, "\n".join(kept))
            psql(db, sql_file=filtered)
            log(f"  applied {fname} ({len(kept)}/{len(stmts)} statements)")
        for s in skipped:
            log(f"  skipped (Supabase-only): {s.strip()[:90]}")

        # -- 4. تحميل التفريغ ---------------------------------------------
        log("phase 4: load dump into target")
        psql(db, sql_file=dump_path)

        # -- 5. التحقق -----------------------------------------------------
        log("phase 5: verify target == source")
        failures = []
        for t in tables:
            n = psql_count(db, f"select count(*) from public.{t}")
            ok = n == src_counts[t]
            if not ok:
                failures.append(f"count {t}: source={src_counts[t]} target={n}")
        n_users = psql_count(db, "select count(*) from auth.users")
        if n_users != src_users:
            failures.append(f"count auth.users: source={src_users} target={n_users}")
        n_objs = psql_count(db, "select count(*) from storage.objects")
        if n_objs != src_objects:
            failures.append(
                f"count storage.objects: source={src_objects} target={n_objs}")
        tgt_inv = psql_query(
            db, "select coalesce(sum(balance),0) from public.invoice_balances")[0]
        tgt_child = psql_query(
            db, "select coalesce(sum(balance),0) from public.child_balances")[0]
        # مقارنة عشرية (التنسيق النصي يختلف: 5430.00 مقابل 5430.0)
        if Decimal(str(tgt_inv)) != Decimal(str(src_inv_bal)):
            failures.append(
                f"invoice balance: source={src_inv_bal} target={tgt_inv}")
        if Decimal(str(tgt_child)) != Decimal(str(src_child_bal)):
            failures.append(
                f"child balance: source={src_child_bal} target={tgt_child}")
        tgt_orphans = {}
        for k, q in ORPHAN_CHECKS.items():
            n = psql_count(db, q)
            tgt_orphans[k] = n
            if n != src_orphans[k]:
                failures.append(f"orphans {k}: source={src_orphans[k]} target={n}")
        log(f"target: {sum(psql_count(db, f'select count(*) from public.{t}') for t in tables)} rows, "
            f"invoice balance={tgt_inv}, child balance={tgt_child}, "
            f"orphans={sum(tgt_orphans.values())} (source {sum(src_orphans.values())})")
        if failures:
            for f in failures:
                log(f"  MISMATCH: {f}")
            verdict = "NO-GO"
        else:
            verdict = "GO"
    except SystemExit:
        raise
    except Exception as e:
        log(f"ERROR: {e}")
        verdict = "NO-GO"
    finally:
        # -- 6. تنظيف ------------------------------------------------------
        if not keep:
            try:
                psql(None, sql_text=f'drop database if exists "{db}";')
                log(f"cleanup: dropped local db {db}")
            except Exception as e:
                log(f"cleanup WARNING: could not drop {db}: {e}")
            try:
                os.remove(dump_path)
                log("cleanup: dump file deleted")
            except FileNotFoundError:
                pass
        else:
            log(f"kept: db={db} dump={dump_path} (delete manually)")
        try:
            after = int(live_one(ref, "select count(*) as n from public.children")["n"])
            log(f"source baseline re-check: children={after} "
                f"(was {src_counts.get('children', '?')}) — "
                f"{'unchanged' if str(after) == str(src_counts.get('children')) else 'CHANGED!'}")
        except Exception as e:
            log(f"source re-check WARNING: {e}")
    print(f"\nRESTORE DRILL VERDICT: {verdict}")
    raise SystemExit(0 if verdict == "GO" else 1)


if __name__ == "__main__":
    main()
