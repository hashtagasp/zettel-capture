import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { GitHubConfig } from '../lib/github'
import { LANES } from '../lib/lanes'
import { buildCards, type Card } from '../lib/cards'
import {
  allDrafts,
  cachedFolder,
  loadConfig,
  newId,
  putDraft,
  type Draft,
} from '../lib/store'
import { flush, refreshFolder } from '../lib/sync'
import { applyTheme, loadTheme, type Theme } from '../lib/theme'
import { useAsync, useOnline, useSyncPump } from '../lib/hooks'
import { Deck } from './Deck'
import { Editor } from './Editor'
import { ListSheet } from './ListSheet'
import { Reader } from './Reader'
import { Settings } from './Settings'

type Sheet =
  | { kind: 'settings' }
  | { kind: 'editor'; draftId: string; camera: boolean }
  | { kind: 'reader'; path: string; canQuote: boolean }
  | { kind: 'list'; laneIndex: number }
  | { kind: 'pickQuelle'; camera: boolean }
  | null

/** A folder listing older than this is refreshed when its lane comes into view. */
const STALE_MS = 5 * 60_000

export function App() {
  const [config, setConfig] = useState<GitHubConfig | null>(null)
  const [ready, setReady] = useState(false)
  const [laneIndex, setLaneIndex] = useState(0)
  const [cardIndex, setCardIndex] = useState<number[]>(() => LANES.map(() => 0))
  const [sheet, setSheet] = useState<Sheet>(null)
  const [nonce, setNonce] = useState(0)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const online = useOnline()

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  /**
   * Saving must start the upload, not merely queue it. Without this the note
   * waits for the next 60-second tick — which reads as the app being slow when
   * it is in fact idle.
   */
  const saveAndSync = useCallback(() => {
    refresh()
    void flush()
      .then(() => refresh())
      .catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    void loadConfig().then((loaded) => {
      setConfig(loaded)
      setReady(true)
      if (!loaded) setSheet({ kind: 'settings' })
    })
  }, [])

  useSyncPump(refresh)

  /* --------------------------------------------------------------- data */

  const [drafts, , draftsLoading] = useAsync<Draft[]>(allDrafts, [nonce], [])

  const [foldersByLane] = useAsync(
    async () => {
      const cached = await Promise.all(LANES.map((lane) => cachedFolder(lane.folder)))
      return cached.map((c) => ({ entries: c?.entries ?? [], fetchedAt: c?.fetchedAt ?? 0 }))
    },
    [nonce],
    LANES.map(() => ({ entries: [], fetchedAt: 0 })),
  )

  const cardsByLane = useMemo(
    () =>
      LANES.map((lane, index) =>
        buildCards(
          lane,
          drafts.filter((d) => d.laneId === lane.id),
          foldersByLane[index]?.entries ?? [],
          foldersByLane[index]?.fetchedAt ?? 0,
        ),
      ),
    [drafts, foldersByLane],
  )

  const unsynced = useMemo(() => drafts.filter((d) => d.syncState !== 'synced').length, [drafts])

  const stepCard = useCallback((lane: number, position: number) => {
    setCardIndex((current) => current.map((v, i) => (i === lane ? position : v)))
  }, [])

  // A lane that gained or lost cards must not leave the position past the end;
  // pushing a note shortens the draft list under you.
  useEffect(() => {
    setCardIndex((current) =>
      current.map((position, lane) =>
        Math.min(position, Math.max(0, (cardsByLane[lane]?.length ?? 1) - 1)),
      ),
    )
  }, [cardsByLane])

  // Pull the visible lane's listing when it goes stale, never on a timer.
  useEffect(() => {
    if (!config) return
    const lane = LANES[laneIndex]
    void (async () => {
      const cached = await cachedFolder(lane.folder)
      if (cached && Date.now() - cached.fetchedAt < STALE_MS) return
      await refreshFolder(lane.folder)
      refresh()
    })()
  }, [config, laneIndex, refresh])

  /* ------------------------------------------------------------ actions */

  const startDraft = useCallback(
    async (
      init: Pick<Draft, 'kind' | 'laneId'> & Partial<Draft>,
      camera = false,
    ): Promise<void> => {
      const now = Date.now()
      const draft: Draft = {
        id: newId(),
        body: '',
        attachmentIds: [],
        createdAt: now,
        updatedAt: now,
        syncState: 'draft',
        attempts: 0,
        ...init,
      }
      await putDraft(draft)
      setSheet({ kind: 'editor', draftId: draft.id, camera })
    },
    [],
  )

  const newEingang = useCallback(
    (body = '', camera = false, sourceFallback = false) =>
      startDraft({ kind: 'eingang', laneId: 'eingang', body, sourceFallback }, camera),
    [startDraft],
  )

  const newQuote = useCallback(
    (path: string, label: string, camera = false) =>
      startDraft(
        { kind: 'quelle-append', laneId: 'quellen', targetPath: path, targetLabel: label },
        camera,
      ),
    [startDraft],
  )

  /* Launcher shortcuts and the Android share sheet both arrive as a navigation
   * with query parameters. Handle once, then scrub the URL so a reload doesn't
   * open a second empty note. */
  useEffect(() => {
    if (!ready || !config) return
    const params = new URLSearchParams(location.search)
    const shared = [params.get('title'), params.get('text'), params.get('url')]
      .filter(Boolean)
      .join('\n\n')

    const consume = () =>
      history.replaceState(null, '', location.pathname.replace(/share$/, ''))

    if (shared) {
      void newEingang(shared)
      consume()
      return
    }

    const target = params.get('new')
    if (target === 'eingang') {
      void newEingang('', params.get('camera') === '1')
      consume()
    } else if (target === 'quelle') {
      setLaneIndex(1)
      setSheet({ kind: 'pickQuelle', camera: params.get('camera') === '1' })
      consume()
    }
  }, [ready, config, newEingang])

  const openCard = useCallback(
    (index: number, card: Card) => {
      if (card.draftId) {
        const draft = drafts.find((d) => d.id === card.draftId)
        // A note that already reached the vault must not reopen in the editor:
        // saving it again would push a *second* file, since a capture always
        // creates rather than replaces. Once it has landed, editing is desk
        // work — the phone only reads it.
        if (draft?.syncState === 'synced' && draft.remotePath) {
          setSheet({ kind: 'reader', path: draft.remotePath, canQuote: false })
        } else {
          setSheet({ kind: 'editor', draftId: card.draftId, camera: false })
        }
      } else if (card.path) {
        setSheet({ kind: 'reader', path: card.path, canQuote: LANES[index].mode === 'append' })
      }
    },
    [drafts],
  )

  const onFab = useCallback(() => {
    const lane = LANES[laneIndex]
    if (lane.mode === 'create') void newEingang()
    else if (lane.mode === 'append') setSheet({ kind: 'pickQuelle', camera: false })
  }, [laneIndex, newEingang])

  /* -------------------------------------------------------------- render */

  const lane = LANES[laneIndex]
  const laneCards = cardsByLane[laneIndex] ?? []

  return (
    <div class="screen">
      <div class="header">
        <h1>{lane.label}</h1>
        <div class="spacer" />
        <div class="lane-dots" aria-hidden="true">
          {LANES.map((l, i) => (
            <i key={l.id} class={i === laneIndex ? 'on' : ''} />
          ))}
        </div>
        <button
          class="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
        />
        <button
          class={`sync ${!online ? 'offline' : unsynced > 0 ? 'pending' : ''}`}
          onClick={() => setSheet({ kind: 'settings' })}
          aria-label="Verbindung"
        >
          {unsynced > 0 && <span>{unsynced}</span>}
          <b />
        </button>
      </div>

      <Deck
        index={laneIndex}
        onIndexChange={setLaneIndex}
        cardsByLane={cardsByLane}
        cardIndex={cardIndex}
        onCardIndexChange={stepCard}
        onOpenCard={openCard}
        loading={draftsLoading}
      />

      <div class="deck-foot">
        <button class="count" onClick={() => setSheet({ kind: 'list', laneIndex })}>
          {!config ? (
            'nicht verbunden — bleibt auf dem Gerät'
          ) : laneCards.length > 0 ? (
            <>
              <b>
                {Math.min((cardIndex[laneIndex] ?? 0) + 1, laneCards.length)} / {laneCards.length}
              </b>
              {lane.folder} · alle zeigen
            </>
          ) : (
            lane.folder
          )}
        </button>
        {lane.mode !== 'read' && (
          <button class="fab" onClick={onFab} aria-label="Neue Notiz">
            +
          </button>
        )}
      </div>

      {sheet?.kind === 'settings' && (
        <Settings
          config={config}
          onSaved={(next) => {
            setConfig(next)
            setSheet(null)
            refresh()
          }}
          onSkip={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'editor' && (
        <Editor
          draftId={sheet.draftId}
          openCamera={sheet.camera}
          onClose={() => setSheet(null)}
          onSaved={saveAndSync}
        />
      )}

      {sheet?.kind === 'reader' && config && (
        <Reader
          config={config}
          path={sheet.path}
          onAppendQuote={
            sheet.canQuote
              ? () => {
                  const name = sheet.path.split('/').pop() ?? sheet.path
                  void newQuote(sheet.path, name.replace(/\.md$/i, ''))
                }
              : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'list' && (
        <ListSheet
          title={LANES[sheet.laneIndex].label}
          cards={cardsByLane[sheet.laneIndex] ?? []}
          onOpen={(card) => openCard(sheet.laneIndex, card)}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'pickQuelle' && (
        <QuellePicker
          cards={cardsByLane[1] ?? []}
          onPick={(card) =>
            void newQuote(card.path!, card.title, (sheet as { camera: boolean }).camera)
          }
          onFallback={() => void newEingang('', (sheet as { camera: boolean }).camera, true)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

/**
 * Choosing an existing source is the whole point of the Quellen lane: it is the
 * only way a phone capture can reach 30_Quellen without inventing a filename
 * that violates `Q <Autor> <Jahr> – <Titel>.md`.
 */
function QuellePicker({
  cards,
  onPick,
  onFallback,
  onClose,
}: {
  cards: Card[]
  onPick: (card: Card) => void
  onFallback: () => void
  onClose: () => void
}) {
  return (
    <div class="sheet">
      <div class="sheet-bar">
        <button class="link-button" onClick={onClose}>
          Zurück
        </button>
        <span class="title">Zu welcher Quelle?</span>
        <span class="link-button" style="opacity:0">
          Zurück
        </span>
      </div>

      <div class="sheet-body">
        <div class="rows">
          {cards
            .filter((card) => card.path)
            .map((card) => (
              <button class="row" key={card.key} onClick={() => onPick(card)}>
                <div class="primary">{card.title}</div>
                <div class="secondary">{card.subtitle}</div>
              </button>
            ))}
          <button class="row" onClick={onFallback}>
            <div class="primary">Quelle ist noch nicht im Vault</div>
            <div class="secondary">
              Geht nach 00_Eingang, mit Feldern für Autor, Jahr, Titel und Seite
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
