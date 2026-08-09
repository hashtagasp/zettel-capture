/**
 * Verification of everything that writes into the vault. Run with `npm test`.
 *
 * These are the failure modes that would quietly corrupt 96_Obsidian_Structure:
 * a mangled umlaut in a filename, a quote spliced over `## Eigene Notizen`, or
 * a note whose frontmatter no longer matches what the Register's dataview
 * queries look for.
 *
 * The core runs against fixtures so it holds regardless of what the vault
 * currently contains. When a populated vault is present, every note in it is
 * additionally run through the same checks.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  encodeRepoPath,
  nfc,
  sanitizeFilenamePart,
  utf8ToBase64,
  base64ToUtf8,
} from '../src/lib/encoding'
import {
  buildEingangNote,
  buildQuoteBlock,
  deduplicateName,
  eingangFilename,
  previewOf,
  spliceQuoteIntoQuelle,
} from '../src/lib/notes'
import { describeFilename } from '../src/lib/cards'
import { FILENAMES, QUELLE_WITHOUT_ZITATE, QUELLE_WITH_ZITATE, ZETTEL } from './fixtures'

const VAULT = process.env.VAULT ?? '/Users/christianmiller/Desktop/Body/Lab/96_Obsidian_Structure'

let passed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = '') {
  if (condition) passed++
  else failures.push(`${name}${detail ? `\n     ${detail}` : ''}`)
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(
    name,
    actual === expected,
    `expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`,
  )
}

/** Markdown files in a vault folder, or [] if the folder is absent or empty. */
function vaultFiles(folder: string): string[] {
  const dir = join(VAULT, folder)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md'))
}

/* ------------------------------------------------------- base64 / unicode */

{
  const samples = [
    'Fließtext über Größe',
    'Q Feige 2014 – Philosophie des Jazz', // en-dash U+2013
    'Zettelkasten scheitert an Verkomplizierung — nicht an Einfachheit', // em-dash
    '„Typographische Anführungszeichen"',
    'Emoji im Titel 🗂',
  ]

  for (const sample of samples) {
    const ours = utf8ToBase64(sample)
    eq(`base64 matches Node for "${sample.slice(0, 26)}…"`, ours, Buffer.from(sample, 'utf8').toString('base64'))
    eq(`base64 round-trips "${sample.slice(0, 26)}…"`, base64ToUtf8(ours), sample)
  }

  // A large payload must not blow the argument stack.
  const big = new Uint8Array(600_000).fill(200)
  check('base64 handles a 600 kB payload', utf8ToBase64(new TextDecoder('latin1').decode(big)).length > 0)
}

/* ---------------------------------------------------------- NFC filenames */

{
  const composed = 'Fließtext über Größe'
  const nfd = composed.normalize('NFD') // as macOS hands filenames out
  check('the two forms really do differ byte-wise', nfd !== composed)
  check('NFD input normalises to NFC', nfc(nfd) === composed)
  eq(
    'encodeRepoPath keeps separators literal and encodes segments',
    encodeRepoPath('30_Quellen/Q Feige 2014 – Philosophie des Jazz.md'),
    '30_Quellen/Q%20Feige%202014%20%E2%80%93%20Philosophie%20des%20Jazz.md',
  )
  eq(
    'encodeRepoPath survives umlauts',
    decodeURIComponent(encodeRepoPath('00_Eingang/E 2026-08-08 Größe.md')),
    '00_Eingang/E 2026-08-08 Größe.md',
  )
}

/* ------------------------------------------------------ filename building */

