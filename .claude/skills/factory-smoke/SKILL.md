---
name: factory-smoke
description: The factory's smoke test (#335), run in Sandcastle's sandbox on a GitHub runner by scripts/factorySmoke.ts. Lists the env's names and tries writes outside the working tree.
disable-model-invocation: true
---

# Factory smoke test

You are in the factory's sandbox. Do these steps with the Bash tool, one command each, and nothing else. Change no file in the working tree, and make no commit.

1. Run `env | cut -d= -f1 | sort` to list the environment's variable names. Never print a value.
2. For each path in `$ARGUMENTS`, run `echo escape > <path>` and note whether it worked or the error it gave.
3. End your reply with this line, `envNames` holding every name step 1 listed, and `skillWord` set to `marmalade-heron`:

   `<smoke-report>{"skillWord": "marmalade-heron", "envNames": ["…"]}</smoke-report>`
