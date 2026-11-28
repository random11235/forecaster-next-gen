import { readFileSync } from 'node:fs'
import { factoryConfig, type FactoryConfig } from '../factoryConfig.ts'

/**
 * The plain values of a workflow's top-level `env:`, factory.yml's unless named, as the scripts' steps get them:
 * `KEY: value`, quoted or not, its comment stripped. Those set by an expression, `${{ }}`, are left out.
 */
export function workflowEnv(file = 'factory.yml'): Record<string, string> {
  const workflow = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8')
  const block = /\nenv:\n((?: {2}[^\n]*\n|\s*#[^\n]*\n)*)/.exec(workflow)?.[1] ?? ''
  const entries = block.split('\n').flatMap((line) => {
    const entry = /^ {2}([A-Z_]+): (?:'([^']*)'|"([^"]*)"|([^#'"\s][^#]*?))\s*(?:#.*)?$/.exec(line)
    if (!entry) return []
    const value = entry[2] ?? entry[3] ?? entry[4] ?? ''
    return value.startsWith('${{') ? [] : [[entry[1] ?? '', value] as const]
  })
  return Object.fromEntries(entries)
}

/** The factory's config with the workflow's defaults, as every script reads it on GitHub's runners. */
export const DEFAULTS: FactoryConfig = factoryConfig(workflowEnv())
