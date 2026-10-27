# Redesign 1b: "Weekly brief"

The visual direction for the app, from a Claude Design project made in October 2026. These are its boards, unpacked from the project's HTML export, kept here because standalone Claude Design closes on 14 Dec 2026.

Each board is a Claude Design `.dc.html` file: inline styles, with `<sc-for>` loops filled by the `DCLogic` script at the bottom. The `./support.js` runtime they load is not kept, so they don't render on their own; read them as source for the look (type, colours, spacing, layout).

| Board | Screen |
|---|---|
| `B-Sidebar` | Sidebar navigation, shared by every screen |
| `B1-Forecast` | Milestone forecast |
| `B7-Inputs` | Inputs |
| `B2`–`B6`, `B8` | Growth, Capacity, Track record, Roadmap, Gap history, Stakeholder roadmap |

## What the app takes from it

The look, not the scope. [`../frontend-essentials.md`](../frontend-essentials.md) still decides what each screen shows. The boards show sample data and features the app doesn't have yet (commit status, ambiguity, ageing tickets, gap history, track record, more than one milestone), and some the design doc rules out (the finish-week histogram, "What moved since", the roadmap and team-level screens). The app shows only the data it has, in 1b's style.

## Tokens

| Token | Value |
|---|---|
| Fonts | Geist (400–700), Geist Mono (400–600) |
| Page / ink | `#F7F5F0` / `#1C1B18` |
| Text, secondary / muted / faint | `#3F3C35` / `#5E5A52` / `#8C877C` |
| Hairline / border | `#E2DDD2` / `#D6D0C3` |
| Sidebar / active item | `#EFEBE3` / `#E4DFD4` |
| Link (teal) / hover | `#1F5F6B` / `#123F47` |
| At risk (rust) / good (green) | `#B5482A` / `#2F6B3F` |
