// The Inputs screen's HTML cut to one of its sections, so a test reads that section alone, however it got the HTML:
// over HTTP from the served build, or from the routes in-process.

/** The section with `id` of `html`, the Inputs screen, as the app answers with it over HTTP or in-process. */
export function inputsSection(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`)
  if (start === -1) throw new Error(`no section ${id} on the Inputs screen`)
  return html.slice(start, html.indexOf('</section>', start))
}
