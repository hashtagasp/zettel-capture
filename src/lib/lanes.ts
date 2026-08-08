/**
 * The swipe lanes, in order. Mirrors the vault's folder layout as defined in
 * 90_Meta/00 Legende.md.
 *
 * Only `00_Eingang` is ever *created* into from the phone. `30_Quellen` is
 * append-only (into an existing note's `## Zitate` section) so that its strict
 * `Q <Autor> <Jahr> – <Titel>.md` naming can never be violated by a phone
 * capture. Everything else is read-only by design: Regel 3 requires a new
 * Zettel to enter a Strukturzettel the same day, which is desk work.
 */

export type LaneMode = 'create' | 'append' | 'read'

export interface Lane {
  id: string
  /** Shown in the header. */
  label: string
  /** Path inside the vault repo, no leading or trailing slash. */
  folder: string
  mode: LaneMode
}

export const LANES: Lane[] = [
  { id: 'eingang', label: 'Eingang', folder: '00_Eingang', mode: 'create' },
  { id: 'quellen', label: 'Quellen', folder: '30_Quellen', mode: 'append' },
  { id: 'zettel', label: 'Zettel', folder: '10_Zettel', mode: 'read' },
  { id: 'struktur', label: 'Struktur', folder: '20_Struktur', mode: 'read' },
  { id: 'projekte', label: 'Projekte', folder: '40_Projekte', mode: 'read' },
]

/** Images and PDFs referenced by `![[…]]` embeds. */
export const ATTACHMENT_FOLDER = 'Anhang'

/** Folders whose filenames feed the `[[` autocomplete. */
export const LINK_TARGET_FOLDERS = ['10_Zettel', '20_Struktur']

export const laneById = (id: string): Lane | undefined => LANES.find((l) => l.id === id)
export const laneIndex = (id: string): number => LANES.findIndex((l) => l.id === id)
