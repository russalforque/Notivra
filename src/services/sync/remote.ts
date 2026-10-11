import type { SupabaseClient } from '@supabase/supabase-js'
import type { RemoteRow } from './mapping'

export type PushResult = { status: 'ok'; rev: number } | { status: 'conflict'; remote: RemoteRow }

/** Error classes the engine reacts to differently. */
export class RemoteError extends Error {
  readonly kind: 'network' | 'auth' | 'duplicate' | 'too_large' | 'server'
  constructor(kind: RemoteError['kind'], message: string) {
    super(message)
    this.name = 'RemoteError'
    this.kind = kind
  }
}

/** Backend-neutral sync transport. Implemented by Supabase in production and in-memory in tests. */
export interface SyncRemote {
  push(table: string, id: string, baseRev: number | null, record: Record<string, unknown>): Promise<PushResult>
  /** Rows changed after `since` (exclusive), oldest first. */
  pull(table: string, since: string | null, limit: number): Promise<RemoteRow[]>
  uploadFile(path: string, bytes: Uint8Array): Promise<void>
  downloadFile(path: string): Promise<Uint8Array>
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function classify(error: { message?: string; code?: string; status?: number } | null | undefined): RemoteError {
  const message = error?.message ?? 'Unknown sync error'
  if (error?.code === '23505') return new RemoteError('duplicate', message)
  if (error?.code === '28000' || error?.status === 401 || /JWT|not authenticated/i.test(message)) return new RemoteError('auth', message)
  if (/Failed to fetch|NetworkError|network|timeout/i.test(message)) return new RemoteError('network', message)
  return new RemoteError('server', message)
}

export class SupabaseRemote implements SyncRemote {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  async push(table: string, id: string, baseRev: number | null, record: Record<string, unknown>): Promise<PushResult> {
    const { data, error } = await this.client.rpc('sync_push', { p_table: table, p_id: id, p_base_rev: baseRev, p_record: record })
    if (error) throw classify(error)
    return data as PushResult
  }

  async pull(table: string, since: string | null, limit: number): Promise<RemoteRow[]> {
    let query = this.client.from(table).select('*').order('server_updated_at', { ascending: true }).limit(limit)
    if (since) query = query.gt('server_updated_at', since)
    const { data, error } = await query
    if (error) throw classify(error)
    return (data ?? []) as RemoteRow[]
  }

  async uploadFile(path: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new RemoteError('too_large', 'File is larger than the 50 MB cloud limit.')
    const { error } = await this.client.storage
      .from('documents')
      .upload(path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
    if (error) throw classify(error)
  }

  async downloadFile(path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from('documents').download(path)
    if (error || !data) throw classify(error)
    return new Uint8Array(await data.arrayBuffer())
  }
}
