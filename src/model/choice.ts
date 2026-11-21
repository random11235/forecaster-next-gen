/** Every kind of choice, in no order: GitHub has epics, labels and milestones; Jira fix versions, epics and labels. */
export const CHOICE_KINDS = ['epic', 'label', 'milestone', 'fixVersion'] as const

/** What a choice picks a milestone's tickets by. */
export type ChoiceKind = (typeof CHOICE_KINDS)[number]

/** The kind of choice `text` names, as a form or URL sends it; none when it names no kind. */
export function choiceKindOf(text: string): ChoiceKind | undefined {
  return CHOICE_KINDS.find((kind) => kind === text)
}

/**
 * Something the EM can pick a milestone's tickets by, with the query that reads them, in the tracker's syntax, built
 * only inside the connector. `forecast/` reads a query back, in that syntax, only to split a hand-edited one at its ORs
 * and find what each part names (`forecast/queryLanguage.ts`), so it can show it as the picks' chips.
 */
export interface Choice {
  kind: ChoiceKind
  name: string
  query: string
}
