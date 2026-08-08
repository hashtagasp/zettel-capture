/**
 * Verification against the real vault. Run with `npm test`.
 *
 * These are the failure modes that would quietly corrupt 96_Obsidian_Structure:
 * a mangled umlaut in a filename, a quote spliced over `## Eigene Notizen`, or
 * a note whose frontmatter no longer matches what the Register's dataview
 * queries look for.
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

const VAULT = process.env.VAULT ?? '/Users/christianmiller/Desktop/Body/Lab/96_Obsidian_Structure'

/**
 * The richest checks read the real vault. On CI there is no vault, so those are
 * skipped rather than faked — a green run against invented fixtures would prove
 * nothing about `Q Rand 1957 – Atlas Shrugged.md`.
 */
const HAS_VAULT = existsSync(VAULT)

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

/* ------------------------------------------------------- base64 / unicode */

{
  const samples = [
    'Fließtext über Größe',
    'Q Feige 2014 – Philosophie des Jazz', // en-dash U+2013
    'Lingua francas demokratisieren den Erkenntnisgewinn',
    'Zettelkasten scheitert an Verkomplizierung — nicht an Einfachheit', // em-dash
    '„Typographische Anführungszeichen"',
    'Emoji im Titel 🗂',
  ]

  for (const sample of samples) {
    const ours = utf8ToBase64(sample)
    const node = Buffer.from(sample, 'utf8').toString('base64')
    eq(`base64 matches Node for "${sample.slice(0, 28)}…"`, ours, node)
    eq(`base64 round-trips "${sample.slice(0, 28)}…"`, base64ToUtf8(ours), sample)
  }

  // A large binary payload must not blow the argument stack.
  const big = new Uint8Array(600_000).fill(200)
  const encoded = utf8ToBase64(new TextDecoder('latin1').decode(big))
  check('base64 handles a 600 kB payload without throwing', encoded.length > 0)
}

/* ---------------------------------------------------------- NFC filenames */

{
  const composed = 'Fließtext über Größe'
  const nfd = composed.normalize('NFD') // decomposed, as macOS hands filenames out
  check('the two forms really do differ byte-wise', nfd !== composed)
  check('NFD input normalises to NFC', nfc(nfd) === composed)
  check('NFC comparison sees the two forms as equal', nfc(nfd) === nfc(composed))
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
  eq(
    'keeps umlauts, strips nothing legal',
    sanitizeFilenamePart('Über Größe und Beweglichkeit'),
    'Über Größe und Beweglichkeit',
  )
  eq(
    'strips path separators and wikilink brackets without fusing words',
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
    sanitizeFilenamePart('Ein sehr langer Gedanke der weit über sechzig Zeichen hinausgeht und immer weiter').length <= 60,
  )
  check('never ends in a dot', !sanitizeFilenamePart('Warum denn nur...').endsWith('.'))

  const date = new Date(2026, 7, 8, 14, 32)
  eq(
    'Eingang filename follows the Legende pattern',
    eingangFilename(date, 'Vorlesung Systemtheorie'),
    'E 2026-08-08 Vorlesung Systemtheorie.md',
  )
  eq(
    'empty note still gets a filename',
    eingangFilename(date, '   \n  '),
    'E 2026-08-08 Notiz 1432.md',
  )

  const taken = new Set(['E 2026-08-08 Notiz.md', 'E 2026-08-08 Notiz 2.md'])
  eq('collisions increment', deduplicateName('E 2026-08-08 Notiz.md', taken), 'E 2026-08-08 Notiz 3.md')
  eq('no collision passes through', deduplicateName('E 2026-08-08 Neu.md', taken), 'E 2026-08-08 Neu.md')
}

/* --------------------------------------------------- Eingang note content */

