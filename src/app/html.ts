import type { CommitView } from '../forecast/milestoneDefinition.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A whole screen: the shared head and navigation around `main`. */
export function htmlPage(title: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Forecaster</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1f2328; }
    nav a { margin-right: 1rem; }
    table { border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.4rem 1.5rem 0.4rem 0; text-align: left; border-bottom: 1px solid #d0d7de; }
    td.number { text-align: right; }
    ul.dates { list-style: none; padding: 0; font-size: 1.15rem; }
    ul.dates li { margin: 0.25rem 0; }
    p.note { color: #57606a; }
    p.error { color: #cf222e; }
    label { margin-right: 1rem; }
    input[type=number] { width: 5rem; }
    fieldset { margin: 1rem 0; border: 1px solid #d0d7de; }
    label.epic { display: block; margin: 0.25rem 0; }
    ol.epics li { margin: 0.35rem 0; }
    ol.epics span { display: inline-block; min-width: 16rem; }
  </style>
</head>
<body>
  <nav><a href="/">Milestone forecast</a><a href="/inputs">Inputs</a></nav>
  <main>
    <h1>${escapeHtml(title)}</h1>
${main}
  </main>
</body>
</html>
`
}

/** A committed epic's commit, the same on every screen: `Committed at 14 items`. */
export function commitText(commit: CommitView): string {
  return `Committed at ${commit.baseline} items`
}

/** `2026-12-18` → `18 Dec 2026`. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${MONTHS[month! - 1]} ${year}`
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
