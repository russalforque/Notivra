/**
 * Local data model. Every user-owned, synchronizable record extends {@link SyncedRecord}.
 *
 * Conventions
 * - IDs are UUIDv4 strings generated on the device (stable across sync).
 * - Timestamps are epoch milliseconds.
 * - Deletion is a tombstone (`deletedAt`), never a physical delete, so deletes can sync.
 * - `rev` increments on every local write; `serverRev` is the last revision the server
 *   acknowledged. A record is safe to overwrite from the server only when it has no
 *   unsynced local changes (see sync/engine.ts).
 */

export type SyncStatus = 'pending' | 'synced' | 'conflict'

export interface SyncedRecord {
  id: string
  ownerId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
  serverRev: number | null
  syncStatus: SyncStatus
}

/** Fields managed by the repository layer rather than callers. */
export type SyncMetaKey = keyof SyncedRecord

// ───────────────────────── Organization ─────────────────────────

export interface Subject extends SyncedRecord {
  name: string
  color: string
  sortOrder: number
}

export interface Folder extends SyncedRecord {
  name: string
  subjectId: string | null
  /** Reserved for nested folders. The UI currently shows one level. */
  parentId: string | null
}

// ───────────────────────── Notebooks ─────────────────────────

export type PageTemplate = 'blank' | 'lined' | 'grid' | 'dotted'

export interface Notebook extends SyncedRecord {
  title: string
  subjectId: string | null
  folderId: string | null
  color: string
  defaultTemplate: PageTemplate
  pinned: boolean
  lastOpenedAt: number | null
  /** Set when the user permanently deletes from trash; content has been stripped. */
  purgedAt: number | null
}

export type InkTool = 'pen' | 'highlighter'

export interface Stroke {
  id: string
  tool: InkTool
  color: string
  /** Base width in page units. */
  size: number
  /** Flat array of [x, y, pressure] triples in page units. */
  points: number[]
}

export interface TextBlock {
  id: string
  x: number
  y: number
  width: number
  text: string
  fontSize: number
  color: string
}

export interface PageContent {
  strokes: Stroke[]
  textBlocks: TextBlock[]
}

export interface Page extends SyncedRecord, PageContent {
  notebookId: string
  /** Fractional ordering key so pages can be inserted without renumbering. */
  sortKey: number
  template: PageTemplate
  width: number
  height: number
  /** Denormalized text of all text blocks, used for search. */
  plainText: string
}

// ───────────────────────── PDF documents ─────────────────────────

export type FileSyncStatus = 'local' | 'uploaded' | 'remote-only' | 'missing'

export interface PdfDocument extends SyncedRecord {
  title: string
  subjectId: string | null
  folderId: string | null
  fileName: string
  byteSize: number
  pageCount: number
  /** Key of the original binary in the platform file store. The original is never modified. */
  fileKey: string
  /** SHA-256 of the original file, used to detect corruption and dedupe uploads. */
  sha256: string
  thumbnail: string | null
  /** Path in the private cloud bucket once uploaded. */
  remotePath: string | null
  fileSyncStatus: FileSyncStatus
  lastPage: number
  lastScale: number
  rotation: 0 | 90 | 180 | 270
  lastOpenedAt: number | null
  purgedAt: number | null
}

/** Points are in PDF user space (origin bottom-left, unrotated). */
export type AnnotationShape =
  | { kind: 'ink'; points: number[]; width: number }
  | { kind: 'highlight'; rect: [number, number, number, number] }
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number }
  | { kind: 'rect' | 'ellipse'; rect: [number, number, number, number]; width: number }
  | { kind: 'line' | 'arrow'; from: [number, number]; to: [number, number]; width: number }

export type AnnotationKind = AnnotationShape['kind']

export interface Annotation extends SyncedRecord {
  documentId: string
  /** Zero-based page index. */
  pageIndex: number
  color: string
  opacity: number
  shape: AnnotationShape
}

// ───────────────────────── Study ─────────────────────────

