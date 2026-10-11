import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

/** Lists every file under `dir` as a site-absolute URL path. */
function listPublicFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (!name.startsWith('.') && !name.startsWith('LICENSE')) out.push(`/${relative(dir, full).split(sep).join('/')}`)
    }
  }
  try {
    walk(dir)
  } catch {
    // no public dir
  }
  return out
}

/**
 * Emits `sw.js` at build time with a precache list of every emitted asset and public file.
 *
 * Why not vite-plugin-pwa: we only need app-shell precaching (all user data lives in
 * IndexedDB / native storage, never in the HTTP cache), and a small plugin avoids a heavy
 * dependency tree that lags behind Vite major releases.
 */
export function serviceWorkerPlugin(): Plugin {
  let publicDir = ''
  return {
    name: 'notivra-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => `/${f}`)
      const precache = Array.from(new Set(['/', '/index.html', ...listPublicFiles(publicDir), ...files]))
      // Version from the file list plus asset contents, so any change ships a new worker.
      const hash = createHash('sha256').update(precache.join('|'))
      for (const item of Object.values(bundle)) hash.update(item.type === 'chunk' ? item.code : String(item.source.length))
      const version = hash.digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderWorker(version, precache) })
    },
  }
}

function renderWorker(version: string, precache: string[]): string {
  return `/* Notivra service worker — generated at build time. Do not edit. */
const CACHE = 'notivra-shell-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('notivra-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first so deployments are picked up; fall back to the cached shell offline.
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html', { cacheName: CACHE, ignoreVary: true }).then((r) => r || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }).then((cached) => cached || fetch(request)),
  );
});
`
}
