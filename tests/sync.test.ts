/**
 * End-to-end test of the push queue against a mocked GitHub.
 *
 * This is the code that must not lose a note. Every assertion here maps to a
 * way the vault could be damaged or a capture silently dropped: a note written
 * to the wrong path, an attachment uploaded but never referenced, a transient
 * network failure marked permanent, or a bad token retried forever.
 */

import 'fake-indexeddb/auto'
import { base64ToUtf8 } from '../src/lib/encoding'
import { getAttachment, getDraft, loadConfig, putAttachment, putDraft, saveConfig, type Draft } from '../src/lib/store'
import { flush } from '../src/lib/sync'

let passed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = '') {
  if (condition) passed++
  else failures.push(`${name}${detail ? `\n     ${detail}` : ''}`)
}

const eq = (name: string, actual: unknown, expected: unknown) =>
  check(
    name,
    actual === expected,
    `expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`,
  )

/* ------------------------------------------------------------ fake GitHub */

interface Call {
  method: string
  url: string
  body: Record<string, string> | null
}

let calls: Call[] = []
/** path (decoded) -> file content */
let remote = new Map<string, string>()
let failWith: 'network' | number | null = null

function installFetch() {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : null
    calls.push({ method, url, body })

    if (failWith === 'network') throw new TypeError('Failed to fetch')
    if (typeof failWith === 'number') {
      return new Response(JSON.stringify({ message: 'nope' }), { status: failWith })
    }

    const path = decodeURIComponent(
      (url.split('/contents/')[1] ?? '').split('?')[0],
    )

    if (url.includes('/branches/')) return Response.json({ name: 'main' })

    if (method === 'GET') {
      // Folder listing.
      if (!path.includes('.')) {
        const entries = [...remote.keys()]
          .filter((p) => p.startsWith(`${path}/`))
          .map((p) => ({
            name: p.slice(path.length + 1),
            path: p,
            sha: `sha-${p}`,
            size: remote.get(p)!.length,
            type: 'file',
          }))
        return Response.json(entries)
      }
      // Single file.
      const content = remote.get(path)
      if (content === undefined) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      }
      return Response.json({
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
        sha: `sha-${path}`,
      })
    }

    // PUT
    remote.set(path, base64ToUtf8(body!.content))
    return Response.json({ content: { sha: `sha-${path}`, path } })
  }) as typeof fetch
}

function reset() {
  calls = []
  failWith = null
}

const draft = (over: Partial<Draft> = {}): Draft => ({
  id: `d-${Math.random().toString(36).slice(2)}`,
  kind: 'eingang',
  laneId: 'eingang',
  body: 'Luhmann unterscheidet Medium und Form.',
  attachmentIds: [],
  createdAt: new Date(2026, 7, 8, 14, 32).getTime(),
  updatedAt: Date.now(),
  syncState: 'queued',
  attempts: 0,
  ...over,
})

/* ------------------------------------------------------------------- runs */

