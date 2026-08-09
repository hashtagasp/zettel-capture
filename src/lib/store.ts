/**
 * IndexedDB is the source of truth. A capture is durable the moment it is
 * typed; GitHub is a downstream consumer that catches up when it can.
 *
 * Nothing in this app is ever "in flight only". That is the single failure mode
 * that would end this vault the way the previous three ended.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { GitHubConfig, RepoEntry } from './github'

export type SyncState = 'draft' | 'queued' | 'pushing' | 'synced' | 'error'

export type DraftKind = 'eingang' | 'quelle-append'

export interface Draft {
  id: string
  kind: DraftKind
  laneId: string
  /** For `quelle-append`: the existing `30_Quellen/Q ….md` being appended to. */
  targetPath?: string
  /**
   * The note's title. Becomes the `<Stichwort>` in the filename and the `# `
   * heading. Empty falls back to the first line of the body, so a note captured
   * in a hurry still gets a sensible name.
   */
  title?: string
  /** Display name of the append target, for the editor header. */
  targetLabel?: string
  /**
   * A source capture whose Quelle isn't in the vault yet, so it lands in
   * 00_Eingang with a `## Quellenangabe` stub instead.
   */
  sourceFallback?: boolean
  body: string
  attachmentIds: string[]
  createdAt: number
  updatedAt: number
  syncState: SyncState
  /** Set once pushed, so the card can link to the real file. */
  remotePath?: string
  lastError?: string
  /** Consecutive failed pushes; drives the backoff. */
  attempts: number
  /** Epoch ms before which the pusher should not retry this draft. */
  nextAttemptAt?: number
}

export interface Attachment {
  id: string
  blob: Blob
  filename: string
  contentType: string
  createdAt: number
}

export interface FolderIndex {
  folder: string
  entries: RepoEntry[]
  fetchedAt: number
}

interface ZettelDB extends DBSchema {
  drafts: {
    key: string
    value: Draft
    indexes: { byUpdated: number; bySyncState: SyncState }
  }
  attachments: { key: string; value: Attachment }
  folderIndex: { key: string; value: FolderIndex }
  settings: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<ZettelDB>> | null = null

export function db(): Promise<IDBPDatabase<ZettelDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ZettelDB>('zettel-capture', 1, {
      upgrade(database) {
        const drafts = database.createObjectStore('drafts', { keyPath: 'id' })
        drafts.createIndex('byUpdated', 'updatedAt')
        drafts.createIndex('bySyncState', 'syncState')
        database.createObjectStore('attachments', { keyPath: 'id' })
        database.createObjectStore('folderIndex', { keyPath: 'folder' })
        database.createObjectStore('settings')
      },
    })
  }
  return dbPromise
}

export const newId = (): string =>
  crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/* ---------------------------------------------------------------- settings */

export async function loadConfig(): Promise<GitHubConfig | null> {
  const value = (await (await db()).get('settings', 'github')) as GitHubConfig | undefined
  return value ?? null
}

export async function saveConfig(config: GitHubConfig): Promise<void> {
  await (await db()).put('settings', config, 'github')
}

export async function clearConfig(): Promise<void> {
  await (await db()).delete('settings', 'github')
}

/* ------------------------------------------------------------------ drafts */

export async function putDraft(draft: Draft): Promise<void> {
  await (await db()).put('drafts', draft)
}

export async function getDraft(id: string): Promise<Draft | undefined> {
  return (await db()).get('drafts', id)
}

export async function deleteDraft(id: string): Promise<void> {
  const database = await db()
  const draft = await database.get('drafts', id)
  if (draft) {
    await Promise.all(draft.attachmentIds.map((a) => database.delete('attachments', a)))
  }
  await database.delete('drafts', id)
}

export async function allDrafts(): Promise<Draft[]> {
  const drafts = await (await db()).getAllFromIndex('drafts', 'byUpdated')
  return drafts.reverse() // newest first — the card stack shows the newest in front
}

export async function draftsForLane(laneId: string): Promise<Draft[]> {
  return (await allDrafts()).filter((d) => d.laneId === laneId)
}

/** Drafts eligible for a push attempt right now. */
export async function pendingDrafts(now = Date.now()): Promise<Draft[]> {
  const drafts = await allDrafts()
  return drafts
    .filter(
      (d) =>
        (d.syncState === 'queued' || d.syncState === 'error' || d.syncState === 'pushing') &&
        (d.nextAttemptAt ?? 0) <= now,
    )
    .sort((a, b) => a.createdAt - b.createdAt) // oldest capture pushes first
}

export async function countUnsynced(): Promise<number> {
  return (await allDrafts()).filter((d) => d.syncState !== 'synced').length
}

/* ------------------------------------------------------------- attachments */

export async function putAttachment(attachment: Attachment): Promise<void> {
  await (await db()).put('attachments', attachment)
}

export async function getAttachment(id: string): Promise<Attachment | undefined> {
  return (await db()).get('attachments', id)
}

export async function getAttachments(ids: string[]): Promise<Attachment[]> {
  const database = await db()
  const found = await Promise.all(ids.map((id) => database.get('attachments', id)))
  return found.filter((a): a is Attachment => Boolean(a))
}

/** Blobs are dropped once the note is on GitHub; the markdown keeps the embed. */
export async function dropAttachmentBlobs(ids: string[]): Promise<void> {
  const database = await db()
  await Promise.all(ids.map((id) => database.delete('attachments', id)))
}

/* ------------------------------------------------------------ folder index */

export async function cacheFolder(folder: string, entries: RepoEntry[]): Promise<void> {
  await (await db()).put('folderIndex', { folder, entries, fetchedAt: Date.now() })
}

export async function cachedFolder(folder: string): Promise<FolderIndex | undefined> {
  return (await db()).get('folderIndex', folder)
}

export async function cachedFolders(folders: string[]): Promise<FolderIndex[]> {
  const database = await db()
  const found = await Promise.all(folders.map((f) => database.get('folderIndex', f)))
  return found.filter((f): f is FolderIndex => Boolean(f))
}