export interface StudySource {
  type: 'notebook' | 'document' | 'text'
  refId: string | null
  label: string
}

export interface StudySet extends SyncedRecord {
  title: string
  subjectId: string | null
  description: string
  /** Markdown summary / exam reviewer (AI generated or written by the user). */
  summary: string | null
  origin: 'manual' | 'ai'
  source: StudySource | null
}

export type StudyItemKind = 'flashcard' | 'multiple_choice' | 'true_false' | 'short_answer'

export interface SrsState {
  dueAt: number
  intervalDays: number
  ease: number
  reps: number
  lapses: number
  lastReviewedAt: number | null
}

export interface StudyItem extends SyncedRecord {
  setId: string
  kind: StudyItemKind
  prompt: string
  /** Flashcard back / correct answer. For true_false: "true" | "false". */
  answer: string
  /** Options for multiple choice (includes the correct answer). */
  choices: string[]
  /** Extra accepted answers for short answer questions. */
  acceptedAnswers: string[]
  explanation: string
  sourceRef: string | null
  sortOrder: number
  srs: SrsState
}

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

export interface SessionAnswer {
  itemId: string
  correct: boolean
  grade: ReviewGrade | null
  response: string | null
  at: number
}

export interface StudySession extends SyncedRecord {
  setId: string
  mode: 'flashcards' | 'quiz'
  startedAt: number
  completedAt: number | null
  answers: SessionAnswer[]
  correctCount: number
  totalCount: number
}

// ───────────────────────── Gamification ─────────────────────────

export type XpEventType =
  | 'flashcard_session'
  | 'quiz_session'
  | 'daily_goal'
  | 'page_written'
  | 'document_annotated'
  | 'study_set_created'
  | 'achievement'

/** Immutable ledger entry. Totals are always derived from these, never stored. */
export interface XpEvent extends SyncedRecord {
  /** Idempotency key: the same real-world action always produces the same key. */
  key: string
  type: XpEventType
  amount: number
  subjectId: string | null
  dayKey: string
  occurredAt: number
}

export type AchievementMetric =
  | 'totalXp'
  | 'streak'
  | 'sessionsCompleted'
  | 'cardsReviewed'
  | 'perfectQuizzes'
  | 'notebooksCreated'
  | 'pagesWritten'
  | 'documentsAnnotated'
  | 'studySetsCreated'

/** Catalog entry (static, defined in code and mirrored into the table for queries). */
export interface Achievement {
  id: string
  title: string
  description: string
  icon: string
  metric: AchievementMetric
  threshold: number
}

export interface UserAchievement extends SyncedRecord {
  achievementId: string
  unlockedAt: number
}

// ───────────────────────── Profile & infrastructure ─────────────────────────

export interface Profile {
  id: 'local'
  displayName: string
  dailyGoalMinutes: number
  updatedAt: number
}

export type SyncEntity =
  | 'subjects'
  | 'folders'
  | 'notebooks'
  | 'pages'
  | 'documents'
  | 'annotations'
  | 'studySets'
  | 'studyItems'
  | 'studySessions'
  | 'xpEvents'
  | 'userAchievements'

export interface EntityMap {
  subjects: Subject
  folders: Folder
  notebooks: Notebook
  pages: Page
  documents: PdfDocument
  annotations: Annotation
  studySets: StudySet
  studyItems: StudyItem
  studySessions: StudySession
  xpEvents: XpEvent
  userAchievements: UserAchievement
}

/** One entry per record with unsynced changes. Coalesced by key, so retries are idempotent. */
export interface SyncQueueEntry {
  key: string
  entity: SyncEntity
  entityId: string
  enqueuedAt: number
  attempts: number
  nextAttemptAt: number
  lastError: string | null
}

export interface StoredFile {
  key: string
  bytes: ArrayBuffer
  size: number
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}

/** Server copy of a record that changed both locally and remotely. Awaits user resolution. */
export interface ConflictRecord {
  key: string
  entity: SyncEntity
  entityId: string
  remote: Record<string, unknown>
  remoteRev: number
  detectedAt: number
}
