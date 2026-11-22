/**
 * ضغط صور الأطفال عند الرفع (قرار ق٨): حد 1600px للضلع الأطول وجودة
 * JPEG ‏0.8 — يحدث على الجهاز قبل الرفع فلا تخرج الصورة الأصلية الثقيلة
 * من التطبيق أبداً، ومساحة التخزين تعيش أطول بكتير.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const maxSide = 1600
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
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
