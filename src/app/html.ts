import { FONT_FACES } from './fonts.js'
import { MILESTONE_FORECAST_STYLE } from './lib/milestoneForecastStyle.js'
import { INPUTS_STYLE } from './lib/inputsStyle.js'
import { SETUP_STEPS_STYLE } from './lib/setupStepsStyle.js'
import { HOW_IT_WORKS_STYLE } from './lib/howItWorksStyle.js'
import { APP_VERSION, dayMonth } from '../forecast/index.js'
import { FEEDBACK_REPO } from './feedbackRepo.js'

/** The screens in the sidebar, by path. */
const SCREENS = { '/': 'Milestone forecast', '/inputs': 'Inputs', '/how-it-works': 'How it works' } as const

export type ScreenPath = keyof typeof SCREENS

/** The top of a screen: a context line, the headline and an optional lede. `heading` and `lede` are HTML. */
export interface PageHeader {
  context?: string | undefined
  heading: string
  lede?: string
}

/** The app's icon: a finish distribution in small, cream on a burnt orange, its last 15% past the 85% mark shaded lighter, inline so no file is served. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#CC5500"/>' +
    '<clipPath id="hill"><path d="M3 26C9 26 10 8 15 8S22 26 29 26Z"/></clipPath>' +
    '<g clip-path="url(#hill)" fill="#F7F5F0"><rect width="22" height="32"/><rect x="22" width="10" height="32" opacity=".4"/></g></svg>',
)}`

/**
 * A whole screen: the shared head and sidebar around `main`, in the 1b "Weekly brief" look
 * (`docs/design/redesign-1b/`). The browser tab shows the screen's name; `script`, if given, is inlined at the end.
 */
export function htmlPage(path: ScreenPath, header: PageHeader, main: string, script?: string): string {
  const title = SCREENS[path]
  const links = Object.entries(SCREENS)
    .map(([screenPath, name]) => `      <a href="${screenPath}"${screenPath === path ? ' aria-current="page"' : ''}>${name}</a>`)
    .join('\n')
  const context = header.context ? `\n      <p class="context">${escapeHtml(header.context)}</p>` : ''
  const lede = header.lede ? `\n      <p class="lede">${header.lede}</p>` : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Forecaster</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON}">
  <style id="fonts">${FONT_FACES}</style>
  <style>${STYLE}</style>
</head>
<body>
  <nav>
    <span class="wordmark">Forecaster</span>
    <div class="links">
${links}
    </div>
  </nav>
  <main>
    <header>${context}
      <h1>${header.heading}</h1>${lede}
    </header>
${main}
    <footer class="version">Forecaster ${escapeHtml(APP_VERSION)}${sendFeedback(title)}</footer>
  </main>${script ? `\n  <script>${script}</script>` : ''}
</body>
</html>
`
}

/** How Send feedback's issue title begins, left for the reporter to finish. */
const FEEDBACK_TITLE = 'Feedback: '

/**
 * Send feedback, beside the version, for a build with a GitHub repo (#370): GitHub's new-issue form for that repo in a
 * new tab, asking for `needs-triage` (which GitHub applies only for someone with triage permission), its title begun
 * `FEEDBACK_TITLE`, so the issue and its board card read as Feedback unless the reporter clears it (#389), its body
 * prefilled with the version and the screen's name and nothing else of the EM's. Nothing for a build with none.
 */
function sendFeedback(screen: string): string {
  if (!FEEDBACK_REPO) return ''
  const body = `> This issue is public, screenshots included. Blur or crop anything about a real team's work.

### What happened


### What you expected


### Screenshots

<!-- Paste or drag screenshots here. -->

---
Version: ${APP_VERSION}
Screen: ${screen}`
  const href = `https://github.com/${FEEDBACK_REPO}/issues/new?labels=needs-triage&title=${encodeURIComponent(FEEDBACK_TITLE)}&body=${encodeURIComponent(body)}`
  return ` · <a href="${escapeHtml(href)}" target="_blank" rel="noopener">Send feedback</a>`
}

const STYLE = `
    :root {
      --page: #F7F5F0; --ink: #1C1B18; --text-2: #3F3C35; --muted: #5E5A52; --faint: #8C877C;
      --hairline: #E2DDD2; --border: #D6D0C3; --sidebar: #EFEBE3; --active: #E4DFD4;
      --link: #1F5F6B; --link-hover: #123F47; --bar: #9DB6BB; --bar-light: #C9D8DA; --risk: #B5482A; --good: #2F6B3F;
      --mono: 'Geist Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    /* what a page's script hides stays hidden, over any style that shows the element, as a flex or grid item (#275) */
    [hidden] { display: none !important; }
    body {
      margin: 0; min-height: 100vh; display: grid; grid-template-columns: 244px minmax(0, 1fr);
      font-family: 'Geist', system-ui, sans-serif; font-size: 14px; color: var(--ink); background: var(--page);
    }
    a { color: var(--link); }
    a:hover { color: var(--link-hover); }
    button, input { font: inherit; color: inherit; }

    nav {
      background: var(--sidebar); border-right: 1px solid var(--hairline); padding: 24px 14px;
      display: flex; flex-direction: column; gap: 22px;
    }
    nav .wordmark { padding: 0 10px; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
    nav .links { display: flex; flex-direction: column; gap: 2px; }
    nav .links a { padding: 8px 10px; border-radius: 6px; color: var(--text-2); text-decoration: none; }
    nav .links a[aria-current] { background: var(--active); color: var(--ink); font-weight: 600; }

    main { padding: 40px 56px 64px; max-width: 1040px; display: flex; flex-direction: column; gap: 40px; }
    header { display: flex; flex-direction: column; gap: 14px; }
    header p { margin: 0; }
    footer.version { margin-top: auto; font-size: 12px; color: var(--faint); }
    .context { font-size: 13px; color: var(--muted); }
    h1 { margin: 0; font-size: 40px; line-height: 1.15; font-weight: 600; letter-spacing: -0.03em; max-width: 820px; text-wrap: pretty; }
    .risk { color: var(--risk); }
    .good { color: var(--good); }
    .past { color: var(--risk); }
    .lede { font-size: 16px; line-height: 1.5; color: var(--text-2); max-width: 680px; }
    p.note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
    /* A note in passing, such as the finishes a graph leaves off: quieter than the caption above it. */
    p.note.quiet { font-size: 12px; color: var(--faint); }
    p.error { margin: 0; color: var(--risk); font-weight: 600; }
    p.warning { margin: 0; font-size: 14px; line-height: 1.5; color: var(--risk); }

${MILESTONE_FORECAST_STYLE}${INPUTS_STYLE}${SETUP_STEPS_STYLE}${HOW_IT_WORKS_STYLE}  `

/** `2026-12-18` → `18 Dec 2026`. */
export function formatDate(isoDate: string): string {
  return `${dayMonth(isoDate)} ${isoDate.slice(0, 4)}`
}

/** A share as a whole percent, or "under 1%" for a share that rounds to 0 but holds some simulations. */
export function percentText(share: number): string {
  return share > 0 && share < 0.005 ? 'under 1%' : `${Math.round(share * 100)}%`
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
