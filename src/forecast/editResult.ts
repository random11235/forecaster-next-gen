/** Whether an edit the EM made on the Inputs screen was saved, or why it was refused. */
export type EditResult = { ok: true } | { ok: false; error: string }

/** A refused edit, saying why. */
export function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
