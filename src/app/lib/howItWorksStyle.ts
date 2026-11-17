/** The styles of the How it works screen: its explanations, pictures and tips: part of every page's stylesheet (`html.ts`). */
export const HOW_IT_WORKS_STYLE = `    /* How it works: three numbered parts, each a row of small pictures with a line under each. */
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
