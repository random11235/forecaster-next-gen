/** The styles of the Milestone forecast screen: its brief, Capacity's forms beside it, and its graphs: part of every page's stylesheet (`html.ts`). */
export const MILESTONE_FORECAST_STYLE = `    /* Milestone forecast: sections under an ink rule. */
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
    /* Paired with comparable work: comparable work's bars beside the milestone's own, as on the Comparable work step;
       the series pace isn't drawn from faint, and the periods before the milestone started hatched. */
    .pace-trend .trend-bars rect.own { fill: var(--ink); }
    .pace-trend .trend-bars rect.comparable:not(.in-use), .pace-trend .trend-bars rect.own:not(.in-use) { opacity: 0.35; }
    .pace-trend .trend-bars rect.before { fill: url(#pace-trend-before); stroke: var(--border); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .pace-trend pattern rect { fill: var(--border); }
    .pace-trend .legend { margin: 0; font-size: 12px; color: var(--muted); }
    .pace-trend .legend i { display: inline-block; width: 11px; height: 10px; vertical-align: middle; margin: 0 3px 0 8px; }
    .pace-trend .legend i:first-child { margin-left: 0; }
    .pace-trend .legend .comparable { background: var(--bar); }
    .pace-trend .legend .own { background: var(--ink); }
    .pace-trend .legend .before { background: repeating-linear-gradient(45deg, var(--border) 0 3px, transparent 3px 6px); box-shadow: inset 0 0 0 1px var(--border); }
    /* A plain caption, not a note: it says what the graph shows, with no verdict. */
    .pace-trend figcaption { font-size: 13px; line-height: 1.45; color: var(--text-2); }

`
