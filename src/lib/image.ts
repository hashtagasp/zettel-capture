/**
 * Photos are downscaled before they ever reach IndexedDB or the repo.
 *
 * Git keeps every version of every blob forever. A 3 MB phone photo per book
 * page would push the vault past a comfortable repo size within a year, and it
 * cannot be undone without rewriting history. 1600 px at q0.8 lands around
 * 250–400 kB and is still comfortably legible for a page of text.
 */

const MAX_EDGE = 1600
const QUALITY = 0.8

export interface DownscaledImage {
  blob: Blob
  contentType: string
  width: number
  height: number
}

export async function downscaleImage(file: File): Promise<DownscaledImage> {
  // `from-image` applies the EXIF orientation, so a page photographed in
  // portrait doesn't land in the vault on its side.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas nicht verfügbar')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob) throw new Error('Bild konnte nicht verkleinert werden')

    return { blob, contentType: 'image/jpeg', width, height }
  } finally {
    bitmap.close()
  }
}

export const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