{
  eq('keeps umlauts', sanitizeFilenamePart('Über Größe und Beweglichkeit'), 'Über Größe und Beweglichkeit')
  eq(
    'strips separators and brackets without fusing words',
    sanitizeFilenamePart('Luhmann/Systeme: [[Zettel]] *wichtig*?'),
    'Luhmann Systeme Zettel wichtig',
  )
  // Regression: the first note ever written from the phone produced
  // "Hey das ist ein git Testjdjdj" from this input.
  eq(
    'a wikilink mid-sentence keeps its word boundary',
    sanitizeFilenamePart('Hey das ist ein git Test[[jdjdj]]'),
    'Hey das ist ein git Test jdjdj',
  )
  eq('drops a leading heading marker', sanitizeFilenamePart('## Ein Gedanke'), 'Ein Gedanke')
  eq('takes the first non-empty line', sanitizeFilenamePart('\n\n  Zweite Zeile\nDritte'), 'Zweite Zeile')
  eq('collapses whitespace', sanitizeFilenamePart('a     b\tc'), 'a b c')
  check(
    'truncates on a word boundary',
    sanitizeFilenamePart('Ein sehr langer Gedanke der weit über sechzig Zeichen hinausgeht und weiter').length <= 60,
  )
  check('never ends in a dot', !sanitizeFilenamePart('Warum denn nur...').endsWith('.'))

  const date = new Date(2026, 7, 8, 14, 32)
  eq(
    'Eingang filename follows the Legende pattern',
    eingangFilename(date, 'Vorlesung Systemtheorie'),
    'E 2026-08-08 Vorlesung Systemtheorie.md',
  )
  eq('empty note still gets a filename', eingangFilename(date, '   \n  '), 'E 2026-08-08 Notiz 1432.md')

  // The title, when given, names the file — not the first line of the body.
  eq(
    'an explicit title wins over the body',
    eingangFilename(date, 'Ein langer Fließtext, der nicht der Titel ist.', 'Medium und Form'),
    'E 2026-08-08 Medium und Form.md',
  )
  eq(
    'a blank title falls back to the body',
    eingangFilename(date, 'Luhmann unterscheidet Medium und Form.', '   '),
    'E 2026-08-08 Luhmann unterscheidet Medium und Form.md',
  )
  eq(
    'title with umlauts and illegal characters is cleaned, not fused',
    eingangFilename(date, '', 'Größe/Beweglichkeit: [[Systeme]]'),
    'E 2026-08-08 Größe Beweglichkeit Systeme.md',
  )
  eq('title-only note still names itself', eingangFilename(date, '', 'Nur ein Titel'), 'E 2026-08-08 Nur ein Titel.md')

  const taken = new Set(['E 2026-08-08 Notiz.md', 'E 2026-08-08 Notiz 2.md'])
  eq('collisions increment', deduplicateName('E 2026-08-08 Notiz.md', taken), 'E 2026-08-08 Notiz 3.md')
  eq('no collision passes through', deduplicateName('E 2026-08-08 Neu.md', taken), 'E 2026-08-08 Neu.md')
}

/* --------------------------------------------------- Eingang note content */

{
  const markdown = buildEingangNote({
    date: new Date(2026, 7, 8, 14, 32),
    title: 'E 2026-08-08 Vorlesung Systemtheorie',
    body: 'Luhmann unterscheidet Medium und Form.',
    embeds: ['20260808-1432 Tafelbild.jpg'],
  })

  for (const key of ['type: eingang', 'status: roh', 'tags: []']) {
    check(`frontmatter carries "${key}"`, markdown.includes(key))
  }
  check('date property is set', markdown.includes('date: 2026-08-08'))
  check('heading is the filename stem', markdown.includes('# E 2026-08-08 Vorlesung Systemtheorie'))
  check('photo is embedded as a wikilink', markdown.includes('![[20260808-1432 Tafelbild.jpg]]'))
  check('keeps the "Mögliche Zettel" section', markdown.includes('## Mögliche Zettel'))
  check('frontmatter opens at byte 0', markdown.startsWith('---\n'))
  check('no Templater syntax leaks through', !markdown.includes('<%'))
  check('no Quellenangabe stub unless asked', !markdown.includes('## Quellenangabe'))

  const fallback = buildEingangNote({
    date: new Date(2026, 7, 8),
    title: 'E 2026-08-08 Dorst',
    body: 'Zitat abgetippt.',
    embeds: [],
    quellenangabe: true,
  })
  check('source fallback adds the Quellenangabe stub', fallback.includes('## Quellenangabe'))
  check('stub asks for the page number', fallback.includes('**Seite:**'))

  // The live template, when the vault has one, must still agree with us.
  const templatePath = join(VAULT, '90_Meta/Templates/Eingang.md')
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, 'utf8')
    for (const key of ['type: eingang', 'status: roh', 'tags: []']) {
      check(`live template still declares "${key}"`, template.includes(key))
    }
    check('live template still has "## Mögliche Zettel"', template.includes('## Mögliche Zettel'))
  }
}

/* ----------------------------------------- splicing a quote into a Quelle */

const QUOTE = buildQuoteBlock('Design ist Systementwurf.\nZweite Zeile.', [
  '20260808-1432 Dorst S34.jpg',
])

{
  check('quote lines are prefixed', QUOTE.includes('> Design ist Systementwurf.'))
  check('second line is prefixed too', QUOTE.includes('> Zweite Zeile.'))
  check('photo rides along', QUOTE.includes('![[20260808-1432 Dorst S34.jpg]]'))
  check('page stub matches the template style', QUOTE.includes('*S. *'))
}

