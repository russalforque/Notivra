import { AppError } from '../../lib/errors'
import { functionsUrl, supabase } from '../supabase/client'
import { aiRequestSchema, aiResponseSchema, type AiRequest, type AiResponse } from './aiContract'

export type AiErrorCode =
  | 'not_configured'
  | 'signed_out'
  | 'offline'
  | 'invalid_request'
  | 'quota_exceeded'
  | 'busy'
  | 'declined'
  | 'too_long'
  | 'malformed'
  | 'timeout'
  | 'unavailable'

export class AiError extends AppError {
  readonly code: AiErrorCode
  readonly retryable: boolean
  constructor(code: AiErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'AiError'
    this.code = code
    this.retryable = retryable
  }
}

/** Provider-independent interface: the UI depends on this, not on any vendor. */
export interface StudyAiProvider {
  generate(request: AiRequest, signal?: AbortSignal): Promise<AiResponse>
}

const TIMEOUT_MS = 150_000

/** Calls our own backend (Supabase Edge Function), which holds the provider key. */
export class EdgeFunctionAiProvider implements StudyAiProvider {
  async generate(request: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    if (!supabase) throw new AiError('not_configured', 'AI study tools need the Notivra cloud service, which is not configured in this build.')
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new AiError('offline', 'You are offline. AI generation needs an internet connection — everything else keeps working.', true)
    const body = aiRequestSchema.parse(request)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new AiError('signed_out', 'Sign in (Settings → Account) to use AI study tools.')

    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    // AbortSignal.any is missing on older Android WebViews; fall back to the timeout alone.
    const combined = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : (signal ?? timeout)
    let res: Response
    try {
      res = await fetch(functionsUrl('ai-generate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (timeout.aborted) throw new AiError('timeout', 'The AI took too long to respond. Try again with fewer pages.', true)
      if (signal?.aborted) throw error
      throw new AiError('unavailable', 'Could not reach the AI service. Check your connection and try again.', true)
    }

    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      throw new AiError('malformed', 'The AI service returned an unreadable response.', true)
    }
    if (!res.ok) {
      const err = (payload as { error?: { code?: string; message?: string } })?.error
      const code = (err?.code ?? 'unavailable') as AiErrorCode
      const retryable = res.status === 503 || res.status === 502 || res.status === 500
      throw new AiError(res.status === 401 ? 'signed_out' : code, err?.message ?? 'AI generation failed.', retryable)
    }
    // Validate again on the client: never trust a network response blindly.
    const parsed = aiResponseSchema.safeParse(payload)
    if (!parsed.success) throw new AiError('malformed', 'The AI returned an unusable result. Please try again.', true)
    return parsed.data
  }
}

let provider: StudyAiProvider = new EdgeFunctionAiProvider()

export function getAiProvider(): StudyAiProvider {
  return provider
}

/** Test seam / future providers. */
export function setAiProvider(p: StudyAiProvider): void {
  provider = p
}
