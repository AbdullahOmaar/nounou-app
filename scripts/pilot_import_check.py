#!/usr/bin/env python3
"""فحص ما قبل استيراد بيانات البايلوت (تشغيل جاف فقط — لا يكتب أي بيانات).

يقرأ ملف الأطفال (xlsx أو csv) بنفس قواعد منطق الاستيراد داخل التطبيق
(src/features/children/importLogic.ts) حرفيًا، ويضيف فحوصات لا يفعلها التطبيق:
- سعة الفصول (420-T2): عدد أطفال كل فصل في الملف + الموجودين حاليًا مقابل السعة
- صفوف مكررة تمامًا (نفس الطفل + نفس الموبايل)
- نفس الموبايل باسم ولي أمر مختلف (تحذير)
- تاريخ ميلاد مكتوب بصيغة غير YYYY-MM-DD (التطبيق يسقطه بصمت — هنا تحذير)
- عمر خارج 1–7 سنوات (تحذير)

الاستخدام:
  python3 scripts/pilot_import_check.py <file.xlsx|file.csv> \
      --classes "البراعم,الزهور,الفراشات" \
      [--capacity "البراعم=25,الزهور=25"] [--existing "البراعم=18"] [--strict]

خروج: 0 = لا أخطاء (التحذيرات مسموحة ما لم --strict)، 1 = أخطاء، 2 = فشل بيئة.
xlsx يحتاج openpyxl؛ csv يعمل بدونه.
"""
import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from datetime import date

