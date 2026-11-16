// Formatting check: Prettier, through its API, on the content a commit holds rather than the file on disk.
// Honours .prettierrc.json and .prettierignore; a file type Prettier has no parser for is skipped.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, getFileInfo, resolveConfig } from 'prettier'

const root = fileURLToPath(new URL('..', import.meta.url))

export interface Contents {
  /** Relative to the repo root. */
  path: string
  content: string
}

/** The paths, among the files Prettier covers, whose content isn't formatted. */
export async function unformatted(files: Contents[]): Promise<string[]> {
  const results = await Promise.all(
    files.map(async ({ path, content }) => {
      const filepath = join(root, path)
      const { ignored, inferredParser } = await getFileInfo(filepath, { ignorePath: join(root, '.prettierignore') })
      if (ignored || inferredParser === null) return true
      return check(content, { ...(await resolveConfig(filepath)), filepath })
    }),
  )
  return files.filter((_, i) => !results[i]).map(({ path }) => path)
}
