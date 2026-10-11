// Supabase Edge Function: generates study materials with Claude.
//
// Security model
// - The Anthropic key lives only in this function's secrets (ANTHROPIC_API_KEY); the client
//   never sees it.
// - Callers must be signed in; the user is resolved from their JWT.
// - Usage limits are business rules in Postgres (ai_plan_limits / consume_ai_quota), applied
//   atomically before any model call. They are not UI-only restrictions.
// - Input size is validated and capped; model output is validated before it is returned.
// - Document text is never logged.
//
// Deploy:  supabase functions deploy ai-generate
// Secrets: supabase secrets set ANTHROPIC_API_KEY=... [AI_MODEL=claude-opus-5-5]

import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4.6.5'

const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-opus-5-5'
const MAX_INPUT_CHARS = 60_000

// ───────────── contract (keep in sync with src/services/ai/aiContract.ts) ─────────────

const requestSchema = z.object({
  outputs: z.array(z.enum(['summary', 'reviewer', 'flashcards', 'quiz'])).min(1).max(4),
  text: z.string().trim().min(200, 'Please provide at least 200 characters of source text.').max(MAX_INPUT_CHARS),
  sourceLabel: z.string().trim().max(200),
  flashcardCount: z.number().int().min(1).max(40).default(15),
  quizCount: z.number().int().min(1).max(30).default(10),
})

const flashcardSchema = z.object({ front: z.string().min(1).max(1000), back: z.string().min(1).max(2000), sourceRef: z.string().max(100) })
const quizSchema = z.object({
  type: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  question: z.string().min(1).max(2000),
  choices: z.array(z.string().min(1).max(500)).max(6),
  answer: z.string().min(1).max(1000),
  explanation: z.string().max(2000),
  sourceRef: z.string().max(100),
})
const responseSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(20_000),
  reviewer: z.string().max(40_000),
  flashcards: z.array(flashcardSchema).max(40),
  quiz: z.array(quizSchema).max(30),
})

/** JSON schema for structured outputs. Every field is required; unrequested parts are empty. */
const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'reviewer', 'flashcards', 'quiz'],
  properties: {
    title: { type: 'string', description: 'Short title for the study set (max 80 characters).' },
    summary: { type: 'string', description: 'Markdown summary, or empty string if not requested.' },
    reviewer: { type: 'string', description: 'Markdown exam reviewer, or empty string if not requested.' },
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['front', 'back', 'sourceRef'],
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          sourceRef: { type: 'string', description: 'e.g. "Page 3", or empty string if unknown.' },
        },
      },
    },
    quiz: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'question', 'choices', 'answer', 'explanation', 'sourceRef'],
        properties: {
          type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer'] },
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' }, description: '4 options for multiple_choice, empty otherwise.' },
          answer: { type: 'string', description: 'For multiple_choice: exactly one of the choices. For true_false: "true" or "false".' },
          explanation: { type: 'string' },
          sourceRef: { type: 'string' },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = `You create study materials for students from their own notes and course documents.

Use only the information in the provided source text. Do not add facts that the source does not support; if the source is thin, produce fewer, accurate items rather than padding. Write in the same language as the source text.

When the source contains page markers like "[Page 3]", set sourceRef to that page (e.g. "Page 3") for each item; otherwise use an empty string.

Quality bar:
- Flashcards test one idea each. Fronts are specific questions or terms; backs are concise and complete.
- Quiz questions have exactly one defensible correct answer. Multiple-choice distractors are plausible but clearly wrong to someone who studied. Explanations say why the answer is right.
- Summaries are well-structured Markdown with headings and bullet points.
- Reviewers are exam-focused Markdown: key definitions, processes, formulas, likely exam questions, and common mistakes.

Produce only the parts that are requested. For parts that are not requested, return an empty string or empty array.`

// ───────────── HTTP helpers ─────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } })
}

function fail(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json(status, { error: { code, message } }, extra)
}

