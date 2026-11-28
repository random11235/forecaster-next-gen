---
name: factory-smoke
description: The factory's smoke test (#335), run in Sandcastle's sandbox on a GitHub runner by factory/factorySmoke.ts. Says a word before any tool call, which shows the slash command expanded; lists the names in its tools' env and in Claude Code's own; and tries writes outside the working tree.
disable-model-invocation: true
---

# Factory smoke test

Your first words, before any tool call, are the word `quillwort-sextant`, alone on a line.

You are in the factory's sandbox. Then do these steps with the Bash tool, one command each, and nothing else. Change no file in the working tree, and make no commit. Never print a variable's value.

1. Run `env -0 | cut -z -d= -f1 | tr '\0' '\n' | sort` to list the names in your tools' env.
2. Run this, which finds Claude Code's own process above your shell and lists the names in its env, or the error reading it gave:

   `p=$$; while [ "$p" -gt 1 ] && ! tr '\0' '\n' < /proc/$p/cmdline | grep -qx stream-json; do p=$(sed 's/.*) //' /proc/$p/stat | cut -d' ' -f2); done; if [ "$p" -gt 1 ]; then (set -o pipefail; cut -z -d= -f1 /proc/$p/environ | tr '\0' '\n' | sort); else echo "no Claude Code process above $$"; fi`

3. For each path in `$ARGUMENTS`, run `echo '# smoke-escape' >> <path>` and note whether it worked or the error it gave.
4. End your reply with this line. `envNames` holds every name step 1 listed. `claudeEnvNames` holds every name step 2 listed, or, if it listed none, the error it gave as a string. `writes` maps each path from step 3 to `"ok"` if the write worked, or else the error it gave:

   `<smoke-report>{"envNames": ["…"], "claudeEnvNames": ["…"], "writes": {"<path>": "ok"}}</smoke-report>`
