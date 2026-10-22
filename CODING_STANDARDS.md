# Coding standards

- **String values** in union types are camelCase, like the TypeScript identifiers around them: `'howMany'`, `'bayesianBootstrap'`. They are stored and shown, so renaming one later breaks saved data. Known exceptions, still to be renamed: `'not_started'`, `'user_marked'` (#49).
