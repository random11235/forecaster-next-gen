
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The screens in the sidebar, by path. */
const SCREENS = [
  { path: '/', name: 'Milestone forecast' },
  { path: '/inputs', name: 'Inputs' },
] as const

export type ScreenPath = (typeof SCREENS)[number]['path']

/** The top of a screen: a context line, the headline and an optional lede. `heading` and `lede` are HTML. */
export interface PageHeader {
  context?: string | undefined
  heading: string
  lede?: string
}

/**
 * A whole screen: the shared head and sidebar around `main`, in the 1b "Weekly brief" look
 * (`docs/design/redesign-1b/`). `title` names the screen in the browser tab.
 */
export function htmlPage(title: string, path: ScreenPath, header: PageHeader, main: string): string {
  const links = SCREENS.map(
    (screen) => `      <a href="${screen.path}"${screen.path === path ? ' aria-current="page"' : ''}>${screen.name}</a>`,
  ).join('\n')
  const context = header.context ? `\n      <p class="context">${escapeHtml(header.context)}</p>` : ''
  const lede = header.lede ? `\n      <p class="lede">${header.lede}</p>` : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Forecaster</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
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
  </main>
</body>
</html>
`
}

const STYLE = `
    :root {
      --page: #F7F5F0; --ink: #1C1B18; --text-2: #3F3C35; --muted: #5E5A52; --faint: #8C877C;
      --hairline: #E2DDD2; --border: #D6D0C3; --sidebar: #EFEBE3; --active: #E4DFD4;
      --link: #1F5F6B; --link-hover: #123F47; --bar: #9DB6BB; --risk: #B5482A; --good: #2F6B3F;
      --mono: 'Geist Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
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
    .context { font-size: 13px; color: var(--muted); }
    h1 { margin: 0; font-size: 40px; line-height: 1.15; font-weight: 600; letter-spacing: -0.03em; max-width: 820px; text-wrap: pretty; }
    .risk { color: var(--risk); }
    .good { color: var(--good); }
    .lede { font-size: 16px; line-height: 1.5; color: var(--text-2); max-width: 680px; }
    p.note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
    p.error { margin: 0; color: var(--risk); font-weight: 600; }
    p.warning { margin: 0; font-size: 14px; line-height: 1.5; color: var(--risk); }

    /* Milestone forecast: sections under an ink rule. */
    .brief { display: flex; flex-direction: column; gap: 10px; }
    .brief > .heading {
      display: flex; justify-content: space-between; align-items: baseline;
      border-bottom: 1px solid var(--ink); padding-bottom: 8px;
    }
    .brief h2 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
    .brief > .heading a { font-size: 13px; }
    ul.dates { list-style: none; margin: 0; padding: 0; }
    ul.dates li { display: flex; gap: 8px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--hairline); font-size: 15px; }
    ul.dates .percent { font-family: var(--mono); font-weight: 600; min-width: 3.5em; }
    ul.dates .date { font-family: var(--mono); font-weight: 600; }

    /* Milestone forecast: the finish graph. Markers stand on rows above the bars and run down through them. */
    figure.finish-graph { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .finish-graph .plot { position: relative; padding-top: 92px; }
    .finish-graph .bars { height: 160px; display: flex; align-items: flex-end; border-bottom: 1px solid var(--ink); }
    .finish-graph .bar { flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; padding: 0 1px; min-width: 0; }
    .finish-graph .fill { width: 100%; background: var(--bar); border-radius: 2px 2px 0 0; }
    .finish-graph .marker { position: absolute; bottom: 0; border-left: 1px dashed var(--faint); }
    .finish-graph .marker.headline { border-left: 2px solid var(--ink); }
    .finish-graph .mark { position: absolute; top: 0; left: 6px; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--muted); }
    .finish-graph .marker.end .mark { left: auto; right: 6px; }
    .finish-graph .mark .date { font-family: var(--mono); }
    .finish-graph .mark.headline { color: var(--ink); font-weight: 600; }
    .finish-graph .axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px; color: var(--muted); }

    /* Inputs: numbered sections, a label column beside the form. */
    section.input {
      display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 32px;
      border-top: 1px solid var(--ink); padding-top: 18px;
    }
    section.input > .label { display: flex; flex-direction: column; gap: 6px; }
    section.input > .label .number { font-family: var(--mono); font-size: 12px; color: var(--faint); }
    section.input > .label h2 { margin: 0; font-size: 17px; font-weight: 600; }
    section.input > .label p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--muted); }
    section.input > .body { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    section.input form { margin: 0; display: flex; flex-direction: column; gap: 16px; }
    .fields { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; }
    .fields label { flex: 1 1 200px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
    .fields label.wide { flex-grow: 2; }
    input[type=text], input[type=date], input[type=number] {
      font-size: 15px; color: var(--ink); background: transparent;
      border: 0; border-bottom: 1px solid var(--ink); border-radius: 0; padding: 6px 0;
    }
    input[type=date], input[type=number] { font-family: var(--mono); }
    input:focus, button:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
    button {
      min-height: 34px; padding: 0 12px; border-radius: 6px; font-size: 13px; cursor: pointer;
      border: 1px solid var(--border); background: transparent;
    }
    .actions { display: flex; justify-content: flex-end; }
    button.primary { min-height: 42px; padding: 0 20px; border: 0; background: var(--ink); color: var(--page); font-size: 14px; font-weight: 600; }
    .pace { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; }
    .pace label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
    .pace input[type=number] { font-size: 32px; width: 72px; text-align: center; padding: 2px 0; }
    .pace .to { font-size: 24px; color: var(--faint); padding-bottom: 6px; }
    .pace .unit { color: var(--text-2); padding-bottom: 10px; }
    table.growth { border-collapse: collapse; }
    table.growth th { padding: 0 24px 6px 0; text-align: left; font-size: 12px; font-weight: 500; color: var(--faint); }
    table.growth td { padding: 6px 24px 6px 0; }
    table.growth input[type=number] { width: 64px; text-align: center; }
    table.growth .to, table.growth .unit { padding: 0 8px; font-size: 13px; color: var(--muted); }

    @media (max-width: 760px) {
      body { grid-template-columns: minmax(0, 1fr); }
      nav { flex-direction: row; align-items: center; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--hairline); }
      nav .links { flex-direction: row; }
      main { padding: 28px 16px 48px; }
      h1 { font-size: 30px; }
      section.input { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    }
  `

/** `2026-12-18` → `18 Dec 2026`. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${MONTHS[month! - 1]} ${year}`
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