const anthropic = new Anthropic({ timeout: 120_000, maxRetries: 2 })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.')

  // 1) Authenticate.
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return fail(401, 'unauthorized', 'Please sign in to use AI study tools.')

  // 2) Validate input (with an early size guard before parsing the body).
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_INPUT_CHARS * 4 + 10_000) return fail(413, 'too_large', 'The source text is too long. Select fewer pages.')
  let input: z.infer<typeof requestSchema>
  try {
    const parsed = requestSchema.safeParse(await req.json())
    if (!parsed.success) return fail(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request.')
    input = parsed.data
  } catch {
    return fail(400, 'invalid_request', 'Request body must be JSON.')
  }

  // 3) Enforce plan limits atomically (service role: the quota table is not client-writable).
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: quota, error: quotaError } = await admin.rpc('consume_ai_quota', { p_user_id: userData.user.id, p_input_chars: input.text.length })
  if (quotaError) {
    console.error('quota check failed', quotaError.message)
    return fail(503, 'unavailable', 'AI is temporarily unavailable. Please try again later.')
  }
  const q = Array.isArray(quota) ? quota[0] : quota
  if (!q?.allowed) {
    const message =
      q?.reason === 'input_too_large'
        ? 'This source is longer than your plan allows. Select fewer pages.'
        : `You have used all ${q?.daily_limit ?? 'of today’s'} AI generations for today. Try again tomorrow.`
    return fail(429, 'quota_exceeded', message)
  }

  // 4) Call the model.
  const wants = (part: string) => input.outputs.includes(part as never)
  const instructions = [
    `Source: ${input.sourceLabel || 'student notes'}`,
    `Requested parts: ${input.outputs.join(', ')}.`,
    wants('flashcards') ? `Create up to ${input.flashcardCount} flashcards.` : 'Do not create flashcards.',
    wants('quiz') ? `Create up to ${input.quizCount} quiz questions with a mix of multiple_choice, true_false and short_answer.` : 'Do not create quiz questions.',
    wants('summary') ? 'Write a summary.' : 'Leave summary empty.',
    wants('reviewer') ? 'Write an exam reviewer.' : 'Leave reviewer empty.',
  ].join('\n')

  let message: Anthropic.Beta.BetaMessage
  try {
    message = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `<source_text>\n${input.text}\n</source_text>\n\n${instructions}`,
        },
      ],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return fail(503, 'busy', 'The AI service is busy. Please try again in a minute.', { 'Retry-After': '60' })
    }
    if (error instanceof Anthropic.APIConnectionError) return fail(503, 'unavailable', 'Could not reach the AI service. Please try again.')
    if (error instanceof Anthropic.APIError) {
      console.error('anthropic error', error.status, error.type)
      if (error.status === 529 || (error.status ?? 0) >= 500) return fail(503, 'busy', 'The AI service is overloaded. Please try again shortly.', { 'Retry-After': '30' })
      return fail(502, 'upstream_error', 'The AI service rejected the request.')
    }
    console.error('unexpected error', error)
    return fail(500, 'internal', 'Something went wrong while generating.')
  }

  if (message.stop_reason === 'refusal') return fail(422, 'declined', 'The AI declined to process this content. Try a different selection.')
  if (message.stop_reason === 'max_tokens') return fail(422, 'too_long', 'The result was too long. Request fewer items or select fewer pages.')

  // 5) Validate model output before returning it.
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let output: z.infer<typeof responseSchema>
  try {
    const parsed = responseSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message)
    output = parsed.data
  } catch (error) {
    console.error('malformed model output', (error as Error).message)
    return fail(502, 'malformed', 'The AI returned an unusable result. Please try again.')
  }
  // Drop internally inconsistent quiz items rather than failing the whole request.
  output.quiz = output.quiz.filter((item) =>
    item.type === 'multiple_choice'
      ? item.choices.length >= 2 && item.choices.includes(item.answer)
      : item.type === 'true_false'
        ? item.answer === 'true' || item.answer === 'false'
        : true,
  )

  return json(200, { ...output, model: message.model, remainingToday: q.remaining ?? null })
})
