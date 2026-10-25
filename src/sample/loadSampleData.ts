import type { Storage } from '../storage/storage.js'
import { SAMPLE_DATA } from './sampleData.js'

/** On first launch (nothing stored yet), loads the canned sample team, facts, milestone and workflow. Otherwise does nothing. */
export function loadSampleDataIfEmpty(storage: Storage): void {
  if (!storage.isEmpty()) return
  storage.saveTeam(SAMPLE_DATA.team)
  storage.addFacts(SAMPLE_DATA.team.id, SAMPLE_DATA.facts)
  storage.saveMilestone(SAMPLE_DATA.milestone)
  storage.saveWorkflowSettings(SAMPLE_DATA.workflow)
}
