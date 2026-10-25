import type { StatusCategory, WorkflowSettings } from '../model/workflow.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'

/**
 * The facts as the team's workflow reads them: each ticket's started, done and cancelled times come from its status
 * history and the EM's status mapping, so changing the mapping changes which tickets count as done.
 * - started: when the ticket first entered the started status; a ticket that skipped it starts when it first entered
 *   any status mapped to started, or, if it skipped those too, when it first entered one mapped to done;
 * - done or cancelled: when the ticket entered its current status, if that status (and any run of the same
 *   category just before it) is mapped to done or cancelled;
 * - a status the EM hasn't mapped counts as not started.
 * A ticket with no status history keeps the times the connector gave it.
 */
export function factsUnderWorkflow(facts: Facts, workflow: WorkflowSettings): Facts {
  const categoryOf = new Map(workflow.statuses.map((mapping) => [mapping.status, mapping.category]))
  const category = (status: string | undefined): StatusCategory =>
    (status !== undefined && categoryOf.get(status)) || 'notStarted'

  const history = new Map<string, WorkItemEvent[]>()
  for (const event of facts.events) {
    if (event.kind !== 'status') continue
    const events = history.get(event.itemId) ?? []
    events.push(event)
    history.set(event.itemId, events)
  }

  const workItems = facts.workItems.map((item): WorkItem => {
    const statuses = history.get(item.id)
    if (!statuses) return item
    const ordered = [...statuses].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    const { startedAt: _startedAt, doneAt: _doneAt, cancelledAt: _cancelledAt, ...rest } = item
    const firstEntry = (matches: (status: string | undefined) => boolean): string | undefined =>
      ordered.find((event) => matches(event.to))?.at
    const startedAt =
      firstEntry((status) => status === workflow.startedStatus) ??
      firstEntry((status) => category(status) === 'started') ??
      firstEntry((status) => category(status) === 'done')

    const ended = category(ordered.at(-1)?.to)
    let endedAt: string | undefined
    if (ended === 'done' || ended === 'cancelled') {
      let first = ordered.length - 1
      while (first > 0 && category(ordered[first - 1]!.to) === ended) first--
      endedAt = ordered[first]!.at
    }
    return {
      ...rest,
      ...(startedAt !== undefined && { startedAt }),
      ...(ended === 'done' && endedAt !== undefined && { doneAt: endedAt }),
      ...(ended === 'cancelled' && endedAt !== undefined && { cancelledAt: endedAt }),
    }
  })
  return { workItems, events: facts.events }
}
