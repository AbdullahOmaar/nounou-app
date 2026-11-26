import { useRef, useState } from 'react'

import Papa from 'papaparse'
import { Check } from 'lucide-react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormError } from '../../components/ui/form'
import { useT } from '../../i18n'
import { useClasses } from '../classes/hooks'
import { useChildMutations } from './hooks'
import { parseImportRows, type ImportRow, type ImportRowError } from './importLogic'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * استيراد أطفال من Excel/CSV: قراءة محلية بالكامل (read-excel-file /
 * papaparse) → منطق نقي للتحقق → إنشاء تسلسلي بتقرير نتائج. لا ملف
 * يغادر الجهاز إلا صفوف الأطفال نفسها عبر اتصال Supabase المشفر.
 * موجة الهوية 2 (موك أب 15): خطوات مرقّمة تعكس حالة التدفق الحالية +
 * نونا الكاملة في الحالة الفارغة + زرّا اختيار ملف/قالب فارغ جنب بعض —
 * منطق القراءة والمطابقة والإنشاء كما هو حرفيًا.
 */
export function ChildImportSheet({ open, onClose }: Props) {
  const t = useT()
  const classes = useClasses()
  const mutations = useChildMutations()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [errors, setErrors] = useState<ImportRowError[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneCount, setDoneCount] = useState<number | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setDoneCount(null)
    try {
      let raw: unknown[][]
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text()
        const parsed = Papa.parse(text, { skipEmptyLines: true })
        raw = parsed.data as unknown[][]
      } else {
        const { default: readXlsxFile } = await import('read-excel-file/browser')
        raw = (await readXlsxFile(file)) as unknown as unknown[][]
      }
      const known = new Set((classes.data ?? []).map((c) => c.name))
      const limits = new Map(
        (classes.data ?? []).map((c) => [
          c.name,
          { capacity: c.capacity, enrolled: c.childrenCount },
        ]),
      )
      const result = parseImportRows(raw, known, limits)
      setRows(result.rows)
      setErrors(result.errors)
    } catch {
      setError(t('common.errorGeneric'))
    }
  }

  async function handleImport() {
    setBusy(true)
    setError(null)
    const classIdByName = new Map((classes.data ?? []).map((c) => [c.name, c.id]))
    let done = 0
    try {
      for (const row of rows) {
        await mutations.create.mutateAsync({
          full_name: row.full_name,
          birth_date: row.birth_date,
          gender: null,
          photo_consent: false,
          notes: null,
          class_id: row.class_name ? (classIdByName.get(row.class_name) ?? null) : null,
          guardian_name: row.guardian_name,
          guardian_phone: row.guardian_phone,
          guardian_relation: null,
        })
        done++
      }
      setDoneCount(done)
      setRows([])
    } catch {
      setError(t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  /** الخطوة الحالية من حالة التدفق نفسها: رفع ← (مطابقة تلقائية) ← مراجعة ← تأكيد */
  const step = doneCount !== null ? 4 : rows.length > 0 ? 3 : 1
  const steps: { title: string; sub: string }[] = [
    { title: t('children.import.stepUpload'), sub: t('children.import.stepUploadSub') },
    { title: t('children.import.stepMatch'), sub: t('children.import.stepMatchSub') },
    { title: t('children.import.stepReview'), sub: t('children.import.stepReviewSub') },
    { title: t('children.import.stepConfirm'), sub: t('children.import.stepConfirmSub') },
  ]

  /** قالب فارغ: سطر العناوين وحده بنفس أسماء أعمدة docs/pilot/import-template.csv */
  function downloadTemplate() {
    const csv = String.fromCharCode(0xfeff) + t('children.import.templateHeader') + '\n'
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const errorLabel = (e: ImportRowError): string => {
    switch (e.code) {
      case 'unknownClass':
        return t('children.import.unknownClass')
      case 'overCapacity':
        return t('children.import.overCapacity')
      case 'missingName':
        return t('children.import.missingName')
      case 'badPhone':
        return t('children.import.rowError', { row: e.rowNumber, message: 'phone' })
      default:
        return t('children.import.rowError', { row: e.rowNumber, message: e.code })
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('children.import.title')}
      footer={
        rows.length > 0 ? (
          <Button onClick={handleImport} disabled={busy} full>
            {busy ? t('children.import.importing') : t('children.import.importNow')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <span className="type-badge rounded-full bg-soft text-primary px-3 py-1">
            {t('children.import.stepOf', { step, total: 4 })}
          </span>
        </div>
        {rows.length === 0 && doneCount === null && (
          <div className="bg-surface rounded-2xl p-4 flex flex-col items-center text-center gap-2">
            <img
              src="/nouna/nouna-full.png"
              alt=""
              className="w-[110px] rounded-[20px]"
            />
            <div className="type-title">{t('children.import.emptyTitle')}</div>
            <p className="type-secondary text-muted">
              {t('children.import.emptyBody')}
            </p>
          </div>
        )}
        <Card>
          <div className="type-section mb-3">{t('children.import.stepsTitle')}</div>
          <div className="flex flex-col gap-3">
            {steps.map((s, i) => {
              const n = i + 1
              const state = n < step || doneCount !== null ? 'done' : n === step ? 'now' : 'todo'
              return (
                <div key={s.title} className="flex items-center gap-3">
                  <span
                    className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center type-badge ${
                      state === 'done'
                        ? 'bg-ok-soft text-ok-text'
                        : state === 'now'
                          ? 'bg-accent text-on-accent'
                          : 'bg-surface border border-border text-muted'
                    }`}
                  >
                    {state === 'done' ? <Check size={14} /> : n}
                  </span>
                  <span className="min-w-0">
                    <span className="type-body block font-semibold">{s.title}</span>
                    <span className="type-badge text-muted block">{s.sub}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
        <p className="type-secondary text-muted">{t('children.import.hint')}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
        {rows.length === 0 && doneCount === null && (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => fileRef.current?.click()}>
              {t('children.import.pickFile')}
            </Button>
            <Button
              className="flex-1"
              variant="ghost"
              onClick={downloadTemplate}
            >
              {t('children.import.downloadTemplate')}
            </Button>
          </div>
        )}
        {rows.length > 0 && (
          <p className="type-body">
            {t('children.import.preview', { count: rows.length })}
          </p>
        )}
        {errors.length > 0 && (
          <div className="bg-bad-soft text-bad-text rounded-xl px-3 py-2">
            <p className="type-body mb-1">
              {t('children.import.errors', { count: errors.length })}
            </p>
            <ul className="type-badge list-disc ps-4">
              {errors.slice(0, 8).map((e) => (
                <li key={`${e.rowNumber}-${e.code}`}>{errorLabel(e)}</li>
              ))}
            </ul>
          </div>
        )}
        {doneCount !== null && (
          <p className="type-body text-good-text bg-good-soft rounded-xl px-3 py-2">
            {t('children.import.done', { count: doneCount })}
          </p>
        )}
        {error && <FormError message={error} />}
      </div>
    </Sheet>
  )
}
