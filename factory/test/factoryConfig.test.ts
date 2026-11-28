import { expect, test } from 'vitest'
import { factoryConfig } from '../factoryConfig.ts'
import { workflowEnv } from './workflowConfig.ts'

test('the config fails on a value the workflow left unset, naming it', () => {
  const { CHECK_COMMAND: _, ...env } = workflowEnv()

  expect(() => factoryConfig(env)).toThrow('CHECK_COMMAND is not set')
})