/** Every invariant a splice must preserve, whatever the note looks like. */
function checkSplice(label: string, original: string) {
  const updated = spliceQuoteIntoQuelle(original, QUOTE)

  check(`[${label}] quote was inserted`, updated.includes('> Design ist Systementwurf.'))
  check(`[${label}] frontmatter untouched`, updated.startsWith(original.slice(0, 40)))
  check(`[${label}] no triple blank lines`, !/\n{3,}/.test(updated))

  const originalHeadings = original.match(/^##\s+.*$/gm) ?? []
  const updatedHeadings = updated.match(/^##\s+.*$/gm) ?? []
  check(`[${label}] every original heading survived`, originalHeadings.every((h) => updatedHeadings.includes(h)))
  check(`[${label}] no heading duplicated`, new Set(updatedHeadings).size === updatedHeadings.length)

  const added = updatedHeadings.filter((h) => !originalHeadings.includes(h))
  check(
    `[${label}] added at most a "## Zitate" heading`,
    added.length === 0 || (added.length === 1 && added[0].trim() === '## Zitate'),
    `added: ${JSON.stringify(added)}`,
  )

  if (updated.includes('## Eigene Notizen')) {
    check(
      `[${label}] quote landed above ## Eigene Notizen`,
      updated.indexOf('> Design ist Systementwurf.') < updated.indexOf('## Eigene Notizen'),
    )
  }
  if (original.includes('```dataview')) {
    check(
      `[${label}] dataview fence intact`,
      (updated.match(/```/g) ?? []).length === (original.match(/```/g) ?? []).length,
    )
    check(
      `[${label}] nothing was appended after the dataview section`,
      updated.indexOf('## Zitate') < updated.indexOf('## Daraus entstandene'),
    )
  }
}

checkSplice('fixture: has ## Zitate', QUELLE_WITH_ZITATE)
checkSplice('fixture: no ## Zitate (Rand shape)', QUELLE_WITHOUT_ZITATE)

// And against whatever is really in the vault right now, if anything.
for (const filename of vaultFiles('30_Quellen')) {
  checkSplice(`vault: ${filename}`, readFileSync(join(VAULT, '30_Quellen', filename), 'utf8'))
}

{
  // A file with no sections at all still keeps the quote.
  const bare = '---\ntype: quelle\n---\n\n# Q Test\n'
  const patched = spliceQuoteIntoQuelle(bare, QUOTE)
  check('bare note gains a ## Zitate section', patched.includes('## Zitate'))
  check('bare note keeps the quote', patched.includes('> Design ist Systementwurf.'))
}

/* ------------------------------------------------- card titles from names */

{
  const zettel = describeFilename(FILENAMES.zettel)
  eq('Zettel title drops the meaningless ID', zettel.title, 'Design ist das Entwerfen von Systemen')
  eq('Zettel gets a date subtitle', zettel.subtitle, '2. August 2026')
  eq('Zettel title with umlauts survives', describeFilename(FILENAMES.zettelUmlaut).title, 'Mit der Größe eines Systems wächst sein Repertoire')
  eq('Eingang title is the Stichwort', describeFilename(FILENAMES.eingang).title, 'Vorlesung Systemtheorie')
  eq('Struktur drops the STR prefix', describeFilename(FILENAMES.struktur).title, 'Autopoiesis und Systemtheorie')
  eq('Struktur subtitle', describeFilename(FILENAMES.struktur).subtitle, 'Strukturzettel')
  eq('Quelle keeps author, year and title', describeFilename(FILENAMES.quelle).title, 'Feige 2014 – Philosophie des Jazz')

  // Whatever is in the vault must also parse into something usable.
  for (const filename of vaultFiles('10_Zettel')) {
    const { title, subtitle } = describeFilename(filename)
    check(`[vault Zettel] "${filename.slice(0, 26)}…" drops the ID`, !/^\d{12}/.test(title))
    check(`[vault Zettel] "${filename.slice(0, 26)}…" has a date`, /\d{4}$/.test(subtitle))
  }
  for (const filename of vaultFiles('20_Struktur')) {
    check(`[vault Struktur] "${filename}" drops the prefix`, !describeFilename(filename).title.startsWith('STR'))
  }
}

/* ---------------------------------------------------------------- preview */

{
  const preview = previewOf(ZETTEL)
  check('preview skips frontmatter', !preview.includes('follows-from'))
  check('preview skips the heading', !preview.startsWith('Design ist das Entwerfen'))
  check('preview starts at the prose', preview.startsWith('Gutes Design ist wie gute Kunst'))
  check('preview is truncated', preview.length <= 241)
  check('preview of an empty note is empty', previewOf('---\ntype: eingang\n---\n\n# Titel\n') === '')
}

/* ----------------------------------------------------------------- report */

const vaultNotes = vaultFiles('10_Zettel').length + vaultFiles('30_Quellen').length
console.log(
  `\n  ${passed} checks passed` +
    (vaultNotes > 0
      ? `  (incl. ${vaultNotes} live vault notes)`
      : '  (vault empty — fixtures only)'),
)
if (failures.length > 0) {
  console.log(`  ${failures.length} FAILED:\n`)
  for (const failure of failures) console.log(`   ✗ ${failure}`)
  process.exit(1)
}
console.log('  all green\n')
