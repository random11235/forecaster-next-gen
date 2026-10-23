import type { EpicRow, MilestoneForecastView } from '../forecast/milestoneForecastView.js'

const STATUS_TEXT: Record<EpicRow['status'], string> = { notCommitted: 'Not committed' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The Milestone forecast screen (EM home): the milestone's epics, or its empty state when no milestone is defined. */
export function renderMilestoneForecastScreen(view: MilestoneForecastView): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Milestone forecast · Forecaster</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1f2328; }
    table { border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.4rem 1.5rem 0.4rem 0; text-align: left; border-bottom: 1px solid #d0d7de; }
    td.number { text-align: right; }
  </style>
</head>
<body>
  <main>
    <h1>Milestone forecast</h1>
${view.kind === 'milestone' ? milestone(view) : EMPTY_STATE}
  </main>
</body>
</html>
`
}

const EMPTY_STATE = `    <section aria-label="Empty state">
      <p>No milestone defined yet.</p>
      <p>Define a milestone, with its committed date and epics, to see its forecast here.</p>
    </section>`

function milestone(view: Extract<MilestoneForecastView, { kind: 'milestone' }>): string {
  const rows = view.epics
    .map(
      (epic) => `          <tr>
            <td>${escapeHtml(epic.name)}</td>
            <td class="number">${epic.itemsNow}</td>
            <td>${STATUS_TEXT[epic.status]}</td>
          </tr>`,
    )
    .join('\n')
  return `    <section aria-label="Milestone">
      <h2>${escapeHtml(view.name)} · committed ${formatDate(view.committedDate)}</h2>
      <table>
        <thead>
          <tr><th>Epics in this milestone</th><th>Items now</th><th>Status</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </section>`
}

/** `2026-12-18` → `18 Dec 2026`. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${MONTHS[month! - 1]} ${year}`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
