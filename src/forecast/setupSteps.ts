/** The setup steps, in order: connect a tracker, pick the milestone's tickets, pick comparable work, check what they give. */
export const SETUP_STEPS = ['connect', 'milestone', 'comparableWork', 'check'] as const

/** A setup step. */
export type SetupStep = (typeof SETUP_STEPS)[number]

/** The setup step `text` names, as a URL sends it; none when it names no step. */
export function setupStepOf(text: string | null | undefined): SetupStep | undefined {
  return SETUP_STEPS.find((step) => step === text)
}
