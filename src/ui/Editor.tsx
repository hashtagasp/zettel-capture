import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { attachmentFilename, stripExtension } from '../lib/notes'
import { downscaleImage } from '../lib/image'
import { LINK_TARGET_FOLDERS } from '../lib/lanes'
import {
  cachedFolders,
  deleteDraft,
  getAttachments,
  getDraft,
  newId,
  putAttachment,
  putDraft,
  type Attachment,
  type Draft,
} from '../lib/store'
import { useAsync } from '../lib/hooks'

interface EditorProps {
  draftId: string
  openCamera: boolean
  onClose: () => void
  onSaved: () => void
}

const SAVE_DEBOUNCE = 300

export function Editor({ draftId, openCamera, onClose, onSaved }: EditorProps) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number>()

  const [linkIndex] = useAsync<string[]>(
    async () => {
      const folders = await cachedFolders(LINK_TARGET_FOLDERS)
      return folders
        .flatMap((f) => f.entries)
        .filter((e) => e.name.endsWith('.md'))
        .map((e) => stripExtension(e.name))
    },
    [],
    [],
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      const loaded = await getDraft(draftId)
      if (!loaded || !alive) return
      setDraft(loaded)
      setTitle(loaded.title ?? '')
      setBody(loaded.body)
      setAttachments(await getAttachments(loaded.attachmentIds))
      // Focus after paint so Android raises the keyboard on the first frame.
      // A new note starts in the title; an existing one in the body, so
      // reopening to add a thought doesn't put the cursor in the wrong place.
      requestAnimationFrame(() =>
        (loaded.body || loaded.kind === 'quelle-append'
          ? textarea.current
          : titleInput.current
        )?.focus(),
      )
      if (openCamera) requestAnimationFrame(() => fileInput.current?.click())
    })()
    return () => {
      alive = false
    }
  }, [draftId, openCamera])

  /* The draft is durable before anything else happens — this is the whole
   * local-first promise, so it runs on a short debounce, not on save. */
  const persist = (next: Partial<Draft>) => {
    setDraft((current) => {
      if (!current) return current
      const merged = { ...current, ...next, updatedAt: Date.now() }
      clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void putDraft(merged), SAVE_DEBOUNCE)
      return merged
    })
  }

  const onInput = (event: Event) => {
    const value = (event.target as HTMLTextAreaElement).value
    setBody(value)
    persist({ body: value })
  }

  const onTitleInput = (event: Event) => {
    const value = (event.target as HTMLInputElement).value
    setTitle(value)
    persist({ title: value })
  }

  const addPhoto = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = '' // let the same file be picked twice
    if (files.length === 0 || !draft) return

    setBusy(true)
    try {
      const added: Attachment[] = []
      for (const file of files) {
        const { blob, contentType } = await downscaleImage(file)
        const attachment: Attachment = {
          id: newId(),
          blob,
          filename: attachmentFilename(
            new Date(),
            title || draft.targetLabel || body || 'Foto',
          ),
          contentType,
          createdAt: Date.now(),
        }
        await putAttachment(attachment)
        added.push(attachment)
      }
      const next = [...attachments, ...added]
      setAttachments(next)
      persist({ attachmentIds: next.map((a) => a.id) })
    } finally {
      setBusy(false)
    }
  }

  const removePhoto = (id: string) => {
    const next = attachments.filter((a) => a.id !== id)
    setAttachments(next)
    persist({ attachmentIds: next.map((a) => a.id) })
  }

  const save = async () => {
    clearTimeout(saveTimer.current)
    if (!draft) return onClose()

    const trimmed = body.trim()
    const trimmedTitle = title.trim()
    if (!trimmed && !trimmedTitle && attachments.length === 0) {
      // Nothing was written. Don't leave an empty note behind.
      await deleteDraft(draft.id)
      onSaved()
      return onClose()
    }

    await putDraft({
      ...draft,
      title: trimmedTitle,
      body: trimmed,
      attachmentIds: attachments.map((a) => a.id),
      syncState: 'queued',
      attempts: 0,
      nextAttemptAt: undefined,
      lastError: undefined,
      updatedAt: Date.now(),
    })
    onSaved()
    onClose()
  }

  const discard = async () => {
    clearTimeout(saveTimer.current)
    if (draft) await deleteDraft(draft.id)
    onSaved()
    onClose()
  }

  const suggestion = useLinkSuggestion(body, textarea, linkIndex)

  const applySuggestion = (name: string) => {
    const element = textarea.current
    if (!element || !suggestion) return
    const next = `${body.slice(0, suggestion.start)}[[${name}]]${body.slice(suggestion.end)}`
    const caret = suggestion.start + name.length + 4
    setBody(next)
    persist({ body: next })
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(caret, caret)
    })
  }

  const isQuote = draft?.kind === 'quelle-append'

  return (
    <div class="sheet">
      <div class="sheet-bar">
        <button class="link-button" onClick={discard}>
          Verwerfen
        </button>
        <span class="title">{isQuote ? draft?.targetLabel : 'Eingang'}</span>
        <button class="link-button strong" onClick={() => void save()} disabled={busy}>
          Sichern
        </button>
      </div>

      <div class="editor">
        {/* Quotes have no title of their own — they belong to their source. */}
        {!isQuote && (
          <input
            ref={titleInput}
            class="title-input"
            value={title}
            onInput={onTitleInput}
            placeholder="Titel"
            enterkeyhint="next"
            autocapitalize="sentences"
            autocomplete="off"
            spellcheck
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                textarea.current?.focus()
              }
            }}
          />
        )}

        <textarea
          ref={textarea}
          value={body}
          onInput={onInput}
          enterkeyhint="enter"
          placeholder={
            isQuote
              ? 'Zitat im Wortlaut. Seitenzahl am Schreibtisch nachtragen.'
              : 'Was ist der Gedanke?'
          }
          rows={6}
          autocapitalize="sentences"
          spellcheck
        />

        {attachments.length > 0 && (
          <div class="thumbs">
            {attachments.map((attachment) => (
              <Thumb
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removePhoto(attachment.id)}
              />
            ))}
          </div>
        )}

        <div class="toolbar-wrap">
          {suggestion && suggestion.matches.length > 0 && (
            <div class="suggest">
              {suggestion.matches.map((name) => (
                <button key={name} onClick={() => applySuggestion(name)}>
                  {name}
                </button>
              ))}
            </div>
          )}

          <div class="toolbar">
            <button class="tool" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? 'Verkleinert …' : 'Foto'}
            </button>
            {!isQuote && (
              <button class="tool" onClick={() => insertAtCaret(textarea, '[[', setBody, persist)}>
                Verweis
              </button>
            )}
            <span class="hint">
              {isQuote ? 'wird an die Quelle angehängt' : 'landet in 00_Eingang'}
            </span>
          </div>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(event) => void addPhoto(event)}
      />
    </div>
  )
}

