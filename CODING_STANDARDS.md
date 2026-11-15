# Coding standards

- **String values** in union types are camelCase, like the TypeScript identifiers around them: `'howMany'`, `'bayesianBootstrap'`. They are stored and shown, so renaming one later breaks saved data.
- **Module depth**: judge each new or changed module with the `/codebase-design` skill's vocabulary (deep and shallow modules, seams, leverage). Flag a shallow module whose interface is nearly as large as what it hides, and logic split across modules that change together.
- **Wrappers inside**: a decorator, guard or overlay that every caller must remember to apply is applied once, inside the module that owns the behaviour. One missed call site is a silent bug.
- **Test layers**: each test file in the diff tests at the seam `docs/design/architecture.md` (Test seams) assigns it. Flag behaviour tested only at an outer layer, cases repeated across layers, and tests that import a module's internals instead of its entry point.
- **One-way doors**: stored shapes (schema steps, stored string values, persisted JSON) outlive the branch. Flag implicit state inferred from what happens to be stored, unvalidated blobs, and backfills that leave existing data in a state the new code misreads.
