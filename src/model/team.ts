/** A team, which owns every other record. v1 has one; keying by team means multi-team needs no migration. */
export interface Team {
  id: string
  name: string
  /**
   * Where the team's facts come from: `'manual'` for none, everything the EM types in, as for the team added on first
   * launch; `'sample'` for the canned data earlier releases loaded on first launch.
   */
  source: 'manual' | 'sample' | 'jira' | 'github'
  /** The board or repository the facts are read from. */
  sourceRef: string
  /**
   * ISO timestamp: when the Forecaster was installed for this team. Nothing the team finished before it is used
   * automatically, since a different team, KTLO load or way of working could quietly skew the forecast.
   */
  installedAt: string
}
