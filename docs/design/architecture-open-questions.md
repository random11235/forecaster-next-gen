# Architecture: Open questions

Part of the architecture design; the index is [`architecture.md`](architecture.md).

- **Minimum growth samples** before measured samples are suggested: start at 7 (Magennis), then test against the ledger.
- **Default ambiguity ranges** (low 1–1.5×, medium 1–2×, high 1.5–3×): check against the ledger once milestones finish.
- **Default epic-size range** for epics with no children before enough `EpicSizeSample`s exist.
