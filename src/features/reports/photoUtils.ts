/**
 * ضغط صور الأطفال عند الرفع (قرار ق٨) + سقف حجم صارم (3A-374/W3):
 * الضغط يحدث على الجهاز قبل الرفع فلا تخرج الصورة الأصلية الثقيلة
 * من التطبيق أبداً، ومساحة التخزين تعيش أطول بكتير. حد الضلع الأطول
 * كان 1600px بقرار ق٨ ووُحّد على 1280px باعتماد المدير في دفعة W3
 * (كافٍ لعرض موبايل ولي الأمر). سقف الملف 8MB يُفحص قبل الرفع —
 * فلا ملف ضخم يصل التخزين حتى لو فشل فكّ ترميزه ورجع الأصلي كما هو.
 */

/** أقصى حجم ملف يُقبل قبل الرفع: 8MB — أكبر من أي صورة كاميرا موبايل معتادة */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024

/** أقصى بُعد بعد الضغط (px) */
export const MAX_PHOTO_SIDE = 1280

/** أبعاد الهدف بلا تكبير أبداً — منطق نقي قابل للاختبار */
export function targetSize(
  width: number,
  height: number,
  maxSide: number = MAX_PHOTO_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = targetSize(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.8)
  })
}
