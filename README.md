# Notivra

An offline-first notebook and study app for students: handwritten and typed notes, PDF annotation, flashcards and quizzes with spaced repetition, AI-generated reviewers, and XP/streaks/achievements. It runs on the web (installable PWA) and on Android (Capacitor) from one codebase.

**Core rule:** local storage is the source of truth. Notes and PDF annotation never need an account or a connection. Cloud sync and AI are optional extras.

## Quick start

```bash
npm install          # also copies pdf.js fonts/CMaps into public/pdfjs
npm run dev          # http://localhost:5173
npm test             # unit + component tests (Vitest)
npm run test:e2e     # end-to-end tests against the production build (Playwright)
npm run build        # type-check + production build into dist/
```

First run of e2e on a new machine: `npx playwright install chromium`.

## Architecture

```
src/
  app/                 shell, routing, bootstrap (DB open, maintenance), status pill
  components/          reusable accessible UI (Button, Dialog, Menu, Field, Toast…), Markdown
  db/                  Dexie schema + migrations, types, generic repository, session owner
  features/
    library/           subjects, folders, notebooks, trash, import/export of notebooks
    notebook/          ink editor: canvas renderer, geometry, undo/redo reducer, text layer, PDF export
    pdf/               pdf.js wrapper, import, virtualized workspace, SVG annotation layer, flattened export
    study/             study sets, items, SRS, quiz builder, flashcard/quiz sessions, AI generator UI
    progress/          XP ledger, rules, levels, streaks, achievements, progress page
    search/ settings/ home/
  hooks/               useAutosave (debounced, retrying, never drops edits), useOnline, …
  services/
    backup/            .notivra backup format (zip + manifest + JSON + PDFs), zod validation, merge restore
    storage/           FileStore abstraction (IndexedDB on web, Capacitor Filesystem on Android), quota
    sync/              sync engine, Supabase remote, mapping, status store, service (auth + scheduling)
    ai/                provider-independent AI client + shared zod contract
supabase/
  migrations/          Postgres schema, RLS policies, sync_push RPC, private storage bucket, AI quotas
  functions/ai-generate  Edge Function that calls Claude (holds the API key server-side)
build/                 service-worker generator, asset/icon generators
e2e/                   Playwright specs + fixture PDF
android/               Capacitor Android project
```

### Data integrity design

| Concern | How it is handled |
|---|---|
| Atomic writes | Every change goes through `db/repository.ts`, which saves the record, bumps its revision and enqueues it for sync **in one IndexedDB transaction**. |
| Lost edits | `useAutosave` serializes saves, keeps the latest value in memory on failure, retries with backoff, flushes on tab hide/close, and shows **Not saved · Retry** plus **Download unsaved copy**. The page also warns before closing with unsaved work. |
| Two tabs editing | Page saves carry the expected revision. A mismatch raises a conflict prompt instead of a silent overwrite. |
| Quota | Writes surface `StorageQuotaError`. PDF imports check `navigator.storage.estimate()` first, and the app requests persistent storage. Settings shows usage. |
| Deletes | Tombstones (`deletedAt`), a 30-day trash, and permanent purge that strips content but keeps the tombstone so the deletion syncs. |
| Schema changes | Versioned Dexie migrations (`db/database.ts`). Never a destructive reset. A newer on-disk version shows a clear message instead of wiping data. |
| Offline reload | A generated service worker precaches the app shell, pdf.js worker, fonts and CMaps. |
| Backups | Full or per-notebook `.notivra` files. Restore validates every record (zod) and every PDF (SHA-256), writes files first, applies all records in one transaction, and **never overwrites newer local edits** (higher revision wins). |
| Honest status | "Saved on this device" ≠ "Synced". The UI distinguishes saved locally, waiting to sync, synced and conflict, and nags about backups. |

### PDF annotations

Annotations are stored in **PDF user space** (unrotated points, origin bottom-left), separately from the original file, which is never modified. Rendering applies the page viewport matrix; input applies its inverse. As a result, annotations stay put across zoom, rotation and reopening. A dev-mode check asserts our matrix equals pdf.js's. Export flattens annotations into a **copy** with pdf-lib. Pages are virtualized: only pages near the viewport have canvases.

### Sync (optional)

