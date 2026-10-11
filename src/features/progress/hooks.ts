import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { computeStats, type ProgressStats } from './xpService'

export function useProgressStats(): ProgressStats | undefined {
  return useLiveQuery(computeStats, [])
}

export function useUnlockedAchievements() {
  return useLiveQuery(async () => {
    const rows = await db.userAchievements.toArray()
    return new Map(rows.filter((r) => r.deletedAt === null).map((r) => [r.achievementId, r.unlockedAt]))
  }, [])
}
