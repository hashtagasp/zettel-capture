import { useState } from 'preact/hooks'
import { verifyAccess, type GitHubConfig } from '../lib/github'
import { LANES } from '../lib/lanes'
import { allDrafts, clearConfig, saveConfig } from '../lib/store'
import { flush, refreshFolder } from '../lib/sync'
import { useAsync } from '../lib/hooks'

interface SettingsProps {
  config: GitHubConfig | null
  onSaved: (config: GitHubConfig) => void
  onSkip: () => void
}

const EMPTY: GitHubConfig = { owner: '', repo: '', branch: 'main', token: '' }

export function Settings({ config, onSaved, onSkip }: SettingsProps) {
  const [form, setForm] = useState<GitHubConfig>(config ?? EMPTY)
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const [failed, reloadFailed] = useAsync(
    async () => (await allDrafts()).filter((d) => d.syncState === 'error'),
    [],
    [],
  )

  const set = (key: keyof GitHubConfig) => (event: Event) =>
    setForm({ ...form, [key]: (event.target as HTMLInputElement).value.trim() })

  const complete = form.owner && form.repo && form.branch && form.token

  const connect = async () => {
    setBusy(true)
    setStatus(null)
    try {
      await verifyAccess(form)
      await saveConfig(form)
      // Warm every lane's listing so the deck has content on first open and the
      // [[ autocomplete has an index to search.
      await Promise.all(LANES.map((lane) => refreshFolder(lane.folder)))
      setStatus({ text: 'Verbunden. Ordner geladen.', bad: false })
      onSaved(form)
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), bad: true })
    } finally {
      setBusy(false)
    }
  }

  const retryFailed = async () => {
    setBusy(true)
    try {
      const result = await flush()
      setStatus({
        text: `${result.pushed} übertragen, ${result.failed} weiterhin offen.`,
        bad: result.failed > 0,
      })
      reloadFailed()
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    await clearConfig()
    setForm(EMPTY)
    setStatus({ text: 'Token entfernt. Notizen bleiben auf dem Gerät.', bad: false })
  }

  return (
    <div class="sheet">
      <div class="sheet-bar">
        {/* Closable even before a token exists: notes are durable locally and
         * flush the moment a connection is configured, so there is no reason to
         * hold the app hostage to setup. */}
        <button class="link-button" onClick={onSkip}>
          {config ? 'Zurück' : 'Später'}
        </button>
        <span class="title">Verbindung</span>
        <span class="link-button" style="opacity:0">
          Zurück
        </span>
      </div>

      <div class="sheet-body">
        {status && <div class={`banner ${status.bad ? 'bad' : ''}`}>{status.text}</div>}

        <p class="note">
          Fine-grained Token mit <code>Contents: read and write</code>, beschränkt auf das
          Vault-Repository. Der Token bleibt auf diesem Gerät und wird nie irgendwohin sonst
          geschickt.
        </p>

        <label class="field">
          <span>GitHub-Konto</span>
          <input
            value={form.owner}
            onInput={set('owner')}
            placeholder="christianmiller"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        <label class="field">
          <span>Repository</span>
          <input
            value={form.repo}
            onInput={set('repo')}
            placeholder="zettelkasten"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        <label class="field">
          <span>Branch</span>
          <input
            value={form.branch}
            onInput={set('branch')}
            placeholder="main"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        <label class="field">
          <span>Token</span>
          <input
            class="mono"
            type="password"
            value={form.token}
            onInput={set('token')}
            placeholder="github_pat_…"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        <button class="primary-button" disabled={!complete || busy} onClick={() => void connect()}>
          {busy ? 'Prüft …' : 'Verbinden und Ordner laden'}
        </button>

        {failed.length > 0 && (
          <>
            <div class="section-title">Nicht übertragen</div>
            <p class="note">
              {failed.length} Notiz(en) konnten nicht übertragen werden. Sie liegen weiterhin
              vollständig auf dem Gerät.
            </p>
            <div class="rows">
              {failed.map((draft) => (
                <div class="row" key={draft.id}>
                  <div class="primary">{draft.body.slice(0, 80) || '(nur Foto)'}</div>
                  <div class="secondary">{draft.lastError}</div>
                </div>
              ))}
            </div>
            <div style="height:14px" />
            <button class="primary-button" disabled={busy} onClick={() => void retryFailed()}>
              Erneut versuchen
            </button>
          </>
        )}

        {config && (
          <>
            <div class="section-title">Gerät</div>
            <button class="primary-button" onClick={() => void disconnect()}>
              Token entfernen
            </button>
          </>
        )}
      </div>
    </div>
  )
}
