import { dayMonth } from '../forecast/calendarDate.js'
import { FONT_FACES } from './fonts.js'

/** The screens in the sidebar, by path. */
const SCREENS = [
  { path: '/', name: 'Milestone forecast' },
  { path: '/inputs', name: 'Inputs' },
  { path: '/how-it-works', name: 'How it works' },
] as const

export type ScreenPath = (typeof SCREENS)[number]['path']

/** The top of a screen: a context line, the headline and an optional lede. `heading` and `lede` are HTML. */
export interface PageHeader {
  context?: string | undefined
  heading: string
  lede?: string
}

/** The app's icon: a finish graph in small, its bars on the ink with the 85% marker, inline so no file is served. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1C1B18"/>' +
    '<g fill="#9DB6BB"><rect x="4" y="21" width="4.5" height="6"/><rect x="9" y="12" width="4.5" height="15"/>' +
    '<rect x="14" y="9" width="4.5" height="18"/><rect x="19" y="14" width="4.5" height="13"/><rect x="24" y="22" width="4.5" height="5"/></g>' +
    '<rect x="22.5" y="4" width="2" height="23" fill="#F7F5F0"/></svg>',
)}`

/**
 * A whole screen: the shared head and sidebar around `main`, in the 1b "Weekly brief" look
 * (`docs/design/redesign-1b/`). The browser tab shows the screen's name; `script`, if given, is inlined at the end.
 */
