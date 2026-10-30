/** Why an edit the EM made on the Inputs screen was refused. */
export type Refusal = { ok: false; error: string }

/** Whether an edit the EM made on the Inputs screen was saved, or why it was refused. */
export type EditResult = { ok: true } | Refusal

/** A refused edit, saying why. */
export function refuse(error: string): Refusal {
  return { ok: false, error }
}
