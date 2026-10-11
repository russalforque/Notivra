import { z } from 'zod'

/**
 * Validation for backup files. Backups are untrusted input (they may be hand-edited, truncated
 * or from a newer app version), so every record is checked before touching the database.
 * Objects are "loose" so that additive fields from newer minor versions are preserved.
 */

export const BACKUP_FORMAT = 'notivra-backup'
export const BACKUP_VERSION = 1

const num = z.number().finite()
const id = z.string().min(1).max(64)
const nullableId = id.nullable()

const meta = {
  id,
  ownerId: z.string().nullable(),
  createdAt: num,
  updatedAt: num,
  deletedAt: num.nullable(),
  rev: z.number().int().min(1),
  serverRev: z.number().int().nullable(),
  syncStatus: z.enum(['pending', 'synced', 'conflict']),
}

const stroke = z.object({
  id,
  tool: z.enum(['pen', 'highlighter']),
  color: z.string().max(32),
  size: num.positive().max(200),
  points: z.array(num).refine((p) => p.length % 3 === 0, 'Stroke points must be [x, y, pressure] triples'),
})

const textBlock = z.object({
  id,
  x: num,
  y: num,
  width: num.positive(),
  text: z.string().max(100_000),
  fontSize: num.positive().max(200),
  color: z.string().max(32),
})

const template = z.enum(['blank', 'lined', 'grid', 'dotted'])
const rect = z.tuple([num, num, num, num])
const point = z.tuple([num, num])

const annotationShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ink'), points: z.array(num), width: num.positive() }),
  z.object({ kind: z.literal('highlight'), rect }),
  z.object({ kind: z.literal('text'), x: num, y: num, text: z.string().max(20_000), fontSize: num.positive() }),
  z.object({ kind: z.enum(['rect', 'ellipse']), rect, width: num.positive() }),
  z.object({ kind: z.enum(['line', 'arrow']), from: point, to: point, width: num.positive() }),
])

const srs = z.object({
  dueAt: num,
  intervalDays: num.min(0),
  ease: num.min(1),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  lastReviewedAt: num.nullable(),
})

export const backupSchemas = {
  subjects: z.looseObject({ ...meta, name: z.string(), color: z.string(), sortOrder: num }),
  folders: z.looseObject({ ...meta, name: z.string(), subjectId: nullableId, parentId: nullableId }),
  notebooks: z.looseObject({
    ...meta,
    title: z.string(),
    subjectId: nullableId,
    folderId: nullableId,
    color: z.string(),
    defaultTemplate: template,
    pinned: z.boolean(),
    lastOpenedAt: num.nullable(),
    purgedAt: num.nullable(),
  }),
  pages: z.looseObject({
    ...meta,
    notebookId: id,
    sortKey: num,
    template,
    width: num.positive(),
    height: num.positive(),
    strokes: z.array(stroke),
    textBlocks: z.array(textBlock),
    plainText: z.string(),
  }),
  documents: z.looseObject({
    ...meta,
    title: z.string(),
    subjectId: nullableId,
    folderId: nullableId,
    fileName: z.string(),
    byteSize: z.number().int().min(0),
    pageCount: z.number().int().min(0),
    fileKey: id,
    sha256: z.string(),
    thumbnail: z.string().nullable(),
    remotePath: z.string().nullable(),
    fileSyncStatus: z.enum(['local', 'uploaded', 'remote-only', 'missing']),
    lastPage: z.number().int().min(0),
    lastScale: num.positive(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    lastOpenedAt: num.nullable(),
    purgedAt: num.nullable(),
  }),
  annotations: z.looseObject({
    ...meta,
    documentId: id,
    pageIndex: z.number().int().min(0),
    color: z.string(),
    opacity: num.min(0).max(1),
    shape: annotationShape,
  }),
  studySets: z.looseObject({
    ...meta,
    title: z.string(),
    subjectId: nullableId,
    description: z.string(),
    summary: z.string().nullable(),
    origin: z.enum(['manual', 'ai']),
    source: z
      .object({ type: z.enum(['notebook', 'document', 'text']), refId: nullableId, label: z.string() })
      .nullable(),
  }),
  studyItems: z.looseObject({
    ...meta,
    setId: id,
    kind: z.enum(['flashcard', 'multiple_choice', 'true_false', 'short_answer']),
    prompt: z.string(),
    answer: z.string(),
    choices: z.array(z.string()),
    acceptedAnswers: z.array(z.string()),
    explanation: z.string(),
    sourceRef: z.string().nullable(),
    sortOrder: num,
    srs,
  }),
  studySessions: z.looseObject({
    ...meta,
    setId: id,
    mode: z.enum(['flashcards', 'quiz']),
    startedAt: num,
    completedAt: num.nullable(),
    answers: z.array(
      z.object({
        itemId: id,
        correct: z.boolean(),
        grade: z.enum(['again', 'hard', 'good', 'easy']).nullable(),
        response: z.string().nullable(),
        at: num,
      }),
    ),
    correctCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
  }),
  xpEvents: z.looseObject({
    ...meta,
    key: z.string().min(1),
    type: z.string(),
    amount: z.number().int(),
    subjectId: nullableId,
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    occurredAt: num,
  }),
  userAchievements: z.looseObject({ ...meta, achievementId: z.string(), unlockedAt: num }),
} as const

export type BackupEntity = keyof typeof backupSchemas
export const BACKUP_ENTITIES = Object.keys(backupSchemas) as BackupEntity[]

export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  createdAt: num,
  appVersion: z.string(),
  scope: z.enum(['full', 'notebook']),
  counts: z.record(z.string(), z.number()),
  files: z.array(z.object({ key: id, size: z.number().int().min(0), sha256: z.string() })),
})

export type BackupManifest = z.infer<typeof manifestSchema>