export function htmlPage(path: ScreenPath, header: PageHeader, main: string, script?: string): string {
  const title = SCREENS.find((screen) => screen.path === path)!.name
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
  </main>${script ? `\n  <script>${script}</script>` : ''}
</body>
</html>
`
}

const STYLE = `
    :root {
      --page: #F7F5F0; --ink: #1C1B18; --text-2: #3F3C35; --muted: #5E5A52; --faint: #8C877C;
      --hairline: #E2DDD2; --border: #D6D0C3; --sidebar: #EFEBE3; --active: #E4DFD4;
      --link: #1F5F6B; --link-hover: #123F47; --bar: #9DB6BB; --bar-light: #C9D8DA; --risk: #B5482A; --good: #2F6B3F;
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
    .past { color: var(--risk); }
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

    /* Milestone forecast: the forecast, with its pace and capacity beside it. */
    .forecast-layout { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 28px; align-items: start; }
    .forecast-main { display: flex; flex-direction: column; gap: 40px; min-width: 0; }
    .side { border-left: 1px solid var(--hairline); padding-left: 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .side > .heading { display: flex; justify-content: space-between; align-items: baseline; }
    .side h2 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .side > .heading a { font-size: 13px; }
    .lede .quiet { font-size: 14px; color: var(--faint); }
    table.compared { border-collapse: collapse; font-size: 14px; }
    table.compared th { padding: 0 20px 6px 0; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); }
    table.compared td { padding: 6px 20px 6px 0; border-top: 1px solid var(--hairline); font-variant-numeric: tabular-nums; }
    table.compared td.date { font-weight: 600; }
    table.compared .later { color: var(--risk); }
    table.compared .sooner { color: var(--good); }
    button.switch { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: inherit; cursor: pointer; min-height: 0; }
    button.switch::before { content: ''; flex: none; width: 28px; height: 16px; border-radius: 8px; background: radial-gradient(circle 6px at 8px 50%, var(--page) 98%, transparent 100%), var(--border); }
    button.switch[aria-checked="true"]::before { background: radial-gradient(circle 6px at 20px 50%, var(--page) 98%, transparent 100%), var(--good); }
    details.pace-pattern > summary { cursor: pointer; font-size: 13px; }
    details.pace-pattern > * + * { margin-top: 8px; }
    details.pace-pattern .date { font-weight: 600; font-variant-numeric: tabular-nums; }
    details.pace-pattern form, form.pace-applied { margin: 0; }
    p.pace-pattern.quiet { margin: 0; font-size: 13px; color: var(--faint); }
    details.capacity { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--hairline); padding-top: 10px; }
    details.capacity > summary { cursor: pointer; font-size: 13px; }
    details.capacity > * + * { margin-top: 10px; }
    details.capacity .title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    details.capacity .summary, details.capacity .why, details.capacity .effect { color: var(--faint); }
    details.capacity .effect { font-size: 12px; white-space: nowrap; }
    details.capacity .effect.later { color: var(--risk); }
    details.capacity .effect.sooner { color: var(--good); }
    ul.capacity-entries { list-style: none; margin: 0; padding: 0; }
    ul.capacity-entries li {
      display: flex; flex-wrap: wrap; gap: 4px 8px; justify-content: space-between; align-items: baseline;
      border-bottom: 1px solid var(--hairline); padding: 4px 0; font-size: 14px;
    }
    ul.capacity-entries li > span { flex: 1 1 0; min-width: 0; }
    ul.capacity-entries form { margin: 0; }
    ul.capacity-entries p.warning { flex-basis: 100%; font-size: 13px; }
    ul.capacity-entries p.note, ul.capacity-entries .proposal { flex-basis: 100%; font-size: 13px; }
    ul.capacity-entries p.note form { display: inline; }
    ul.capacity-entries .proposal { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; border-left: 3px solid var(--link); padding: 4px 0 4px 10px; }
    ul.capacity-entries .proposal p { flex-basis: 100%; margin: 0; }
    details.edit > summary { list-style: none; cursor: pointer; color: var(--link); text-decoration: underline; font-size: 13px; }
    details.edit > summary::-webkit-details-marker { display: none; }
    details.edit[open] { flex-basis: 100%; order: 1; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
    details.edit[open] > summary { display: none; }
    details.edit .actions { display: flex; gap: 12px; align-items: baseline; }
    details.edit .actions a { font-size: 13px; }
    details.capacity-past > summary { cursor: pointer; font-size: 13px; color: var(--muted); }
    form.sentence { margin: 0; font-size: 14px; line-height: 2.2; }
    form.sentence input[type=number], form.sentence input[type=date], form.sentence input[type=text] { font-size: 13px; padding: 2px 0; }
    form.sentence input[type=number] { width: 56px; text-align: center; }
    form.sentence input[type=text] { width: 140px; }
    form.sentence label { white-space: nowrap; }
    form.sentence p.error { font-size: 13px; line-height: 1.5; }
    button.link { min-height: 0; padding: 0; border: 0; background: none; color: var(--link); text-decoration: underline; font-size: 13px; }

    /* Milestone forecast: the finish graph. Markers stand on rows above the bars and run down through them. */
    figure.finish-graph { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .finish-graph .plot { position: relative; padding-top: 92px; }
    .finish-graph .bars { height: 160px; display: flex; align-items: flex-end; border-bottom: 1px solid var(--ink); }
    .finish-graph .bar { position: relative; flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; padding: 0 1px; min-width: 0; }
    .finish-graph .fill { width: 100%; background: var(--bar); border-radius: 2px 2px 0 0; }
    .finish-graph .bar.changed { background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(181, 72, 42, 0.14) 4px 7px); }
    .finish-graph .bar .capacity { position: absolute; top: 2px; left: 0; right: 0; text-align: center; font-family: var(--mono); font-size: 10px; font-weight: 600; color: var(--risk); }
    .finish-graph .bar:hover .fill, .finish-graph .bar:focus-visible .fill { background: var(--ink); }
    .finish-graph .bar:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
    /* A bar's hover text: hidden by opacity, not display, so a screen reader still reads it with the bar. Bars near
       either edge open it inwards. */
    .finish-graph .tip {
      position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); z-index: 1;
      width: max-content; max-width: min(640px, calc(100vw - 32px)); font-size: 12px; line-height: 16px; color: var(--ink); background: var(--page);
      border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; opacity: 0; pointer-events: none;
    }
    .finish-graph .bar.start .tip { left: 0; transform: none; }
    .finish-graph .bar.end .tip { left: auto; right: 0; transform: none; }
    .finish-graph .bar:hover .tip, .finish-graph .bar:focus-visible .tip { opacity: 1; }
    .finish-graph .marker { position: absolute; bottom: 0; border-left: 1px dashed var(--faint); }
    .finish-graph .marker.headline { border-left: 2px solid var(--ink); }
    .finish-graph .mark { position: absolute; top: 0; left: 6px; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--muted); }
    .finish-graph .marker.end .mark { left: auto; right: 6px; }
    .finish-graph .mark .date { font-family: var(--mono); }
    .finish-graph .mark.headline { color: var(--ink); font-weight: 600; }
    .finish-graph .axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px; color: var(--muted); }

    /* The pace trend: the typed counts as small bars, and the straight line fitted through them. */
    figure.pace-trend { margin: 0; display: flex; flex-direction: column; gap: 6px; max-width: 320px; }
    .pace-trend svg { width: 100%; overflow: visible; border-bottom: 1px solid var(--ink); }
    .pace-trend .trend-bars rect { fill: var(--bar); }
    .pace-trend .trend-line line { stroke: var(--ink); stroke-width: 2px; vector-effect: non-scaling-stroke; stroke-linecap: round; }
    /* A plain caption, not a note: it says what the graph shows, with no verdict. */
    .pace-trend figcaption { font-size: 13px; line-height: 1.45; color: var(--text-2); }

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
    button.primary, a.button.primary { min-height: 42px; padding: 0 20px; border: 0; background: var(--ink); color: var(--page); font-size: 14px; font-weight: 600; }
    a.button.primary { display: inline-flex; align-items: center; border-radius: 6px; text-decoration: none; }
    .actions.onward { gap: 16px; align-items: center; margin-top: 16px; }
    .actions.onward form { margin: 0; }
    .pace { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; }
    .pace label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
    .pace input[type=number] { font-size: 32px; width: 72px; text-align: center; padding: 2px 0; }
    .pace .to { font-size: 24px; color: var(--faint); padding-bottom: 6px; }
    .pace .unit { color: var(--text-2); padding-bottom: 10px; }
    fieldset.levels { margin: 0; padding: 0; border: 0; display: flex; flex-wrap: wrap; gap: 12px; }
    fieldset.levels label {
      display: flex; align-items: baseline; gap: 8px; padding: 10px 14px; cursor: pointer;
      border: 1px solid var(--border); border-radius: 6px; font-size: 15px;
    }
    fieldset.levels label:has(input:checked) { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    section.input h3 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .counts { display: flex; align-items: end; gap: 12px; }
    .counts .fields { flex-wrap: nowrap; }
    .counts button { white-space: nowrap; }
    .tickets-source { flex: 1 1 200px; display: flex; flex-direction: column; gap: 6px; }
    .tickets-source fieldset.levels { gap: 0; align-self: flex-start; flex-wrap: nowrap; }
    .tickets-source fieldset.levels label { flex: 0 0 auto; flex-direction: row; padding: 4px 12px; font-size: 13px; color: var(--text-2); border-radius: 0; }
    .tickets-source > label { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
    .tickets-source fieldset.levels label:first-child { border-radius: 6px 0 0 6px; }
    .tickets-source fieldset.levels label:last-child { border-radius: 0 6px 6px 0; margin-left: -1px; }
    .tickets-source fieldset.levels input { position: absolute; opacity: 0; }
    .tickets-source .reading { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
    .tickets-source .reading-value { font-size: 32px; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .tickets-source .reading-line { flex-basis: 100%; font-size: 12px; color: var(--muted); }
    .tickets-source .incomplete { font-size: 12px; font-weight: 600; color: var(--risk); }
    /* Pace following the tracker: its counts as bars, a quiet period a red stub, its periods behind Show weeks. */
    .pace-following { display: flex; flex-direction: column; gap: 6px; }
    .pace-following .reading-line { margin: 0; font-size: 12px; color: var(--muted); }
    /* The value the latest read replaced, faint beneath a value following the tracker. */
    .tickets-source .reading-line.was, .pace-following .reading-line.was { color: var(--faint); }
    .pace-bars { display: flex; align-items: flex-end; gap: 4px; height: 64px; max-width: 320px; padding-top: 16px; border-bottom: 1px solid var(--ink); }
    .pace-bars .bar { position: relative; flex: 1 1 0; min-width: 0; background: var(--bar); }
    .pace-bars .bar.zero { height: 2px; background: var(--risk); }
    .pace-bars .v { position: absolute; bottom: 100%; left: 0; right: 0; text-align: center; font-family: var(--mono); font-size: 10px; color: var(--text-2); }
    .pace-bars .bar.zero .v { color: var(--risk); }
    .week-blocks summary { cursor: pointer; font-size: 13px; color: var(--link); }
    .week-blocks form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .week-blocks .hint { margin: 0; font-size: 12px; color: var(--muted); }
    .week-blocks .blocks { display: flex; flex-wrap: wrap; gap: 6px; }
    .week-blocks .blocks label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); }
    .week-blocks .blocks input { width: 56px; text-align: center; }
    fieldset.levels .range { font-family: var(--mono); font-size: 13px; color: var(--muted); }
    table.growth { border-collapse: collapse; }
    table.growth th { padding: 0 24px 6px 0; text-align: left; font-size: 12px; font-weight: 500; color: var(--faint); }
    table.growth td { padding: 6px 24px 6px 0; }
    table.growth input[type=number] { width: 64px; text-align: center; }
    table.growth .to, table.growth .unit { padding: 0 8px; font-size: 13px; color: var(--muted); }
    .saves-as-changed section.input:not(.submits) .actions, .saves-as-changed section.input .counts { display: none; }
    /* The Connect step: a tracker's fields show only while it is chosen. */
    form.connect:has(input[name=tracker][value=github]:checked) .fields.jira,
    form.connect:has(input[name=tracker][value=jira]:checked) .fields.github { display: none; }
    input[type=password], input[type=email] {
      font-size: 15px; color: var(--ink); background: transparent;
      border: 0; border-bottom: 1px solid var(--ink); border-radius: 0; padding: 6px 0;
    }
    input[type=password] { font-family: var(--mono); }
    form.connect .actions { gap: 16px; align-items: center; }
    form.connect .skip { margin-right: auto; font-size: 13px; }
    .connection { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 15px; }
    .connection b { font-family: var(--mono); font-weight: 500; }
    .connection form { display: inline; }
    .ok-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); display: inline-block; }
    button.linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; font-size: 13px; }
    /* The Milestone step: chips for the picks, a find box over the lists of choices, the query and its read. */
    .picker { display: flex; flex-direction: column; gap: 12px; max-width: 620px; }
    .picker form { margin: 0; }
    ul.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; background: #fff; }
    .chip form { display: inline; }
    .chip button.x { border: 0; background: none; min-height: 0; padding: 0 6px; font-size: 15px; line-height: 1; color: var(--muted); cursor: pointer; }
    .picker .kind { font-family: var(--mono); font-size: 11px; color: var(--faint); }
    .picker input[type=search] {
      width: 100%; font-size: 15px; color: var(--ink); background: transparent;
      border: 0; border-bottom: 1px solid var(--ink); border-radius: 0; padding: 6px 0;
    }
    .found { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
    .found h3 { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .found button { display: block; width: 100%; text-align: left; border: 0; background: none; min-height: 30px; font-size: 14px; padding: 0 8px; border-radius: 4px; cursor: pointer; }
    .found button:hover { background: var(--active); }
    .picker .query { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--hairline); padding-top: 12px; }
    .picker .query .label { font-size: 12px; font-weight: 600; color: var(--muted); }
    .picker .query code { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
    .picker .query .none { color: var(--faint); }
    .picker p.read { margin: 0; color: var(--good); font-weight: 600; }
    .picker .query a.edit { margin-left: 8px; font-weight: 400; font-size: 13px; color: var(--link); }
    /* The query open for editing: read on Enter, and Back to finding, with its warning when it clears the query, and asking to confirm that. */
    .picker.editing .query { border-top: 0; padding-top: 0; }
    .picker.editing .query b { font-family: var(--mono); font-weight: 500; }
    .picker input[type=text] {
      width: 100%; font-family: var(--mono); font-size: 14px; color: var(--ink); background: transparent;
      border: 0; border-bottom: 1px solid var(--ink); border-radius: 0; padding: 6px 0;
    }
    .picker p.error { margin: 0; font-size: 13px; color: var(--risk); }
    .picker code { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
    .picker form.back { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; border-top: 1px solid var(--hairline); padding-top: 12px; }
    .picker .warn { margin: 0; color: var(--risk); }
    .picker form.back a.keep { font-size: 13px; color: var(--link); }
    /* The Comparable work step's pace: the pace in use, how far from the milestone's own, and the two paired per period. */
    .step-pace { display: flex; flex-direction: column; gap: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--hairline); }
    .step-pace p { margin: 0; }
    .step-pace .headline { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .step-pace .headline small { font-size: 14px; font-weight: 400; color: var(--muted); }
    .step-pace .delta { font-size: 15px; color: var(--muted); }
    .step-pace .delta.faster { color: var(--good); }
    .step-pace .delta.slower { color: var(--risk); }
    .step-pace .delta.aboutTheSame { color: var(--ink); }
    ol.pairs { list-style: none; margin: 8px 0 0; padding: 0; display: flex; gap: 12px; align-items: flex-end; height: 100px; }
    ol.pairs .period { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; height: 100%; font-family: var(--mono); font-size: 10px; color: var(--muted); }
    ol.pairs .two { display: flex; gap: 2px; align-items: flex-end; }
    ol.pairs i, .step-pace .legend i { display: block; width: 11px; }
    .step-pace .comparable, .chip .strip i { background: var(--bar); }
    .step-pace .own { background: var(--ink); }
    .step-pace i.before { background: repeating-linear-gradient(45deg, var(--border) 0 3px, transparent 3px 6px); box-shadow: inset 0 0 0 1px var(--border); }
    .step-pace .legend { font-size: 12px; color: var(--muted); }
    .step-pace .legend i { display: inline-block; height: 10px; vertical-align: middle; margin: 0 3px 0 8px; }
    .step-pace .legend i:first-child { margin-left: 0; }
    .chip .strip { display: inline-flex; align-items: flex-end; gap: 1px; height: 12px; }
    .chip .strip i { display: block; width: 3px; }
    /* Candidates for comparable work (#205): a pace link beside each choice, and those read, grouped against the milestone's own. */
    .found form.candidate { flex-direction: row; align-items: center; gap: 8px; }
    .found form.candidate button { flex: 1; }
    .found a.open { font-size: 12px; color: var(--link); padding: 0 8px; }
    .candidates { display: flex; flex-direction: column; gap: 8px; max-width: 620px; margin-top: 16px; border-top: 1px solid var(--hairline); padding-top: 12px; }
    .candidates h3 { margin: 0; }
    .candidates .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px 20px; }
    .candidates h4 { margin: 4px 0; font-size: 13px; font-weight: 600; }
    .candidates .slower h4, .candidates span.slower { color: var(--risk); }
    .candidates .faster h4, .candidates span.faster { color: var(--good); }
    .candidates span.same { color: var(--muted); }
    .candidates ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .candidates li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13px; }
    .candidates li form { margin: 0; display: inline; }
    .candidates li button { border: 0; background: none; min-height: 0; padding: 0; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left; }
    .candidates li button:hover { text-decoration: underline; }
    .candidates .kind { font-family: var(--mono); font-size: 11px; color: var(--faint); font-weight: 400; }
    .candidates .strip { display: inline-flex; align-items: flex-end; gap: 1px; height: 14px; border-bottom: 1px solid var(--border); }
    .candidates .strip i { display: block; width: 4px; min-height: 1px; background: var(--bar); }
    .candidates .pace { font-family: var(--mono); font-size: 12px; }
    .candidates .this, .kind-list .this { font-size: 11px; color: var(--link); border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; }
    .candidates p.facts { flex-basis: 100%; margin: 0; font-size: 12px; color: var(--muted); }
    .candidates p.error { flex-basis: 100%; margin: 0; font-size: 12px; color: var(--risk); font-weight: 400; }
    details.change > summary { cursor: pointer; font-size: 13px; color: var(--link); }
    details.change[open] > summary { margin-bottom: 16px; }
    section.input > .label p.saved { color: var(--good); font-weight: 600; }
    section.input > .label p.error { font-size: 13px; color: var(--risk); }

    /* How it works: three numbered parts, each a row of small pictures with a line under each. */
    section.explain { display: flex; flex-direction: column; gap: 20px; }
    .explain > .heading { display: flex; gap: 12px; align-items: baseline; border-bottom: 1px solid var(--ink); padding-bottom: 8px; }
    .explain .number { font-family: var(--mono); font-size: 12px; color: var(--faint); }
    .explain h2 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
    .explain .say { margin: 0; font-size: 22px; line-height: 1.3; font-weight: 600; letter-spacing: -0.015em; max-width: 720px; text-wrap: balance; }
    .explain figure { margin: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .explain svg { width: 100%; height: auto; display: block; overflow: visible; }
    .explain figcaption { font-size: 13px; line-height: 1.45; color: var(--muted); }
    .explain figcaption b { color: var(--ink); font-weight: 600; }
    .explain .step { font-family: var(--mono); font-size: 12px; color: var(--faint); }
    .explain svg text { font-family: var(--mono); font-size: 11px; fill: var(--muted); }
    .explain svg text.ink, .explain svg text.strong { fill: var(--ink); }
    .explain svg text.strong { font-weight: 600; }
    .explain svg text.risk { fill: var(--risk); }
    .explain svg .bar { fill: var(--bar); }
    .explain svg .bar.light { fill: var(--bar-light); }
    .explain svg .bar.dark, .explain svg .dot { fill: var(--ink); }
    .explain svg .grid { stroke: var(--hairline); }
    .explain svg .axis { stroke: var(--ink); }
    .explain svg .burn { stroke: var(--risk); stroke-width: 2; }
    .explain svg .marker { stroke: var(--ink); stroke-dasharray: 3 3; }
    .explain svg .marker.headline { stroke-width: 2; stroke-dasharray: none; }
    .pictures { display: grid; gap: 28px 32px; }
    .pictures.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .pictures.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .problem { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 32px; align-items: start; }
    ul.points { list-style: none; margin: 0; padding: 0; }
    ul.points li { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--hairline); font-size: 15px; line-height: 1.4; }
    ul.points .mark { font-family: var(--mono); color: var(--risk); font-weight: 600; min-width: 2.2em; }
    ul.points .mark.good { color: var(--good); }
    .tip { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 20px; align-items: center; padding-top: 16px; border-top: 1px solid var(--hairline); }
    .tip h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
    .tip p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--muted); }
    @media (max-width: 900px) {
      .pictures.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .problem { grid-template-columns: minmax(0, 1fr); }
      .forecast-layout { grid-template-columns: minmax(0, 1fr); }
      .side { border-left: 0; padding-left: 0; border-top: 1px solid var(--ink); padding-top: 12px; }
    }

    @media (max-width: 760px) {
      body { grid-template-columns: minmax(0, 1fr); }
      nav { flex-direction: row; align-items: center; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--hairline); }
      nav .links { flex-direction: row; }
      main { padding: 28px 16px 48px; }
      h1 { font-size: 30px; }
      section.input { grid-template-columns: minmax(0, 1fr); gap: 16px; }
      .pictures.two { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 480px) {
      .pictures.four { grid-template-columns: minmax(0, 1fr); }
      .pictures.four svg { max-width: 280px; }
      .tip { grid-template-columns: 100px minmax(0, 1fr); }
    }
  `

/** `2026-12-18` → `18 Dec 2026`. */
export function formatDate(isoDate: string): string {
  return `${dayMonth(isoDate)} ${isoDate.slice(0, 4)}`
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
