/**
 * Turns drafts and folder listings into the cards the deck renders.
 *
 * Filenames in this vault are informative by design — a Zettel's filename *is*
 * its claim (Legende, "Titel sind Behauptungen"). So a card can be built from a
 * listing alone, with no request per note. Content is fetched only when a card
 * is actually opened.
 */

import { dateLabelDe, previewOf, stripExtension } from './notes'
import type { Lane } from './lanes'
import type { Draft } from './store'
import type { RepoEntry } from './github'

export interface Card {
  key: string
  title: string
  subtitle: string
  preview: string
  /** Present for local drafts. */
  draftId?: string
  /** Present for files that exist in the repo. */
  path?: string
  /** Shown in accent under the preview when the draft hasn't landed yet. */
  flag?: string
}

const MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/**
 * Split a vault filename into a display title and a date subtitle, following
 * the four naming patterns in 90_Meta/00 Legende.md.
 */
export function describeFilename(filename: string): { title: string; subtitle: string } {
  const stem = stripExtension(filename)

  // Zettel: `202608021015 Behauptung`
  const zettel = stem.match(/^(\d{4})(\d{2})(\d{2})\d{4}\s+(.*)$/)
  if (zettel) {
    const [, y, m, d, title] = zettel
    return { title, subtitle: `${Number(d)}. ${MONTHS_DE[Number(m) - 1]} ${y}` }
  }

  // Eingang: `E 2026-08-08 Stichwort`
  const eingang = stem.match(/^E\s+(\d{4})-(\d{2})-(\d{2})\s+(.*)$/)
  if (eingang) {
    const [, y, m, d, title] = eingang
    return { title, subtitle: `${Number(d)}. ${MONTHS_DE[Number(m) - 1]} ${y}` }
  }

  // Strukturzettel: `STR Thema`
  const struktur = stem.match(/^STR\s+(.*)$/)
  if (struktur) return { title: struktur[1], subtitle: 'Strukturzettel' }

  // Quelle: `Q Autor Jahr – Titel`
  const quelle = stem.match(/^Q\s+(.*)$/)
  if (quelle) return { title: quelle[1], subtitle: 'Quelle' }

  return { title: stem, subtitle: '' }
}

function draftCard(draft: Draft): Card {
  const { title, subtitle } =
    draft.kind === 'quelle-append'
      ? { title: draft.targetLabel ?? 'Zitat', subtitle: 'Zitat' }
      : { title: previewOf(draft.body, 60) || 'Ohne Titel', subtitle: dateLabelDe(new Date(draft.createdAt)) }

  const flag = (() => {
    switch (draft.syncState) {
      case 'error':
        return draft.lastError ?? 'Fehler'
      case 'synced':
        return undefined
      default:
        return draft.attachmentIds.length
          ? `Wartet auf Übertragung · ${draft.attachmentIds.length} Foto`
          : 'Wartet auf Übertragung'
    }
  })()

  return {
    key: `draft:${draft.id}`,
    title,
    subtitle,
    preview: previewOf(draft.body),
    draftId: draft.id,
    flag,
  }
}

function entryCard(entry: RepoEntry): Card {
  const { title, subtitle } = describeFilename(entry.name)
  return { key: `file:${entry.path}`, title, subtitle, preview: '', path: entry.path }
}

/**
 * Newest first. Local drafts lead, because they are by definition the most
 * recent thing that happened; a draft already mirrored by a repo entry is
 * dropped so the same note never appears twice.
 */
export function buildCards(lane: Lane, drafts: Draft[], entries: RepoEntry[]): Card[] {
  const remotePaths = new Set(entries.map((e) => e.path))

  const draftCards = drafts
    .filter((d) => !(d.syncState === 'synced' && d.remotePath && remotePaths.has(d.remotePath)))
    .map(draftCard)

  const entryCards = entries
    .slice()
    .sort((a, b) => b.name.localeCompare(a.name, 'de'))
    .map(entryCard)

  // The Quellen lane lists the source notes themselves; a queued quote belongs
  // with its target, not as a separate card in front of it.
  if (lane.mode === 'append') return entryCards

  return [...draftCards, ...entryCards]
}
