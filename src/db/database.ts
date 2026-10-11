import Dexie, { type Table } from 'dexie'
import type {
  Achievement,
  Annotation,
  ConflictRecord,
  Folder,
  Notebook,
  Page,
  PdfDocument,
  Profile,
  Setting,
  StoredFile,
  StudyItem,
  StudySession,
  StudySet,
  Subject,
  SyncQueueEntry,
  UserAchievement,
  XpEvent,
} from './types'

/**
 * IndexedDB schema.
 *
 * MIGRATION RULES — read before editing:
 * - Never edit or delete an existing `version(n)` block once released. Add `version(n + 1)`.
 * - Only list indexed fields in `stores()`; other fields are stored but not indexed.
 * - Data transforms go in `.upgrade(tx => …)` on the new version and must be idempotent.
 * - Never reset the database to "fix" a schema problem; users would lose their notes.
 *
 * Note: IndexedDB does not index `null`, so "not deleted" filters are applied in JS.
 */
export class NotivraDatabase extends Dexie {
  profiles!: Table<Profile, string>
  subjects!: Table<Subject, string>
  folders!: Table<Folder, string>
  notebooks!: Table<Notebook, string>
  pages!: Table<Page, string>
  documents!: Table<PdfDocument, string>
  annotations!: Table<Annotation, string>
  studySets!: Table<StudySet, string>
  studyItems!: Table<StudyItem, string>
  studySessions!: Table<StudySession, string>
  xpEvents!: Table<XpEvent, string>
  achievements!: Table<Achievement, string>
  userAchievements!: Table<UserAchievement, string>
  syncQueue!: Table<SyncQueueEntry, string>
  files!: Table<StoredFile, string>
  settings!: Table<Setting, string>
  conflicts!: Table<ConflictRecord, string>

  constructor(name = 'notivra') {
    super(name)

    this.version(1).stores({
      profiles: 'id',
      subjects: 'id, sortOrder, syncStatus',
      folders: 'id, subjectId, parentId, syncStatus',
      notebooks: 'id, subjectId, folderId, updatedAt, lastOpenedAt, syncStatus',
      pages: 'id, notebookId, [notebookId+sortKey], updatedAt, syncStatus',
      documents: 'id, subjectId, folderId, updatedAt, lastOpenedAt, fileKey, syncStatus',
      annotations: 'id, documentId, [documentId+pageIndex], syncStatus',
      studySets: 'id, subjectId, updatedAt, syncStatus',
      studyItems: 'id, setId, [setId+sortOrder], srs.dueAt, syncStatus',
      studySessions: 'id, setId, startedAt, completedAt, syncStatus',
      xpEvents: 'id, &key, type, dayKey, subjectId, occurredAt, syncStatus',
      achievements: 'id, metric',
      userAchievements: 'id, &achievementId, syncStatus',
      syncQueue: 'key, entity, nextAttemptAt',
      files: 'key',
      settings: 'key',
      conflicts: 'key, entity',
    })
  }
}

export const db = new NotivraDatabase()

export const SCHEMA_VERSION = 1
