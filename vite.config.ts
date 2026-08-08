import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves a project site from /<repo>/. Override with BASE_PATH if
// the repo is named differently or the app is hosted at a domain root.
const base = process.env.BASE_PATH ?? '/zettel-capture/'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : base,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    target: 'es2022',
    // One bundle. The whole app is small enough that a second round trip on a
    // phone costs more than it saves.
    rollupOptions: { output: { manualChunks: undefined } },
  },
  plugins: [
    VitePWA({
      // injectManifest, not generateSW: the worker carries the background-sync
      // handler that drains the push queue while the app is closed.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
      manifest: {
        name: 'Zettel Capture',
        short_name: 'Zettel',
        description: 'Eingangs- und Quellennotizen unterwegs erfassen',
        lang: 'de',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F5F4F1',
        theme_color: '#F5F4F1',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Long-press the launcher icon to capture without opening the deck.
        shortcuts: [
          {
            name: 'Neue Eingangsnotiz',
            short_name: 'Eingang',
            url: '?new=eingang',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Foto zu Quelle',
            short_name: 'Quelle',
            url: '?new=quelle&camera=1',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
        ],
        // Share a URL or selected text from any Android app straight into 00_Eingang.
        share_target: {
          action: 'share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
    }),
  ],
}))
