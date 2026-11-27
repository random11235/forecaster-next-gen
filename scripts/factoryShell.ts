// How the factory's prompt goes on the agent's command line (scripts/factoryAgent.ts): as one shell word. Here, with no
// package imports, so scripts/factoryQuestion.ts can size a prompt in a step that has installed nothing.

/** Linux caps one argument, and so Sandcastle's whole `sh -c` command, at 128 KiB; this leaves room for the rest. */
export const MAX_PROMPT_BYTES = 100_000

/** `text` as one shell word, in single quotes. */
export const shellWord = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`
