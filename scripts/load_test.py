#!/usr/bin/env python3
"""اختبار حمل نونو (4.20) — سيناريوهات قراءة واقعية ضد RPCs
العامة والبوابة. حارس أمان: يرفض مشروع الإنتاج افتراضياً؛
التشغيل عليه يتطلب --allow-production وكتابة ref يدوياً.

الاستخدام:
  python3 scripts/load_test.py --url https://<ref>.supabase.co \
      --anon-key <publishable> --slug demo --vus 20 --seconds 60

بوابة القبول (docs/LOAD-TEST.md): p95 < 800ms، أخطاء < 1%.
"""
import argparse
import concurrent.futures
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request

PROD_REF = "eodzmizxvkwxelrexopl"


def call(url, key, path, body, timeout=15):
    req = urllib.request.Request(
        url + path,
        data=json.dumps(body).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    start = time.perf_counter()
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected -- الرابط مُتحقق منه في main() قبل أي نداء: scheme ‏https فقط والمضيف ‏supabase.co أو ‏localhost — الأداة داخلية بهدف واحد معلن.
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
            return resp.status, (time.perf_counter() - start) * 1000
    except Exception as e:  # noqa: BLE001
        return getattr(e, "code", 0), (time.perf_counter() - start) * 1000


def worker(args, deadline):
    lat, errs = [], 0
    while time.time() < deadline:
        status, ms = call(
            args.url, args.anon_key,
            "/rest/v1/rpc/nursery_public_page",
            {"p_slug": args.slug},
        )
        lat.append(ms)
        if status != 200:
            errs += 1
    return lat, errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--anon-key", required=True)
    ap.add_argument("--slug", default="demo")
    ap.add_argument("--vus", type=int, default=10)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--allow-production", action="store_true")
    args = ap.parse_args()
    parsed = urllib.parse.urlparse(args.url)
    host_ok = parsed.hostname is not None and (
        parsed.hostname.endswith(".supabase.co")
        or parsed.hostname in ("localhost", "127.0.0.1")
    )
    if parsed.scheme != "https" or not host_ok:
        print("REFUSED: url must be https://<ref>.supabase.co or localhost")
        return 2
    if PROD_REF in args.url and not args.allow_production:
        print("REFUSED: production target needs --allow-production")
        return 2
    deadline = time.time() + args.seconds
    all_lat, all_err = [], 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.vus) as ex:
        for lat, errs in ex.map(lambda _: worker(args, deadline),
                                range(args.vus)):
            all_lat.extend(lat)
            all_err += errs
    if not all_lat:
        print("NO SAMPLES")
        return 2
    all_lat.sort()
    p50 = statistics.median(all_lat)
    p95 = all_lat[int(len(all_lat) * 0.95) - 1]
    err_rate = all_err / len(all_lat) * 100
    print(f"requests={len(all_lat)} errors={all_err} "
          f"err%={err_rate:.2f} p50={p50:.0f}ms p95={p95:.0f}ms")
    go = p95 < 800 and err_rate < 1
    print("GO" if go else "NO-GO")
    return 0 if go else 1


if __name__ == "__main__":
    sys.exit(main())
