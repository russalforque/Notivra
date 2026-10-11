/** Base class for errors whose message is safe and helpful to show to the user. */
export class AppError extends Error {
  readonly userMessage: string
  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options)
    this.name = 'AppError'
    this.userMessage = userMessage
  }
}

/** Local storage is full or the browser refused to persist more data. */
export class StorageQuotaError extends AppError {
  constructor(cause?: unknown) {
    super(
      'Your device storage for Notivra is full. Your latest changes are kept in memory — free up space or export a backup, then retry.',
      { cause },
    )
    this.name = 'StorageQuotaError'
  }
}

/** A write was rejected because the stored record changed since it was read (another tab/device). */
export class ConflictError extends AppError {
  constructor(what = 'This item') {
    super(`${what} was changed somewhere else (another tab or device). Reload to see the latest version.`)
    this.name = 'ConflictError'
  }
}

export class RecordNotFoundError extends AppError {
  constructor(what = 'Item') {
    super(`${what} could not be found. It may have been deleted.`)
    this.name = 'RecordNotFoundError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function isQuotaError(error: unknown): boolean {
  if (error instanceof StorageQuotaError) return true
  if (!(error instanceof Error) && !(typeof DOMException !== 'undefined' && error instanceof DOMException)) return false
  const e = error as Error & { inner?: unknown; code?: number }
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22) return true
  // Dexie wraps the underlying DOMException.
  if (e.inner) return isQuotaError(e.inner)
  return /quota/i.test(e.message)
}

/** Converts any thrown value into a message suitable for the UI. Never leaks stack traces. */
export function toUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof AppError) return error.userMessage
  if (isQuotaError(error)) return new StorageQuotaError().userMessage
  if (error instanceof Error && error.name === 'AbortError') return 'The operation was cancelled.'
  return fallback
}

/** Wraps storage writes so quota failures surface as a typed, user-facing error. */
export async function guardStorage<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (error) {
    if (isQuotaError(error)) throw new StorageQuotaError(error)
    throw error
  }
}
