import { useRef, useState } from 'react'

import Papa from 'papaparse'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
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
        <Button variant="soft" onClick={() => fileRef.current?.click()}>
          {t('children.import.pickFile')}
        </Button>
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
