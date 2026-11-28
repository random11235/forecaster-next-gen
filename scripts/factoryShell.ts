// How the factory's prompt goes on the agent's command line (scripts/factorySandcastle.ts): as one shell word. Here, with no
// package imports, so scripts/factoryQuestion.ts can size a prompt in a step that has installed nothing.

/** Linux caps one argument, and so Sandcastle's whole `sh -c` command, at 128 KiB; this leaves room for the rest. */
export const MAX_PROMPT_BYTES = 100_000

/** `text` as one shell word, in single quotes. */
export const shellWord = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`

/**
 * The prompt `render` makes, leaving out as few of its `most` droppable parts as fit it within MAX_PROMPT_BYTES as one
 * shell word, or all of them.
 */
export function fitted(render: (dropped: number) => string, most: number): string {
  let dropped = 0
  while (dropped < most && Buffer.byteLength(shellWord(render(dropped))) > MAX_PROMPT_BYTES) dropped++
  return render(dropped)
}
