/**
 * Note construction. Everything written to the vault is built here, so the
 * conventions from 90_Meta/00 Legende.md and 90_Meta/Templates/ live in exactly
 * one place.
 *
 * Naming (Legende, "Benennung"):
 *   Eingang     E YYYY-MM-DD <Stichwort>.md
 *   Quelle      Q <Autor> <Jahr> – <Titel>.md   (never created here — see below)
 *
 * The phone cannot produce a well-formed Quelle filename without asking for
 * author, year and title, so it never creates one. It appends to a Quelle that
 * already exists, and otherwise drops the capture into 00_Eingang with a
 * `## Quellenangabe` stub to complete at the desk.
 */

import { sanitizeFilenamePart } from './encoding'

const MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-08-08` — the `date:` property, matching the Eingang template. */
export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** `20260808-1432` — the attachment filename prefix. */
export const stampCompact = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`

/** `8. August` — shown on the cards. */
export const dateLabelDe = (d: Date): string => `${d.getDate()}. ${MONTHS_DE[d.getMonth()]}`

/**
 * `E 2026-08-08 Vorlesung Systemtheorie.md`.
 *
 * The title wins when there is one. Without it the first line of the body is
 * used, and failing that a timestamp — a rushed capture must never be blocked
 * by the question of what to call it.
 */
export function eingangFilename(date: Date, body: string, title?: string): string {
  const stichwort = sanitizeFilenamePart(title ?? '') || sanitizeFilenamePart(body)
  const base = stichwort || `Notiz ${pad(date.getHours())}${pad(date.getMinutes())}`
  return `E ${isoDate(date)} ${base}.md`
}

/** `20260808-1432 Vorlesung Systemtheorie.jpg` */
export function attachmentFilename(date: Date, hint: string, ext = 'jpg'): string {
  const slug = sanitizeFilenamePart(hint, 40) || 'Foto'
  return `${stampCompact(date)} ${slug}.${ext}`
}

/** Adds a `<name>-2`, `-3`… suffix until the name is free. */
export function deduplicateName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem} ${n}${ext}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem} ${Date.now()}${ext}`
}

export interface EingangNote {
  date: Date
  /** The `# ` heading — the filename without `.md`. */
  title: string
  body: string
  /** Filenames inside `Anhang/`, embedded as `![[…]]`. */
  embeds: string[]
  /** Adds the stub for a source that isn't in 30_Quellen yet. */
  quellenangabe?: boolean
}

/**
 * Mirrors 90_Meta/Templates/Eingang.md. The template's instructional HTML
 * comment is dropped — it explains how to fill the note in, and the note is
 * already filled in.
 */
export function buildEingangNote(note: EingangNote): string {
  const embeds = note.embeds.map((f) => `![[${f}]]`).join('\n\n')

  return [
    '---',
    'type: eingang',
    'status: roh',
    `date: ${isoDate(note.date)}`,
    'tags: []',
    '---',
    '',
    `# ${note.title}`,
    '',
    note.body.trim(),
    ...(embeds ? ['', embeds] : []),
    ...(note.quellenangabe
      ? ['', '## Quellenangabe', '', '**Autor:** ', '**Jahr:** ', '**Titel:** ', '**Seite:** ']
      : []),
    '',
    '## Mögliche Zettel',
    '',
    '- [ ] ',
    '',
  ].join('\n')
}

/** One quote block as it is spliced into a Quelle's `## Zitate` section. */
export function buildQuoteBlock(text: string, embeds: string[]): string {
  const quoted = text
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `> ${line.trim()}` : '>'))
    .join('\n')

  return [
    quoted,
    ...(embeds.length ? ['', ...embeds.map((f) => `![[${f}]]`)] : []),
    '',
    '*S. *',
  ].join('\n')
}

/**
 * Insert a quote block at the end of a Quelle's `## Zitate` section, leaving
 * `## Eigene Notizen` and the trailing dataview block untouched.
 *
 * Fence-aware, so a `## ` inside a ```dataview``` block is never mistaken for a
 * heading. Falls back to appending a `## Zitate` section if the file has none.
 */
export function spliceQuoteIntoQuelle(existing: string, quoteBlock: string): string {
  const lines = existing.split('\n')
  let inFence = false
  let zitateAt = -1
  let nextHeadingAt = -1
  /** Where a missing `## Zitate` section should be created. */
  let fallbackAt = -1

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    if (zitateAt === -1) {
      if (/^##\s+Zitate\s*$/i.test(lines[i])) zitateAt = i
      // `Q Rand 1957 – Atlas Shrugged.md` has no `## Zitate` — it collects
      // `## Stellen` instead. A new quote section belongs above the reflective
      // sections, never after the trailing dataview block.
      else if (fallbackAt === -1 && /^##\s+(Eigene Notizen|Daraus entstandene)/i.test(lines[i])) {
        fallbackAt = i
      }
    } else if (/^#{1,2}\s+/.test(lines[i])) {
      nextHeadingAt = i
      break
    }
  }

  if (zitateAt === -1) {
    if (fallbackAt === -1) {
      const tail = existing.endsWith('\n') ? '' : '\n'
      return `${existing}${tail}\n## Zitate\n\n${quoteBlock}\n`
    }
    return [
      ...lines.slice(0, fallbackAt),
      '## Zitate',
      '',
      quoteBlock,
      '',
      ...lines.slice(fallbackAt),
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }

  const end = nextHeadingAt === -1 ? lines.length : nextHeadingAt
  // Drop blank lines at the tail of the section, then re-add exactly one.
  let insertAt = end
  while (insertAt > zitateAt + 1 && lines[insertAt - 1].trim() === '') insertAt--

  const before = lines.slice(0, insertAt)
  const after = lines.slice(insertAt)
  return [...before, '', quoteBlock, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n')
}

/** First non-empty, non-frontmatter, non-heading line — the card preview text. */
export function previewOf(markdown: string, maxLength = 240): string {
  let text = markdown
  if (text.startsWith('---')) {
    const close = text.indexOf('\n---', 3)
    if (close !== -1) text = text.slice(close + 4)
  }
  const body = text
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t && !t.startsWith('#') && !t.startsWith('![[') && t !== '- [ ]'
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return body.length > maxLength ? `${body.slice(0, maxLength).trimEnd()}…` : body
}

/** `E 2026-08-08 Vorlesung.md` → `E 2026-08-08 Vorlesung` */
export const stripExtension = (name: string): string => name.replace(/\.md$/i, '')