HEADER_ALIASES = {
    "اسم الطفل": "full_name", "الاسم": "full_name", "name": "full_name",
    "child name": "full_name",
    "تاريخ الميلاد": "birth_date", "الميلاد": "birth_date",
    "birth date": "birth_date", "birthdate": "birth_date",
    "الفصل": "class_name", "class": "class_name",
    "اسم ولي الأمر": "guardian_name", "ولي الأمر": "guardian_name",
    "guardian": "guardian_name", "guardian name": "guardian_name",
    "الموبايل": "guardian_phone", "رقم الموبايل": "guardian_phone",
    "الهاتف": "guardian_phone", "phone": "guardian_phone", "mobile": "guardian_phone",
}
PHONE_RE = re.compile(r"^\+?\d{10,15}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def read_rows(path):
    if path.lower().endswith(".csv"):
        with open(path, newline="", encoding="utf-8-sig") as f:
            return [row for row in csv.reader(f)]
    try:
        import openpyxl
    except ImportError:
        print("openpyxl غير متاح — حوّل الملف إلى csv أو ثبّته", file=sys.stderr)
        sys.exit(2)
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = []
    for row in ws.iter_rows(values_only=True):
        rows.append(["" if c is None else str(c) for c in row])
    return rows


def parse_kv(text):
    out = {}
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = int(v.strip())
        else:
            out[part] = None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--classes", required=True, help="أسماء فصول الحضانة مفصولة بفواصل")
    ap.add_argument("--capacity", default="", help="سعة كل فصل: اسم=عدد")
    ap.add_argument("--existing", default="", help="المسجلون حاليًا بكل فصل: اسم=عدد")
    ap.add_argument("--strict", action="store_true", help="التحذيرات تُفشل الفحص")
    args = ap.parse_args()

    known_classes = {c.strip() for c in args.classes.split(",") if c.strip()}
    capacity = parse_kv(args.capacity)
    existing = parse_kv(args.existing)

    raw = read_rows(args.file)
    if len(raw) < 2:
        print("الملف فارغ أو بلا صفوف بيانات")
        return 1
    header = [str(h).strip().lower() for h in raw[0]]
    col = {}
    for field in ("full_name", "birth_date", "class_name", "guardian_name", "guardian_phone"):
        col[field] = next((i for i, h in enumerate(header) if HEADER_ALIASES.get(h) == field), -1)

    errors, warnings, valid = [], [], []
    seen_pairs = {}
    phone_names = defaultdict(set)
    class_counts = Counter()

    for i in range(1, len(raw)):
        row = raw[i]
        if not row or all(str(c).strip() == "" for c in row):
            continue
        rn = i + 1
        get = lambda idx: str(row[idx]).strip() if 0 <= idx < len(row) and row[idx] is not None else ""
        full_name = get(col["full_name"])
        guardian_name = get(col["guardian_name"])
        guardian_phone = re.sub(r"[\s-]", "", get(col["guardian_phone"]))
        class_name = get(col["class_name"]) or None
        birth_raw = get(col["birth_date"])
        birth_date = birth_raw if DATE_RE.match(birth_raw) else None

        if not full_name:
            errors.append((rn, "اسم الطفل مفقود"))
            continue
        if not guardian_name or not guardian_phone:
            errors.append((rn, "بيانات ولي الأمر ناقصة (الاسم أو الموبايل)"))
            continue
        if not PHONE_RE.match(guardian_phone):
            errors.append((rn, f"موبايل غير صالح: {guardian_phone}"))
            continue
        if class_name and class_name not in known_classes:
            errors.append((rn, f"فصل غير معروف: {class_name}"))
            continue
        if birth_raw and not birth_date:
            warnings.append((rn, f"تاريخ ميلاد بصيغة غير مقبولة وسيُسقط: {birth_raw} (المقبول YYYY-MM-DD)"))
        if birth_date:
            try:
                y, m, d = (int(x) for x in birth_date.split("-"))
                age = (date.today() - date(y, m, d)).days / 365.25
                if age < 0.5 or age > 7.5:
                    warnings.append((rn, f"عمر خارج النطاق المعتاد ({age:.1f} سنة) — تأكد من التاريخ"))
            except ValueError:
                warnings.append((rn, f"تاريخ ميلاد غير حقيقي: {birth_date}"))
        pair = (full_name, guardian_phone)
        if pair in seen_pairs:
            errors.append((rn, f"صف مكرر تمامًا (نفسه في الصف {seen_pairs[pair]})"))
            continue
        seen_pairs[pair] = rn
        phone_names[guardian_phone].add(guardian_name)
        if class_name:
            class_counts[class_name] += 1
        valid.append((rn, full_name, class_name, guardian_name, guardian_phone))

    for phone, names in phone_names.items():
        if len(names) > 1:
            warnings.append((0, f"الموبايل {phone} مكتوب بأسماء أولياء مختلفة: {' / '.join(sorted(names))}"))

    for cls, cnt in sorted(class_counts.items()):
        cap = capacity.get(cls)
        if cap is not None:
            total = cnt + existing.get(cls, 0)
            if total > cap:
                errors.append((0, f"فصل {cls}: الاستيراد {cnt} + الحالي {existing.get(cls, 0)} = {total} يتجاوز السعة {cap}"))

    guardians = {v[4] for v in valid}
    print(f"== تقرير الفحص الجاف لاستيراد البايلوت == ")
    print(f"صفوف صالحة: {len(valid)} طفلًا • أولياء أمور فريدون (بالموبايل): {len(guardians)}")
    for cls, cnt in sorted(class_counts.items()):
        cap = capacity.get(cls)
        print(f"  فصل {cls}: {cnt} طفلًا" + (f" / السعة {cap}" if cap is not None else ""))
    noclass = sum(1 for v in valid if not v[2])
    if noclass:
        print(f"  بلا فصل: {noclass} (مسموح — يُسند لاحقًا داخل التطبيق)")
    if errors:
        print(f"\nأخطاء ({len(errors)}) — يجب إصلاحها قبل الاستيراد:")
        for rn, msg in errors:
            print(f"  {'صف ' + str(rn) if rn else 'عام'}: {msg}")
    if warnings:
        print(f"\nتحذيرات ({len(warnings)}):")
        for rn, msg in warnings:
            print(f"  {'صف ' + str(rn) if rn else 'عام'}: {msg}")
    if not errors and not warnings:
        print("\nنظيف تمامًا — جاهز للاستيراد داخل التطبيق.")
    elif not errors:
        print("\nلا أخطاء — جاهز للاستيراد مع ملاحظة التحذيرات.")
    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
