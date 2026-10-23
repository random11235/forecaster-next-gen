/** The Milestone forecast screen (EM home). With no milestone defined it shows its empty state. */
export function renderMilestoneForecastScreen(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Milestone forecast · Forecaster</title>
</head>
<body>
  <main>
    <h1>Milestone forecast</h1>
    <section aria-label="Empty state">
      <p>No milestone defined yet.</p>
      <p>Define a milestone, with its committed date and epics, to see its forecast here.</p>
    </section>
  </main>
</body>
</html>
`
}
