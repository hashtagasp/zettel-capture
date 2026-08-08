/// <reference lib="webworker" />

/**
 * Service worker.
 *
 * Two jobs: serve the app shell offline, and drain the push queue in the
 * background so a note captured underground reaches the vault when signal
 * returns — without the app ever being reopened.
 */

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { flush } from './lib/sync'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

export const SYNC_TAG = 'zettel-push'

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Every in-scope navigation serves the shell, including the Web Share Target
// (`share?title=…&text=…`) and the launcher shortcuts (`?new=eingang`).
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  denylist: [/^\/api\//],
}))

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string }
  if (syncEvent.tag !== SYNC_TAG) return
  // Rejecting tells the browser to retry the sync later with its own backoff.
  syncEvent.waitUntil(
    flush().then((result) => {
      if (result.remaining > 0) throw new Error('Warteschlange nicht leer')
    }),
  )
})

// The page asks for an immediate drain when it regains connectivity.
self.addEventListener('message', (event) => {
  if ((event as ExtendableMessageEvent).data?.type === 'flush') {
    ;(event as ExtendableMessageEvent).waitUntil(flush().then(() => undefined))
  }
})
