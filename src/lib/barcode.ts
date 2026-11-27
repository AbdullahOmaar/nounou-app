import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { isNativeApp } from './native'

/**
 * مسح QR الأصلي (3A-412 خطوة 4): على التطبيق الأصلي نمسح بماسح
 * MLKit الأصلي (أسرع وأوثق عند البوابة من مسح المتصفح)، ونرجع نص
 * أول كود يُقرأ. الإلغاء/رفض الإذن/أي فشل يرجع null — والمستدعي
 * يقرر (إغلاق الورقة أو الرجوع لماسح الويب). على الويب: null دائماً.
 */
export async function scanQrNative(): Promise<string | null> {
  if (!isNativeApp()) return null
  try {
    const permission = await BarcodeScanner.requestPermissions()
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      return null
    }
    const { barcodes } = await BarcodeScanner.scan()
    const first = barcodes[0]
    return first?.rawValue ?? first?.displayValue ?? null
  } catch (err) {
    console.warn('[barcode] native scan failed', err)
    return null
  }
}
