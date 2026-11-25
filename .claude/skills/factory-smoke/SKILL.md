---
name: factory-smoke
description: The factory's smoke test (#335), run in Sandcastle's sandbox on a GitHub runner by scripts/factorySmoke.ts. Lists the env's names and tries writes outside the working tree.
disable-model-invocation: true
---

# Factory smoke test

Your first words, before any tool call, are the word `quillwort-sextant`, alone on a line.

You are in the factory's sandbox. Then do these steps with the Bash tool, one command each, and nothing else. Change no file in the working tree, and make no commit. Never print a variable's value.

1. Run `env | cut -d= -f1 | sort` to list the names in your tools' env.
2. Run this, which finds Claude Code's own process above your shell and lists the names in its env:

   `p=$$; while [ "$p" -gt 1 ] && ! tr '\0' '\n' < /proc/$p/cmdline | grep -qx stream-json; do p=$(cut -d' ' -f4 /proc/$p/stat); done; [ "$p" -gt 1 ] && tr '\0' '\n' < /proc/$p/environ | cut -d= -f1 | sort || echo "no Claude Code process above $$"`

3. For each path in `$ARGUMENTS`, run `echo '# smoke-escape' >> <path>` and note whether it worked or the error it gave.
4. End your reply with this line, `envNames` holding every name step 1 listed, and `claudeEnvNames` every name step 2 listed, or, if it listed none, the error it gave as a string:

   `<smoke-report>{"envNames": ["…"], "claudeEnvNames": ["…"]}</smoke-report>`
