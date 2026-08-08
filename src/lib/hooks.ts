import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { flush } from './sync'

/** Re-runs `load` whenever `deps` change or `reload()` is called. */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  initial: T,
): [T, () => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    load()
      .then((result) => {
        if (alive.current) setValue(result)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return [value, useCallback(() => setNonce((n) => n + 1), []), loading]
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    addEventListener('online', on)
    addEventListener('offline', off)
    return () => {
      removeEventListener('online', on)
      removeEventListener('offline', off)
    }
  }, [])
  return online
}

const SYNC_TAG = 'zettel-push'

/** Hands the queue to the service worker so it drains with the app closed. */
async function requestBackgroundSync(): Promise<void> {
  try {
    const registration = (await navigator.serviceWorker?.ready) as
      | (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })
      | undefined
    await registration?.sync?.register(SYNC_TAG)
  } catch {
    // Background Sync is unavailable (or denied). The in-page flush still runs
    // on launch and on reconnect, which covers every realistic case.
  }
}

/**
 * Drains the push queue on launch, on reconnect, and when the app is
 * backgrounded — the last one matters most, because that is the moment a
 * capture is finished and the user walks away.
 */
export function useSyncPump(onChange: () => void): void {
  const changed = useRef(onChange)
  changed.current = onChange

  useEffect(() => {
    let cancelled = false

    const pump = () => {
      void flush()
        .then((result) => {
          if (cancelled) return
          if (result.pushed || result.failed) changed.current()
          if (result.remaining > 0) void requestBackgroundSync()
        })
        .catch(() => undefined)
    }

    pump()

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void requestBackgroundSync()
      else pump()
    }

    addEventListener('online', pump)
    document.addEventListener('visibilitychange', onVisibility)
    // A slow backoff tick, so a note queued behind a transient error clears
    // itself while the app sits open, without polling the network.
    const timer = setInterval(pump, 60_000)

    return () => {
      cancelled = true
      removeEventListener('online', pump)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [])
}