if (HAS_VAULT) {
  const markdown = buildEingangNote({
    date: new Date(2026, 7, 8, 14, 32),
    title: 'E 2026-08-08 Vorlesung Systemtheorie',
    body: 'Luhmann unterscheidet Medium und Form.',
    embeds: ['20260808-1432 Tafelbild.jpg'],
  })

  const template = readFileSync(join(VAULT, '90_Meta/Templates/Eingang.md'), 'utf8')
  for (const key of ['type: eingang', 'status: roh', 'tags: []']) {
    check(`frontmatter carries "${key}" as in the template`, markdown.includes(key))
    check(`template itself has "${key}"`, template.includes(key))
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
}

/* ----------------------------------------- splicing a quote into a Quelle */

if (HAS_VAULT) {
  const quellen = readdirSync(join(VAULT, '30_Quellen')).filter((f) => f.endsWith('.md'))
  check('found the real Quellen notes', quellen.length > 0, `${quellen.length} files`)

  const block = buildQuoteBlock('Design ist Systementwurf.\nZweite Zeile.', [
    '20260808-1432 Dorst S34.jpg',
  ])
  check('quote lines are prefixed', block.includes('> Design ist Systementwurf.'))
  check('second line is prefixed too', block.includes('> Zweite Zeile.'))
  check('photo rides along', block.includes('![[20260808-1432 Dorst S34.jpg]]'))
  check('page stub matches the template style', block.includes('*S. *'))

  for (const filename of quellen) {
    const original = readFileSync(join(VAULT, '30_Quellen', filename), 'utf8')
    const updated = spliceQuoteIntoQuelle(original, block)

    check(`[${filename}] quote was inserted`, updated.includes('> Design ist Systementwurf.'))

    if (original.includes('## Eigene Notizen')) {
      const zitateAt = updated.indexOf('## Zitate')
      const notizenAt = updated.indexOf('## Eigene Notizen')
      const quoteAt = updated.indexOf('> Design ist Systementwurf.')
      check(`[${filename}] quote landed inside ## Zitate`, quoteAt > zitateAt && quoteAt < notizenAt)
      check(`[${filename}] ## Eigene Notizen survived`, notizenAt !== -1)
    }

    // The dataview block at the end of every Quelle must be untouched.
    if (original.includes('```dataview')) {
      check(
        `[${filename}] dataview block intact`,
        updated.includes('```dataview') &&
          (updated.match(/```/g) ?? []).length === (original.match(/```/g) ?? []).length,
      )
    }

    // Everything that was there before is still there, and the only heading
    // the splice may add is a `## Zitate` for a note that lacked one.
    const originalHeadings = original.match(/^##\s+.*$/gm) ?? []
    const updatedHeadings = updated.match(/^##\s+.*$/gm) ?? []
    check(
      `[${filename}] every original heading survived`,
      originalHeadings.every((h) => updatedHeadings.includes(h)),
    )
    const added = updatedHeadings.filter((h) => !originalHeadings.includes(h))
    check(
      `[${filename}] added at most a "## Zitate" heading`,
      added.length === 0 || (added.length === 1 && added[0].trim() === '## Zitate'),
      `added: ${JSON.stringify(added)}`,
    )
    check(
      `[${filename}] no heading duplicated`,
      new Set(updatedHeadings).size === updatedHeadings.length,
    )
    if (added.length === 1) {
      // A created section must sit above the reflective sections, never after
      // the trailing dataview block.
      const zitateAt = updated.indexOf('## Zitate')
      const dataviewAt = updated.indexOf('## Daraus entstandene')
      check(
        `[${filename}] created ## Zitate sits above the dataview section`,
        dataviewAt === -1 || zitateAt < dataviewAt,
      )
    }
    check(`[${filename}] frontmatter untouched`, updated.startsWith(original.slice(0, 60)))
    check(`[${filename}] no triple blank lines`, !/\n{3,}/.test(updated))
  }

  // A file with no ## Zitate section gets one appended rather than losing the quote.
  const bare = '---\ntype: quelle\n---\n\n# Q Test\n\n## Eigene Notizen\n\n- nichts\n'
  const patched = spliceQuoteIntoQuelle(bare, block)
  check('missing ## Zitate is created', patched.includes('## Zitate'))
  check('quote is not lost', patched.includes('> Design ist Systementwurf.'))
}

/* --------------------------------------- card titles from real filenames */

if (HAS_VAULT) {
  const zettel = readdirSync(join(VAULT, '10_Zettel')).filter((f) => f.endsWith('.md'))
  for (const filename of zettel) {
    const { title, subtitle } = describeFilename(filename)
    check(`[Zettel] "${filename.slice(0, 30)}…" drops the meaningless ID`, !/^\d{12}/.test(title))
    check(`[Zettel] "${filename.slice(0, 30)}…" title is non-empty`, title.length > 0)
    check(`[Zettel] "${filename.slice(0, 30)}…" got a date subtitle`, /\d{4}$/.test(subtitle))
  }

  const struktur = readdirSync(join(VAULT, '20_Struktur')).filter((f) => f.endsWith('.md'))
  for (const filename of struktur) {
    const { title, subtitle } = describeFilename(filename)
    check(`[Struktur] "${filename}" drops the STR prefix`, !title.startsWith('STR'))
    eq(`[Struktur] "${filename}" subtitle`, subtitle, 'Strukturzettel')
  }

  eq(
    'Quelle title keeps author, year and title',
    describeFilename('Q Feige 2014 – Philosophie des Jazz.md').title,
    'Feige 2014 – Philosophie des Jazz',
  )
  eq(
    'Eingang title is the Stichwort',
    describeFilename('E 2026-08-08 Vorlesung Systemtheorie.md').title,
    'Vorlesung Systemtheorie',
  )
}

/* ---------------------------------------------------------------- preview */

if (HAS_VAULT) {
  const zettelPath = join(
    VAULT,
    '10_Zettel/202608021015 Design ist das Entwerfen von Systemen.md',
  )
  const preview = previewOf(readFileSync(zettelPath, 'utf8'))
  check('preview skips frontmatter', !preview.includes('follows-from'))
  check('preview skips the heading', !preview.startsWith('Design ist das Entwerfen'))
  check('preview has prose', preview.startsWith('Gutes Design ist wie gute Kunst'))
  check('preview is truncated', preview.length <= 241)
}

/* ----------------------------------------------------------------- report */

console.log(
  `\n  ${passed} checks passed${HAS_VAULT ? '' : '  (vault not found — vault-backed checks skipped)'}`,
)
if (failures.length > 0) {
  console.log(`  ${failures.length} FAILED:\n`)
  for (const failure of failures) console.log(`   ✗ ${failure}`)
  process.exit(1)
}
console.log('  all green\n')
