/**
 * The pace a milestone's forecast uses: the EM's manual low–high range of tickets per week (set on the Inputs
 * screen), or the milestone's measured weekly pace once the EM has switched to it.
 */
export type PaceSetting = { teamId: string; milestoneId: string } & (
  | {
      mode: 'manual'
      /** Whole tickets per week, both ends included. */
      low: number
      high: number
    }
  | { mode: 'measured' }
)
