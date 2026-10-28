import type { z } from 'zod'
import { ApiClientError } from './api'

export type FieldErrors = Record<string, string>

/** Validates with the same schema the server uses. */
export function validate<S extends z.ZodType>(schema: S, data: unknown): { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(data)
  if (r.success) return { ok: true, data: r.data }
  const errors: FieldErrors = {}
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? '_')
    if (!(key in errors)) errors[key] = issue.message
  }
  return { ok: false, errors }
}

/** Maps a server validation response onto form fields. */
export function serverFieldErrors(err: unknown): FieldErrors {
  return err instanceof ApiClientError && err.details ? err.details : {}
}
