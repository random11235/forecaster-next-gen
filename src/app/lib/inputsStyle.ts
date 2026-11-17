/** The styles of the Inputs screen: its sections and fields, the setup steps' list and summary, and pace as typed or read: part of every page's stylesheet (`html.ts`). */
export const INPUTS_STYLE = `    /* Inputs: numbered sections, a label column beside the form. */
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
    /* The setup steps (#217): their list, the step shown marked; Back and Next beneath it; and, set up, the summary above the inputs. */
    ol.setup-steps { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 0 0 20px; padding: 0; list-style: none; counter-reset: step; font-size: 13px; color: var(--faint); }
    ol.setup-steps li { counter-increment: step; }
    ol.setup-steps li::before { content: counter(step) ". "; font-family: var(--mono); }
    ol.setup-steps li[aria-current="step"] { color: var(--ink); font-weight: 600; }
    ol.setup-steps li.done, ol.setup-steps li.done a { color: var(--muted); }
    .actions.setup-nav { gap: 12px; align-items: center; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--hairline); }
    .actions.setup-nav a.button:not(.primary) { margin-right: auto; font-size: 14px; color: var(--link); }
    .actions.setup-nav form { margin: 0; }
    .setup-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 24px; padding: 12px 16px; border: 1px solid var(--hairline); border-radius: 8px; font-size: 14px; }
    .setup-summary .read, .setup-summary .muted, .setup-summary .kind { font-size: 13px; color: var(--muted); }
    .setup-summary form { margin: 0 0 0 auto; }
    /* Set up: the tracker line, then the Milestone and Comparable rows, the leaf-and-epics line, and only problem flags. */
    .setup-summary .setup-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; flex-basis: 100%; }
    .setup-summary dl.setup-rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; flex-basis: 100%; }
    .setup-summary dt { color: var(--muted); }
    .setup-summary dd { margin: 0; overflow-wrap: anywhere; }
    .setup-summary code { font-family: var(--mono); font-size: 13px; }
    .setup-summary p.note { flex-basis: 100%; }
    .setup-summary .flag { flex-basis: 100%; color: var(--risk); }
    .setup-summary .setup-head form + form { margin: 0; }
    .setup-summary .flag form { display: inline; margin-left: 8px; }
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
    table.check { border-collapse: collapse; font-size: 14px; margin-bottom: 12px; }
    table.check th[scope=col] { padding: 0 18px 6px 0; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); border-bottom: 1px solid var(--ink); }
    table.check th[scope=row] { padding: 10px 18px 10px 0; text-align: left; font-weight: 500; }
    table.check td { padding: 10px 18px 10px 0; border-bottom: 1px solid var(--hairline); vertical-align: middle; font-variant-numeric: tabular-nums; }
    table.check th[scope=row] { border-bottom: 1px solid var(--hairline); }
    table.check .muted { font-size: 12px; }
    table.check .note.warn { margin: 0; font-size: 12px; }
    table.check form.source { display: flex; gap: 8px; align-items: center; }
    table.check fieldset.levels { gap: 0; flex-wrap: nowrap; }
    table.check fieldset.levels label { flex-direction: row; padding: 4px 12px; font-size: 13px; color: var(--text-2); border-radius: 0; }
    table.check fieldset.levels label:first-child { border-radius: 6px 0 0 6px; }
    table.check fieldset.levels label:last-child { border-radius: 0 6px 6px 0; margin-left: -1px; }
    table.check fieldset.levels input { position: absolute; opacity: 0; }
    .chooses-as-changed table.check .choose { display: none; }
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
    /* A typed value the tracker reads differently: a chip, dotted for an unopened read, opening on the reading and Follow. */
    details.reads-differently { position: relative; align-self: flex-start; display: inline-block; }
    details.reads-differently > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 2px 10px; border: 1px solid var(--hairline); border-radius: 999px; font-size: 12px; color: var(--muted); }
    details.reads-differently > summary::-webkit-details-marker { display: none; }
    details.reads-differently[open] > summary { border-color: var(--ink); color: var(--ink); }
    details.reads-differently .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--risk); }
    .reads-differently-panel { position: absolute; z-index: 5; top: calc(100% + 6px); left: 0; width: min(420px, 80vw); display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; background: var(--page); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); font-size: 13px; color: var(--ink); white-space: normal; }
    .reads-differently-panel p { margin: 0; }
    .reads-differently-panel .reading-line { margin: 0; font-size: 12px; color: var(--muted); }
    .reads-differently-panel .incomplete, .pace-following .incomplete { font-size: 12px; font-weight: 600; color: var(--risk); }
    .reads-differently-actions { display: flex; gap: 8px; }
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
    .pace-bars .bar.gap { height: 2px; background: var(--hairline); }
    .pace-bars .bar.gap .v { color: var(--muted); }
    .week-blocks .blocks .block { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; font-size: 11px; color: var(--muted); }
    .week-blocks .blocks .block.skipped { width: 56px; padding: 4px; border: 1px dashed var(--hairline); }
    .week-blocks .blocks .block.skipped s { font-family: var(--mono); font-size: 16px; color: var(--muted); }
    section.input form.skipped-line { display: block; }
    fieldset.levels .range { font-family: var(--mono); font-size: 13px; color: var(--muted); }
    table.growth { border-collapse: collapse; }
    table.growth th { padding: 0 24px 6px 0; text-align: left; font-size: 12px; font-weight: 500; color: var(--faint); }
    table.growth td { padding: 6px 24px 6px 0; }
    table.growth input[type=number] { width: 64px; text-align: center; }
    table.growth .to, table.growth .unit { padding: 0 8px; font-size: 13px; color: var(--muted); }
    .saves-as-changed section.input:not(.submits) .actions, .saves-as-changed section.input .counts { display: none; }
`
