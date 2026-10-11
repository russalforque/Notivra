import type { EntityMap, SyncedRecord, SyncEntity } from '../../db/types'

/**
 * Local ↔ cloud field mapping. Only fields listed here are synchronized; everything else is
 * device-local state (view position, file availability, open history).
 */
export const SYNC_ORDER: SyncEntity[] = [
  'subjects',
  'folders',
  'notebooks',
  'pages',
  'documents',
  'annotations',
  'studySets',
  'studyItems',
  'studySessions',
  'xpEvents',
  'userAchievements',
]

export const TABLE_NAMES: Record<SyncEntity, string> = {
  subjects: 'subjects',
  folders: 'folders',
  notebooks: 'notebooks',
  pages: 'pages',
  documents: 'documents',
  annotations: 'annotations',
  studySets: 'study_sets',
  studyItems: 'study_items',
  studySessions: 'study_sessions',
  xpEvents: 'xp_events',
  userAchievements: 'user_achievements',
}

const COMMON = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const

export const SYNCED_FIELDS: Record<SyncEntity, readonly string[]> = {
  subjects: ['name', 'color', 'sortOrder'],
  folders: ['name', 'subjectId', 'parentId'],
  notebooks: ['title', 'subjectId', 'folderId', 'color', 'defaultTemplate', 'pinned', 'purgedAt'],
  pages: ['notebookId', 'sortKey', 'template', 'width', 'height', 'strokes', 'textBlocks', 'plainText'],
  documents: ['title', 'subjectId', 'folderId', 'fileName', 'byteSize', 'pageCount', 'fileKey', 'sha256', 'thumbnail', 'remotePath', 'purgedAt'],
  annotations: ['documentId', 'pageIndex', 'color', 'opacity', 'shape'],
  studySets: ['title', 'subjectId', 'description', 'summary', 'origin', 'source'],
  studyItems: ['setId', 'kind', 'prompt', 'answer', 'choices', 'acceptedAnswers', 'explanation', 'sourceRef', 'sortOrder', 'srs'],
  studySessions: ['setId', 'mode', 'startedAt', 'completedAt', 'answers', 'correctCount', 'totalCount'],
  xpEvents: ['key', 'type', 'amount', 'subjectId', 'dayKey', 'occurredAt'],
  userAchievements: ['achievementId', 'unlockedAt'],
}

/** Defaults for device-local fields when a record arrives from the cloud for the first time. */
const LOCAL_DEFAULTS: Partial<Record<SyncEntity, Record<string, unknown>>> = {
  notebooks: { lastOpenedAt: null },
  documents: { fileSyncStatus: 'remote-only', lastPage: 0, lastScale: 0, rotation: 0, lastOpenedAt: null },
}

export type RemoteRow = Record<string, unknown> & { id: string; rev: number; owner_id: string; server_updated_at: string }

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

export function toRemote<E extends SyncEntity>(entity: E, record: EntityMap[E]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const src = record as unknown as Record<string, unknown>
  for (const f of [...COMMON, ...SYNCED_FIELDS[entity]]) out[toSnake(f)] = src[f] ?? null
  return out
}

/** Builds a local record from a cloud row, preserving device-local fields from `local`. */
export function fromRemote<E extends SyncEntity>(entity: E, row: RemoteRow, local?: EntityMap[E]): EntityMap[E] {
  const base: Record<string, unknown> = { ...(LOCAL_DEFAULTS[entity] ?? {}), ...((local as unknown as Record<string, unknown>) ?? {}) }
  for (const f of [...COMMON, ...SYNCED_FIELDS[entity]]) base[f] = row[toSnake(f)] ?? null
  const meta: Partial<SyncedRecord> = { ownerId: row.owner_id, serverRev: row.rev, syncStatus: 'synced' }
  return { ...base, ...meta } as unknown as EntityMap[E]
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** True when a cloud row holds exactly the synced content of a local record. */
export function sameContent<E extends SyncEntity>(entity: E, local: EntityMap[E], row: Record<string, unknown>): boolean {
  const mine = toRemote(entity, local)
  return Object.keys(mine).every((k) => stable(mine[k]) === stable(row[k]))
}
