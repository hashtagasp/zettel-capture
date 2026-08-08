/**
 * Encoding helpers.
 *
 * Two traps are certain to bite this vault, because every folder name and half
 * the filenames carry umlauts (`Flüchtiges`, `Fließtext`, `Größe`) and the
 * Quellen filenames use an en-dash (`–`, U+2013):
 *
 *   1. `btoa()` operates on Latin-1. Handing it a JS string containing `ü`
 *      throws InvalidCharacterError; handing it one containing only characters
 *      below U+0100 silently encodes the wrong bytes. Everything must go
 *      through TextEncoder first.
 *
 *   2. macOS hands out filenames in NFD (`u` + combining diaeresis); git and
 *      GitHub store whatever bytes they are given. Mixing the two produces two
 *      files that look identical in Finder and are different paths in the repo.
 *      Normalise to NFC on every write and on both sides of every comparison.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/** Chunked so large image buffers don't blow the argument stack. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text))
}

export function base64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return decoder.decode(bytes)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

/** Canonical Unicode form for anything that becomes a path in the repo. */
export const nfc = (s: string): string => s.normalize('NFC')

/** Compare two filenames that may have arrived from different platforms. */
export const samePath = (a: string, b: string): boolean => nfc(a) === nfc(b)

/**
 * Percent-encode a repo path for the GitHub Contents API. Segment separators
 * stay literal; everything inside a segment is encoded, so
 * `Q Feige 2014 – Philosophie des Jazz.md` survives intact.
 */
export function encodeRepoPath(path: string): string {
  return nfc(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

/** Illegal in a filename on macOS, Windows, or inside an Obsidian wikilink. */
const ILLEGAL = /[/\\:*?"<>|#^[\]]/g
const CONTROL = /[\u0000-\u001F\u007F]/g

/**
 * Turn free text into the `<Stichwort>` part of a filename. Keeps umlauts —
 * the vault is German and its existing filenames have them — but strips path
 * separators, wikilink brackets and control characters.
 */
export function sanitizeFilenamePart(text: string, maxLength = 60): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  const cleaned = nfc(firstLine)
    .replace(/^#+\s*/, '') // a leading markdown heading marker
    // Illegal and control characters become a space, never nothing. Deleting
    // them fuses the words on either side: `Test[[jdjdj]]` would otherwise
    // yield `Testjdjdj`, and a tab between two words would vanish entirely.
    .replace(ILLEGAL, ' ')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '') // trailing dots break on Windows and confuse Obsidian

  if (cleaned.length <= maxLength) return cleaned
  // Cut on a word boundary so the name stays readable.
  const cut = cleaned.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
}
