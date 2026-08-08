import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'
import './styles.css'

registerSW({ immediate: true })

// Ask the browser to keep IndexedDB through storage pressure. Without this a
// queued note could in principle be evicted before it ever reaches the vault.
void navigator.storage?.persist?.().catch(() => undefined)

render(<App />, document.getElementById('app')!)