async function main() {
  installFetch()
  await saveConfig({ owner: 'cm', repo: 'zettelkasten', branch: 'main', token: 'tok' })
  check('config round-trips through IndexedDB', (await loadConfig())?.repo === 'zettelkasten')

  /* --- a plain Eingang note ------------------------------------------- */
  {
    reset()
    remote = new Map()
    const d = draft()
    await putDraft(d)
    const result = await flush()

    eq('one note pushed', result.pushed, 1)
    eq('nothing failed', result.failed, 0)
    eq('queue is empty', result.remaining, 0)

    const put = calls.find((c) => c.method === 'PUT')
    check('a PUT was issued', Boolean(put))
    check(
      'note written to 00_Eingang with the Legende filename',
      decodeURIComponent(put!.url).includes(
        '00_Eingang/E 2026-08-08 Luhmann unterscheidet Medium und Form.md',
      ),
      decodeURIComponent(put!.url),
    )
    eq('written on the configured branch', put!.body!.branch, 'main')
    check('created without a sha (new file)', put!.body!.sha === undefined)

    const written = [...remote.values()][0]
    check('frontmatter is intact', written.startsWith('---\ntype: eingang\nstatus: roh\n'))
    check('body survived', written.includes('Luhmann unterscheidet Medium und Form.'))

    const saved = await getDraft(d.id)
    eq('draft is marked synced', saved?.syncState, 'synced')
    eq('attempt counter reset', saved?.attempts, 0)
    check('remote path recorded', saved?.remotePath?.startsWith('00_Eingang/') ?? false)

    // Latency is round trips. A plain note should cost a listing and a write —
    // nothing else. An extra probe here is a second of thumb-twiddling on a
    // phone connection.
    eq('a text note costs exactly 2 requests', calls.length, 2)
    eq('  1st is the folder listing', `${calls[0].method} ${calls[0].url.includes('00_Eingang')}`, 'GET true')
    eq('  2nd is the write', calls[1].method, 'PUT')
  }

  /* --- the collision probe still runs when a name is actually taken ---- */
  {
    reset()
    remote = new Map([['00_Eingang/E 2026-08-08 Belegt.md', 'schon da']])
    const d = draft({ body: 'Belegt.' })
    await putDraft(d)
    await flush()

    check(
      'a taken name is verified against the branch before writing',
      calls.some((c) => c.method === 'GET' && decodeURIComponent(c.url).includes('Belegt 2.md')),
      calls.map((c) => `${c.method} ${decodeURIComponent(c.url).split('/contents/')[1] ?? ''}`).join(' | '),
    )
    check('original file untouched', remote.get('00_Eingang/E 2026-08-08 Belegt.md') === 'schon da')
    check('new note written beside it', remote.has('00_Eingang/E 2026-08-08 Belegt 2.md'))
  }

  /* --- umlauts and an en-dash survive the whole round trip -------------- */
  {
    reset()
    remote = new Map()
    const d = draft({ body: 'Fließtext über Größe – und der Ausdrucksverlust' })
    await putDraft(d)
    await flush()

    const path = [...remote.keys()][0]
    eq(
      'umlauts and en-dash survive into the path',
      path,
      '00_Eingang/E 2026-08-08 Fließtext über Größe – und der Ausdrucksverlust.md',
    )
    check('content decodes back to the same text', remote.get(path)!.includes('Fließtext über Größe – und der Ausdrucksverlust'))
    const put = calls.find((c) => c.method === 'PUT')!
    check('URL is percent-encoded, not raw', !/[äöüßÄÖÜ–]/.test(put.url), put.url)
  }

  /* --- a photo is uploaded before the note that references it ---------- */
  {
    reset()
    remote = new Map()
    const attachmentId = 'a-1'
    await putAttachment({
      id: attachmentId,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      filename: '20260808-1432 Tafelbild.jpg',
      contentType: 'image/jpeg',
      createdAt: Date.now(),
    })
    const d = draft({ attachmentIds: [attachmentId] })
    await putDraft(d)
    await flush()

    const puts = calls.filter((c) => c.method === 'PUT')
    eq('two PUTs: photo then note', puts.length, 2)
    check('photo went to Anhang/', decodeURIComponent(puts[0].url).includes('Anhang/20260808-1432 Tafelbild.jpg'))
    check('note went to 00_Eingang/', decodeURIComponent(puts[1].url).includes('00_Eingang/'))

    const note = [...remote.entries()].find(([p]) => p.startsWith('00_Eingang/'))![1]
    check('note embeds the photo', note.includes('![[20260808-1432 Tafelbild.jpg]]'))
    check('blob dropped after upload', (await getAttachment(attachmentId)) === undefined)
  }

  /* --- appending a quote to an existing Quelle ------------------------- */
  {
    reset()
    remote = new Map([
      [
        '30_Quellen/Q Feige 2014 – Philosophie des Jazz.md',
        '---\ntype: quelle\n---\n\n# Feige\n\n## Zitate\n\n> Alt.\n\n*S. 12.*\n\n## Eigene Notizen\n\n- vorhanden\n',
      ],
    ])
    const d = draft({
      kind: 'quelle-append',
      laneId: 'quellen',
      targetPath: '30_Quellen/Q Feige 2014 – Philosophie des Jazz.md',
      targetLabel: 'Q Feige 2014 – Philosophie des Jazz',
      body: 'Der Vollzug ist das Ziel.',
    })
    await putDraft(d)
    await flush()

    const put = calls.filter((c) => c.method === 'PUT').at(-1)!
    check('re-read the file before writing', calls.some((c) => c.method === 'GET' && c.url.includes('Philosophie')))
    eq('replaced using the current sha', put.body!.sha, 'sha-30_Quellen/Q Feige 2014 – Philosophie des Jazz.md')

    const updated = remote.get('30_Quellen/Q Feige 2014 – Philosophie des Jazz.md')!
    check('new quote present', updated.includes('> Der Vollzug ist das Ziel.'))
    check('old quote preserved', updated.includes('> Alt.'))
    check('Eigene Notizen preserved', updated.includes('- vorhanden'))
    check(
      'quote landed inside ## Zitate',
      updated.indexOf('> Der Vollzug') < updated.indexOf('## Eigene Notizen'),
    )
    check('no new file created in 30_Quellen', remote.size === 1, `${remote.size} files`)
  }

  /* --- offline: nothing is lost, the draft stays queued with backoff ---- */
  {
    reset()
    remote = new Map()
    failWith = 'network'
    const d = draft({ body: 'Im Tunnel geschrieben.' })
    await putDraft(d)
    const result = await flush()

    eq('nothing pushed while offline', result.pushed, 0)
    eq('one failure recorded', result.failed, 1)
    check('note still counted as outstanding', result.remaining >= 1)

    const saved = await getDraft(d.id)
    eq('stays queued, not errored', saved?.syncState, 'queued')
    eq('attempt counted', saved?.attempts, 1)
    check('backoff scheduled into the future', (saved?.nextAttemptAt ?? 0) > Date.now())
    eq('body fully intact on the device', saved?.body, 'Im Tunnel geschrieben.')

    // Back online, past the backoff window: it goes through untouched.
    failWith = null
    await putDraft({ ...saved!, nextAttemptAt: Date.now() - 1 })
    const retry = await flush()
    eq('retry succeeds once back online', retry.pushed, 1)
    eq('now synced', (await getDraft(d.id))?.syncState, 'synced')
    check('the tunnel note reached the vault', [...remote.values()].some((c) => c.includes('Im Tunnel geschrieben.')))
  }

  /* --- a dead token is permanent, not retried forever ------------------ */
  {
    reset()
    remote = new Map()
    failWith = 401
    const d = draft({ body: 'Token kaputt.' })
    await putDraft(d)
    await flush()

    const saved = await getDraft(d.id)
    eq('marked as a hard error', saved?.syncState, 'error')
    check('no automatic retry scheduled', saved?.nextAttemptAt === undefined)
    check('the reason is recorded for the settings screen', Boolean(saved?.lastError))
    check('note still on the device', saved?.body === 'Token kaputt.')

    // Once the token is fixed, "Erneut versuchen" must pick the note back up —
    // a hard error parks a capture, it never abandons it.
    failWith = null
    await flush()
    eq('recovers after the token is fixed', (await getDraft(d.id))?.syncState, 'synced')
    check('the parked note reached the vault', [...remote.values()].some((c) => c.includes('Token kaputt.')))
  }

  /* --- two notes captured in the same minute don't collide ------------- */
  {
    reset()
    remote = new Map()
    failWith = null
    const a = draft({ body: 'Gleicher Anfang.' })
    const b = draft({ body: 'Gleicher Anfang.' })
    await putDraft(a)
    await putDraft(b)
    await flush()

    const names = [...remote.keys()].filter((p) => p.includes('Gleicher Anfang')).sort()
    eq('both notes exist as separate files', names.length, 2)
    check('neither overwrote the other', new Set(names).size === 2)
    check(
      'one keeps the plain name, the other gets a numbered suffix',
      names.includes('00_Eingang/E 2026-08-08 Gleicher Anfang.md') &&
        names.includes('00_Eingang/E 2026-08-08 Gleicher Anfang 2.md'),
      names.join(' | '),
    )
  }

  console.log(`\n  ${passed} checks passed`)
  if (failures.length > 0) {
    console.log(`  ${failures.length} FAILED:\n`)
    for (const failure of failures) console.log(`   ✗ ${failure}`)
    process.exit(1)
  }
  console.log('  all green\n')
}

void main()
