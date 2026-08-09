import type { ComponentChildren } from 'preact'
import { NetworkError, readFile } from '../lib/github'
import type { GitHubConfig } from '../lib/github'
import { describeFilename } from '../lib/cards'
import { useAsync } from '../lib/hooks'

interface ReaderProps {
  config: GitHubConfig
  path: string
  /** Only offered on the Quellen lane. */
  onAppendQuote?: () => void
  onClose: () => void
}

export function Reader({ config, path, onAppendQuote, onClose }: ReaderProps) {
  const filename = path.split('/').pop() ?? path
  const { title } = describeFilename(filename)
  /**
   * "Couldn't load it" is three different problems with three different
   * answers, and telling the user it's a connection issue when the file was
   * deleted sends them looking in the wrong place.
   */
  const [result, , loading] = useAsync<
    | { kind: 'ok'; text: string }
    | { kind: 'missing' }
    | { kind: 'offline' }
    | { kind: 'error'; message: string }
    | null
  >(
    async () => {
      try {
        const file = await readFile(config, path)
        return file ? { kind: 'ok', text: file.text } : { kind: 'missing' }
      } catch (err) {
        if (err instanceof NetworkError) return { kind: 'offline' }
        return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
      }
    },
    [path],
    null,
  )

  return (
    <div class="sheet">
      <div class="sheet-bar">
        <button class="link-button" onClick={onClose}>
          Zurück
        </button>
        <span class="title">{title}</span>
        {onAppendQuote ? (
          <button class="link-button strong" onClick={onAppendQuote}>
            Zitat
          </button>
        ) : (
          <span class="link-button" style="opacity:0">
            Zurück
          </span>
        )}
      </div>

      <div class="sheet-body">
        {loading && <p class="note">Lädt …</p>}
        {result?.kind === 'missing' && (
          <p class="note">
            Diese Notiz liegt nicht mehr im Repository. Sie wurde gelöscht oder umbenannt — die
            Karte stammt noch aus einer älteren Ordnerliste und verschwindet beim nächsten
            Aktualisieren.
          </p>
        )}
        {result?.kind === 'offline' && (
          <p class="note">
            Keine Verbindung. Ohne Netz lassen sich nur Notizen öffnen, die auf diesem Gerät liegen.
          </p>
        )}
        {result?.kind === 'error' && <p class="note">{result.message}</p>}
        {result?.kind === 'ok' && <Markdown text={result.text} />}
      </div>
    </div>
  )
}

/**
 * Deliberately not a markdown renderer. It separates the frontmatter, marks
 * headings, and tints wikilinks — enough to read a note, and nothing that would
 * tempt this app into becoming an Obsidian client.
 */
function Markdown({ text }: { text: string }) {
  let frontmatter = ''
  let body = text

  if (body.startsWith('---')) {
    const close = body.indexOf('\n---', 3)
    if (close !== -1) {
      frontmatter = body.slice(4, close).trim()
      body = body.slice(close + 4).replace(/^\n+/, '')
    }
  }

  return (
    <div class="reader">
      {frontmatter && <div class="fm">{frontmatter}</div>}
      {body.split('\n').map((line, index) => {
        const heading = line.match(/^(#{1,6})\s+(.*)$/)
        if (heading) return <h2 key={index}>{heading[2]}</h2>
        return (
          <div key={index}>
            <Inline line={line} />
          </div>
        )
      })}
    </div>
  )
}

/** Tints `[[wikilinks]]` and `![[embeds]]` so prose stays readable. */
function Inline({ line }: { line: string }) {
  const parts: ComponentChildren[] = []
  const pattern = /!?\[\[([^\]]+)\]\]/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index))
    parts.push(
      <span class="wl" key={`${match.index}`}>
        {match[0].startsWith('!') ? `🖼 ${match[1]}` : match[1]}
      </span>,
    )
    cursor = match.index + match[0].length
  }
  if (cursor < line.length) parts.push(line.slice(cursor))

  return <>{parts.length ? parts : line}</>
}
