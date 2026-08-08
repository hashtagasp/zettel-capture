/**
 * Minimal GitHub Contents API client.
 *
 * Deliberately not a git implementation. Creating a note is one PUT; listing a
 * folder is one GET. There is no clone, no index, no merge — which is only safe
 * because the phone creates new files and appends to existing ones, and never
 * rewrites a file the desktop is also editing.
 */

import { base64ToUtf8, blobToBase64, encodeRepoPath, nfc, utf8ToBase64 } from './encoding'

const API = 'https://api.github.com'

export interface GitHubConfig {
  owner: string
  repo: string
  token: string
  branch: string
}

export interface RepoEntry {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir'
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

/** Thrown when the device is offline or the request never reached GitHub. */
export class NetworkError extends Error {
  readonly retryable = true
  constructor(cause: unknown) {
    super('Keine Verbindung')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

function describe(status: number, body: string): GitHubError {
  const detail = (() => {
    try {
      return (JSON.parse(body).message as string) ?? body
    } catch {
      return body
    }
  })()

  switch (status) {
    case 401:
    case 403:
      return new GitHubError(
        `Token abgelehnt (${status}). Rechte prüfen: Contents read+write.`,
        status,
        false,
      )
    case 404:
      return new GitHubError('Repo oder Pfad nicht gefunden (404).', status, false)
    case 409:
    case 422:
      // Stale sha — the file moved under us. The caller re-reads and retries once.
      return new GitHubError(`Konflikt (${status}): ${detail}`, status, true)
    default:
      return new GitHubError(
        `GitHub ${status}: ${detail}`,
        status,
        status === 429 || status >= 500,
      )
  }
}

async function request(
  config: GitHubConfig,
  path: string,
  init: RequestInit = {},
  accept = 'application/vnd.github+json',
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (err) {
    throw new NetworkError(err)
  }
  if (!res.ok) throw describe(res.status, await res.text().catch(() => ''))
  return res
}

const contentsUrl = (c: GitHubConfig, path: string) =>
  `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodeRepoPath(path)}`

/** Confirms the token works and the branch exists. Used by the settings screen. */
export async function verifyAccess(config: GitHubConfig): Promise<void> {
  const res = await request(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/branches/${encodeURIComponent(config.branch)}`,
  )
  await res.json()
}

export async function listFolder(
  config: GitHubConfig,
  folder: string,
): Promise<RepoEntry[]> {
  let res: Response
  try {
    res = await request(
      config,
      `${contentsUrl(config, folder)}?ref=${encodeURIComponent(config.branch)}`,
    )
  } catch (err) {
    // An empty folder has no tree entry in git, so GitHub answers 404. That is
    // a legitimately empty lane, not an error — 00_Eingang and Anhang are both
    // empty in a fresh vault.
    if (err instanceof GitHubError && err.status === 404) return []
    throw err
  }

  const body = (await res.json()) as RepoEntry[] | RepoEntry
  if (!Array.isArray(body)) return []
  return body
    .filter((e) => e.type === 'file' && !e.name.startsWith('.'))
    .map((e) => ({ ...e, name: nfc(e.name), path: nfc(e.path) }))
}

export interface FileContent {
  text: string
  sha: string
}

export async function readFile(
  config: GitHubConfig,
  path: string,
): Promise<FileContent | null> {
  try {
    const res = await request(
      config,
      `${contentsUrl(config, path)}?ref=${encodeURIComponent(config.branch)}`,
    )
    const body = (await res.json()) as { content?: string; sha: string; encoding?: string }
    if (body.encoding !== 'base64' || body.content === undefined) {
      // Files over 1 MB come back without inline content. No note is that big;
      // treating it as absent is safer than guessing.
      return null
    }
    return { text: base64ToUtf8(body.content), sha: body.sha }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

interface PutResult {
  sha: string
  path: string
}

async function putBase64(
  config: GitHubConfig,
  path: string,
  contentBase64: string,
  message: string,
  sha?: string,
): Promise<PutResult> {
  const res = await request(config, contentsUrl(config, path), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  const body = (await res.json()) as { content: { sha: string; path: string } }
  return { sha: body.content.sha, path: nfc(body.content.path) }
}

/** Create or replace a text file. Pass `sha` to replace, omit it to create. */
export function putTextFile(
  config: GitHubConfig,
  path: string,
  text: string,
  message: string,
  sha?: string,
): Promise<PutResult> {
  return putBase64(config, nfc(path), utf8ToBase64(text), message, sha)
}

/** Upload an image or other binary into the vault (used for `Anhang/`). */
export async function putBinaryFile(
  config: GitHubConfig,
  path: string,
  blob: Blob,
  message: string,
): Promise<PutResult> {
  return putBase64(config, nfc(path), await blobToBase64(blob), message)
}

/**
 * True when the path already exists on the branch. Used to resolve filename
 * collisions before writing, so two notes captured in the same minute don't
 * overwrite each other.
 */
export async function exists(config: GitHubConfig, path: string): Promise<boolean> {
  try {
    await request(
      config,
      `${contentsUrl(config, path)}?ref=${encodeURIComponent(config.branch)}`,
    )
    return true
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false
    throw err
  }
}
