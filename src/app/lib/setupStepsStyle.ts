/** The styles of the setup steps' own forms: Connect, the Milestone step's picker and query, comparable work and its candidates: part of every page's stylesheet (`html.ts`). */
export const SETUP_STEPS_STYLE = `    /* The Connect step: a tracker's fields show only while it is chosen. */
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

`
