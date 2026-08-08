/**
 * The push queue.
 *
 * Runs in both the page and the service worker, so a note captured in a tunnel
 * reaches the vault even if the app is never reopened. Every step is
 * idempotent: a draft that fails halfway leaves its already-uploaded
 * attachments in place and simply retries the note.
 */

import {
  GitHubError,
  NetworkError,
  exists,
  listFolder,
  putBinaryFile,
  putTextFile,
  readFile,
  type GitHubConfig,
} from './github'
import { ATTACHMENT_FOLDER } from './lanes'
import {
  buildEingangNote,
  buildQuoteBlock,
  deduplicateName,
  eingangFilename,
  spliceQuoteIntoQuelle,
  stripExtension,
} from './notes'
import {
  cacheFolder,
  dropAttachmentBlobs,
  getAttachments,
  loadConfig,
  pendingDrafts,
  putDraft,
  type Draft,
} from './store'

/** 30 s, 2 min, 8 min, 32 min, capped at 2 h. */
function backoffMs(attempts: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempts - 1), 7_200_000)
}

async function uploadAttachments(config: GitHubConfig, draft: Draft): Promise<string[]> {
  const attachments = await getAttachments(draft.attachmentIds)
  if (attachments.length === 0) return []

  const existing = await listFolder(config, ATTACHMENT_FOLDER)
  const taken = new Set(existing.map((e) => e.name))
  const names: string[] = []

  for (const attachment of attachments) {
    const name = deduplicateName(attachment.filename, taken)
    taken.add(name)
    await putBinaryFile(
      config,
      `${ATTACHMENT_FOLDER}/${name}`,
      attachment.blob,
      `Anhang: ${name}`,
    )
    names.push(name)
  }
  return names
}

async function pushEingang(config: GitHubConfig, draft: Draft): Promise<string> {
  const embeds = await uploadAttachments(config, draft)
  const date = new Date(draft.createdAt)

  const existing = await listFolder(config, '00_Eingang')
  const taken = new Set(existing.map((e) => e.name))
  const base = eingangFilename(date, draft.body)
  let filename = deduplicateName(base, taken)

  // The listing can be seconds stale; confirm against the branch before writing
  // so a same-minute capture from another device is never overwritten.
  while (await exists(config, `00_Eingang/${filename}`)) {
    taken.add(filename)
    filename = deduplicateName(base, taken)
  }

  const markdown = buildEingangNote({
    date,
    title: stripExtension(filename),
    body: draft.body,
    embeds,
    quellenangabe: draft.sourceFallback,
  })

  const path = `00_Eingang/${filename}`
  await putTextFile(config, path, markdown, `Eingang: ${stripExtension(filename)}`)
  return path
}

async function pushQuelleAppend(config: GitHubConfig, draft: Draft): Promise<string> {
  const path = draft.targetPath
  if (!path) throw new GitHubError('Kein Ziel für die Quellennotiz.', 0, false)

  const embeds = await uploadAttachments(config, draft)

  // Re-read immediately before writing: the sha must be current, and the
  // desktop may have edited this file since the draft was written.
  const current = await readFile(config, path)
  if (!current) {
    throw new GitHubError(`Quellennotiz nicht gefunden: ${path}`, 404, false)
  }

  const updated = spliceQuoteIntoQuelle(current.text, buildQuoteBlock(draft.body, embeds))
  await putTextFile(config, path, updated, `Zitat: ${draft.targetLabel ?? path}`, current.sha)
  return path
}

async function pushOne(config: GitHubConfig, draft: Draft): Promise<void> {
  await putDraft({ ...draft, syncState: 'pushing' })

  try {
    const remotePath =
      draft.kind === 'quelle-append'
        ? await pushQuelleAppend(config, draft)
        : await pushEingang(config, draft)

    await putDraft({
      ...draft,
      syncState: 'synced',
      remotePath,
      attempts: 0,
      lastError: undefined,
      nextAttemptAt: undefined,
    })
    // The markdown now carries the embeds; the local blobs are dead weight.
    await dropAttachmentBlobs(draft.attachmentIds)
  } catch (err) {
    const attempts = draft.attempts + 1
    const retryable = err instanceof NetworkError || (err instanceof GitHubError && err.retryable)

    await putDraft({
      ...draft,
      syncState: retryable ? 'queued' : 'error',
      attempts,
      lastError: err instanceof Error ? err.message : String(err),
      nextAttemptAt: retryable ? Date.now() + backoffMs(attempts) : undefined,
    })
    throw err
  }
}

export interface FlushResult {
  pushed: number
  failed: number
  remaining: number
}

let flushing: Promise<FlushResult> | null = null

const IDLE: FlushResult = { pushed: 0, failed: 0, remaining: 0 }

/**
 * Drains the queue. Concurrent calls in this context share one run; the Web
 * Locks API extends that across the page and the service worker, which would
 * otherwise both push the same draft and create two files.
 */
export function flush(): Promise<FlushResult> {
  if (!flushing) {
    flushing = withLock(drain).finally(() => {
      flushing = null
    })
  }
  return flushing
}

async function withLock(run: () => Promise<FlushResult>): Promise<FlushResult> {
  if (typeof navigator === 'undefined' || !navigator.locks) return run()
  const result = await navigator.locks.request(
    'zettel-flush',
    { ifAvailable: true },
    async (lock) => (lock ? run() : null),
  )
  // Another context holds the lock and is already draining the same queue.
  return result ?? IDLE
}

async function drain(): Promise<FlushResult> {
  const config = await loadConfig()
  if (!config) return { pushed: 0, failed: 0, remaining: 0 }

  const queue = await pendingDrafts()
  let pushed = 0
  let failed = 0

  // Sequential: order of capture is preserved, and a burst of notes can't trip
  // GitHub's secondary rate limits on concurrent writes to one repo.
  for (const draft of queue) {
    try {
      await pushOne(config, draft)
      pushed++
    } catch (err) {
      failed++
      // A dead token or missing repo fails every remaining draft identically.
      if (err instanceof GitHubError && !err.retryable && err.status !== 404) break
      if (err instanceof NetworkError) break
    }
  }

  const remaining = (await pendingDrafts(Date.now() + 86_400_000)).length
  return { pushed, failed, remaining }
}

/** Refresh a folder listing into the local cache. Best-effort; never throws. */
export async function refreshFolder(folder: string): Promise<void> {
  const config = await loadConfig()
  if (!config) return
  try {
    await cacheFolder(folder, await listFolder(config, folder))
  } catch {
    // Offline or unauthorised — the cached listing stays, which is the point.
  }
}
