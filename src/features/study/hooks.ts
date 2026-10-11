import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { StudyItem, StudySession, StudySet } from '../../db/types'
import { isDue } from './srs'

export interface StudySetSummary {
  set: StudySet
  itemCount: number
  dueCount: number
  lastStudiedAt: number | null
}

export function useStudySetSummaries(now: number): StudySetSummary[] | undefined {
  return useLiveQuery(async () => {
    const [sets, items, sessions] = await Promise.all([db.studySets.toArray(), db.studyItems.toArray(), db.studySessions.toArray()])
    const liveItems = items.filter((i) => i.deletedAt === null)
    return sets
      .filter((s) => s.deletedAt === null)
      .map((set) => {
        const own = liveItems.filter((i) => i.setId === set.id)
        const studied = sessions.filter((x) => x.setId === set.id && x.completedAt !== null).map((x) => x.completedAt!)
        return {
          set,
          itemCount: own.length,
          dueCount: own.filter((i) => isDue(i.srs, now)).length,
          lastStudiedAt: studied.length ? Math.max(...studied) : null,
        }
      })
      .sort((a, b) => (b.lastStudiedAt ?? b.set.updatedAt) - (a.lastStudiedAt ?? a.set.updatedAt))
  }, [now])
}

export function useStudySet(id: string | undefined): StudySet | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.studySets.get(id)) ?? null) : null), [id])
}

export function useStudyItems(setId: string | undefined): StudyItem[] | undefined {
  return useLiveQuery(async () => {
    if (!setId) return []
    const items = await db.studyItems.where('[setId+sortOrder]').between([setId, -Infinity], [setId, Infinity]).toArray()
    return items.filter((i) => i.deletedAt === null)
  }, [setId])
}

export function useSessions(setId: string | undefined): StudySession[] | undefined {
  return useLiveQuery(async () => {
    if (!setId) return []
    const sessions = await db.studySessions.where('setId').equals(setId).toArray()
    return sessions.filter((s) => s.completedAt !== null && s.deletedAt === null).sort((a, b) => b.completedAt! - a.completedAt!)
  }, [setId])
}
