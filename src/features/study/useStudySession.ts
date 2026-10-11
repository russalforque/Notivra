import { useCallback, useRef, useState } from 'react'
import { toast } from '../../components/ui/toast'
import type { SessionAnswer, StudySession } from '../../db/types'
import { toUserMessage } from '../../lib/errors'
import { onSessionCompleted } from '../progress/xpTriggers'
import { completeSession, recordAnswer, startSession } from './studyService'

/**
 * Session lifecycle. The session record is created on the first answer (no empty sessions),
 * every answer is persisted immediately, and completion awards XP exactly once.
 */
export function useStudySession(setId: string, mode: StudySession['mode'], totalCount: number) {
  const session = useRef<StudySession | null>(null)
  const starting = useRef<Promise<StudySession> | null>(null)
  const [result, setResult] = useState<{ session: StudySession; xp: number } | null>(null)

  const ensureSession = useCallback(async () => {
    if (session.current) return session.current
    if (!starting.current) starting.current = startSession(setId, mode, totalCount)
    session.current = await starting.current
    return session.current
  }, [setId, mode, totalCount])

  const answer = useCallback(
    async (a: Omit<SessionAnswer, 'at'>) => {
      try {
        const s = await ensureSession()
        session.current = await recordAnswer(s.id, { ...a, at: Date.now() })
      } catch (err) {
        toast.error(toUserMessage(err, 'Your answer could not be saved.'))
      }
    },
    [ensureSession],
  )

  const finish = useCallback(async () => {
    try {
      const s = session.current
      if (!s) return
      const done = await completeSession(s.id)
      const { xp } = await onSessionCompleted(done)
      setResult({ session: done, xp })
    } catch (err) {
      toast.error(toUserMessage(err, 'The session could not be completed.'))
    }
  }, [])

  return { answer, finish, result }
}
