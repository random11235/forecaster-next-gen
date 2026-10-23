/** A team, which owns every other record. v1 has one; keying by team means multi-team needs no migration. */
export interface Team {
  id: string
  name: string
  /** Where the team's facts come from; `'sample'` is the canned data loaded on first launch. */
  source: 'sample' | 'jira' | 'github'
  /** The board or repository the facts are read from. */
  sourceRef: string
}
