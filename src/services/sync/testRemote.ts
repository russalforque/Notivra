import type { RemoteRow } from './mapping'
import { RemoteError, type PushResult, type SyncRemote } from './remote'

/**
 * In-memory implementation of the server contract in supabase/migrations (sync_push + pulls).
 * Used by tests to simulate the cloud and other devices.
 */
export class InMemoryRemote implements SyncRemote {
  tables = new Map<string, Map<string, RemoteRow>>()
  files = new Map<string, Uint8Array>()
  private clock = Date.parse('2026-01-01T00:00:00Z')
  offline = false
  /** When set, the next push is applied but the response is "lost" (throws a network error). */
  loseNextResponse = false
  uniqueKeys: Record<string, string> = { xp_events: 'key', user_achievements: 'achievement_id' }

  readonly ownerId: string

  constructor(ownerId = 'user-1') {
    this.ownerId = ownerId
  }

  private table(name: string) {
    let t = this.tables.get(name)
    if (!t) this.tables.set(name, (t = new Map()))
    return t
  }

  private tick(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  async push(table: string, id: string, baseRev: number | null, record: Record<string, unknown>): Promise<PushResult> {
    if (this.offline) throw new RemoteError('network', 'Failed to fetch')
    const t = this.table(table)
    const current = t.get(id)
    let result: PushResult
    if (!current) {
      const uk = this.uniqueKeys[table]
      if (uk && [...t.values()].some((r) => r[uk] === record[uk])) throw new RemoteError('duplicate', 'duplicate key value')
      t.set(id, { ...record, id, owner_id: this.ownerId, rev: 1, server_updated_at: this.tick() } as RemoteRow)
      result = { status: 'ok', rev: 1 }
    } else if (baseRev === null || current.rev !== baseRev) {
      result = { status: 'conflict', remote: structuredClone(current) }
    } else {
      t.set(id, { ...record, id, owner_id: this.ownerId, rev: current.rev + 1, server_updated_at: this.tick() } as RemoteRow)
      result = { status: 'ok', rev: current.rev + 1 }
    }
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new RemoteError('network', 'Failed to fetch (response lost)')
    }
    return result
  }

  async pull(table: string, since: string | null, limit: number): Promise<RemoteRow[]> {
    if (this.offline) throw new RemoteError('network', 'Failed to fetch')
    return [...this.table(table).values()]
      .filter((r) => !since || r.server_updated_at > since)
      .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at))
      .slice(0, limit)
      .map((r) => structuredClone(r))
  }

  async uploadFile(path: string, bytes: Uint8Array): Promise<void> {
    if (this.offline) throw new RemoteError('network', 'Failed to fetch')
    this.files.set(path, bytes.slice())
  }

  async downloadFile(path: string): Promise<Uint8Array> {
    const f = this.files.get(path)
    if (!f) throw new RemoteError('server', 'not found')
    return f.slice()
  }

  /** Simulates another device editing a row (as the server would after its push). */
  otherDeviceEdit(table: string, id: string, patch: Record<string, unknown>): void {
    const t = this.table(table)
    const current = t.get(id)
    if (!current) throw new Error('no such row')
    t.set(id, { ...current, ...patch, rev: current.rev + 1, server_updated_at: this.tick() })
  }

  /** Simulates another device inserting a row. */
  otherDeviceInsert(table: string, row: Record<string, unknown> & { id: string }): void {
    this.table(table).set(row.id, { ...row, owner_id: this.ownerId, rev: 1, server_updated_at: this.tick() } as RemoteRow)
  }
}
