import { z } from 'zod'
import { ValidationError } from './errors'

export const titleSchema = z
  .string()
  .trim()
  .min(1, 'Please enter a name.')
  .max(120, 'Names can be at most 120 characters.')

export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Invalid color.')

/** Parses with a zod schema and converts failures into a user-facing ValidationError. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid input.')
  }
  return result.data
}