- Each record has `rev` (local) and `serverRev` (last server revision seen). `sync_push` is a revision-checked upsert. A stale write returns `conflict` with the server row, and nothing is overwritten.
- Pulls are incremental by `server_updated_at`, with an overlap window. A pulled row **never** replaces a record with unsynced local changes. That becomes an explicit conflict the user resolves in Settings (keep this device's version or use the cloud version).
- Retries are idempotent. A push whose response was lost is recognized on retry (same content already on the server).
- XP events and achievements are unique per user (`owner_id, key`), so the same reward earned on two devices is never counted twice.
- PDFs upload to a private bucket at `<user id>/<file key>.pdf`, protected by storage RLS. Cloud-only PDFs download on first open.
- One device stays bound to one account: signing into a different account does not mix data.

### Gamification

XP is an append-only ledger (`xpEvents`) with an idempotency key per real action (`session:<id>`, `page:<id>`, `daily:<date>` …). Totals, levels, streaks and per-subject XP are always derived, never stored. Rules live in `features/progress/rules.ts`. Short sessions earn nothing, rewards are capped, and page XP has a daily cap. Achievement criteria are explicit `metric ≥ threshold` checks over stored data.

## Cloud setup (optional)

1. Create a Supabase project. Apply the migration: `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor).
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. In Auth settings, enable email sign-in. Add your site URL (and `https://localhost` for Android) to redirect URLs.
4. Deploy the AI function and set its secrets:
   ```bash
   supabase functions deploy ai-generate
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # never in client env vars
   supabase secrets set ALLOWED_ORIGIN=https://your-domain.example   # optional CORS lock-down
   ```
5. AI limits are data, not code. Edit `ai_plan_limits` (`free`: 10 requests/day, 30k chars; `plus`: 100/day, 60k chars) and assign plans in `ai_entitlements`.

The AI function uses `claude-opus-5-5` by default (override with the `AI_MODEL` secret). It requests structured JSON output, enables server-side refusal fallbacks, validates the output with zod before returning it, and never logs document text. The client validates the result again, and users review and edit everything before saving.

## Android

Prerequisites: **JDK 21** and **Android Studio** (Android SDK 36). These are not installed on the machine this was developed on, so the APK has not been compiled here. The Capacitor project itself is generated and synced.

```bash
npm run android:sync                 # build web app + copy into android/
npm run android:open                 # open in Android Studio, then Run ▶
node build/generate-android-assets.mjs   # regenerate launcher icons/splash after `cap add`
```

Release build:

```bash
cd android
./gradlew assembleRelease            # or bundleRelease for Play Store (.aab)
```

Configure signing in `android/app/build.gradle` (`signingConfigs`) with a keystore you keep outside the repo, for example via `~/.gradle/gradle.properties`. Bump `versionCode`/`versionName` for each release.

Android notes:
- App ID `app.notivra.notebook`, minSdk 24, targetSdk 36.
- Permissions: `INTERNET`, plus legacy storage permissions limited to Android ≤ 10 (`maxSdkVersion=29`) for saving exports to *Documents/Notivra*. Imports use the system document picker, which needs no permission.
- PDFs are stored in the app's private data directory (written to a temp file, then renamed, so an interrupted write never corrupts an original).
- Android Auto Backup is **disabled** (`allowBackup=false`, data-extraction rules). Restoring a stale WebView database underneath sync could resurrect old data. Use Notivra's explicit backups instead.
- The WebView flushes pending saves on `visibilitychange`/`pagehide`, which covers the app being backgrounded before the OS kills it.

## Testing

- **Unit/component (Vitest + fake-indexeddb):** repository atomicity and revisions, trash and purge, backup round-trip / damaged-file rejection / no-overwrite-of-newer-data, autosave failure and retry and serialization, ink geometry and undo/redo, PDF import / duplicate detection / rollback, annotation idempotency, annotated export (original untouched), coordinate transforms across zoom and rotation, SRS, answer checking, quiz builder, AI response validation, XP idempotency under concurrency, streaks and achievements, and the sync engine (conflicts both ways, lost responses, tombstones, stale rows, cross-device XP dedup, offline backoff, file upload/download).
- **End-to-end (Playwright, production build):** persistence across reload, full offline reload via the service worker, undo/redo, multi-page notebooks, simulated full disk (edits kept, retried and saved), PDF annotation position across zoom and reload with export validated by pdf-lib, rotated pages, and backup export → wipe → restore.

## Known limitations

- Handwriting is not searchable or readable by AI. Only typed text boxes are (no on-device OCR yet). Scanned PDFs without a text layer can't be used as AI sources.
- Exported PDFs use standard fonts: characters outside Latin-1/WinAnsi (e.g. CJK, emoji) in typed text and annotations become `?`. On-screen display is unaffected.
- Text-selection highlighting in PDFs isn't implemented. Use the area highlight or the highlighter pen.
- Pinch-to-zoom is not custom-implemented. Use the zoom controls or Ctrl + wheel.
- Conflicts are resolved per record (whole page / whole item). There is no automatic stroke-level merge.
- Cloud upload limit per PDF is 50 MB (larger PDFs stay on the device and are marked as such).
- The sync backend and AI function are tested against an in-memory implementation of the same contract. They have not been exercised against a live Supabase project in this environment.
