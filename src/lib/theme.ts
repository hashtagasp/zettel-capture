/**
 * Light is the default, always — not the system preference. The vault is read
 * in daylight far more often than in bed, and a capture surface that changes
 * appearance on its own is one more thing to think about.
 *
 * The choice is stamped on <html> as data-theme and mirrored into the
 * theme-color meta so Android tints the status bar to match.
 */

export type Theme = 'light' | 'dark'

const KEY = 'zettel-theme'

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0D0D0D' : '#F6F6F6')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode or storage disabled — the theme just won't persist.
  }
}