function Thumb({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(attachment.blob), [attachment.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div class="thumb">
      <img src={url} alt="" />
      <button onClick={onRemove} aria-label="Foto entfernen">
        ×
      </button>
    </div>
  )
}

interface Suggestion {
  start: number
  end: number
  matches: string[]
}

/**
 * Wikilink autocomplete over the cached filenames of 10_Zettel and 20_Struktur.
 *
 * Only offered in Eingang notes. That is deliberate: the "typisierte Links
 * gehören ausschließlich in die Properties" rule governs Zettel bodies, and the
 * phone never writes a Zettel.
 */
function useLinkSuggestion(
  body: string,
  textarea: { current: HTMLTextAreaElement | null },
  index: string[],
): Suggestion | null {
  const [caret, setCaret] = useState(0)

  useEffect(() => {
    const element = textarea.current
    if (!element) return
    const track = () => setCaret(element.selectionStart ?? 0)
    element.addEventListener('keyup', track)
    element.addEventListener('click', track)
    element.addEventListener('input', track)
    return () => {
      element.removeEventListener('keyup', track)
      element.removeEventListener('click', track)
      element.removeEventListener('input', track)
    }
  }, [textarea.current])

  return useMemo(() => {
    const before = body.slice(0, caret)
    const open = before.lastIndexOf('[[')
    if (open === -1) return null
    // Already closed, or the caret ran past the end of the link.
    const between = before.slice(open + 2)
    if (between.includes(']]') || between.includes('\n')) return null

    const query = between.trim().toLocaleLowerCase('de')
    const matches = index
      .filter((name) => !query || name.toLocaleLowerCase('de').includes(query))
      .slice(0, 8)

    return { start: open, end: caret, matches }
  }, [body, caret, index])
}

function insertAtCaret(
  textarea: { current: HTMLTextAreaElement | null },
  text: string,
  setBody: (value: string) => void,
  persist: (next: Partial<Draft>) => void,
) {
  const element = textarea.current
  if (!element) return
  const start = element.selectionStart ?? element.value.length
  const next = `${element.value.slice(0, start)}${text}${element.value.slice(start)}`
  setBody(next)
  persist({ body: next })
  requestAnimationFrame(() => {
    element.focus()
    element.setSelectionRange(start + text.length, start + text.length)
  })
}
