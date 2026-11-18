/**
 * Where a team's facts come from: `'manual'` when the EM enters them by hand, with no connector, as for the team added
 * on first launch; `'sample'` for the canned data earlier releases loaded on first launch; otherwise the connector that
 * reads them.
 */
export type TeamSource = 'manual' | 'sample' | 'jira' | 'github'

export const TEAM_SOURCES = ['manual', 'sample', 'jira', 'github'] as const satisfies readonly TeamSource[]

/** Compiles only when `Missing`, the members a list leaves out, is none. */
type NoneMissing<Missing extends never> = Missing
// the list above names every team source
type AllTeamSources = NoneMissing<Exclude<TeamSource, (typeof TEAM_SOURCES)[number]>>

/** A team, which owns every other record. v1 has one; keying by team means multi-team needs no migration. */
export interface Team {
  id: string
  name: string
  source: TeamSource
  /** The board or repository the facts are read from. */
  sourceRef: string
  /**
   * ISO timestamp: when the Forecaster was installed for this team. Nothing the team finished before it is used
   * automatically, since a different team, KTLO load or way of working could quietly skew the forecast.
   */
  installedAt: string
}
