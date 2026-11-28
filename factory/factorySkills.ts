// Whether the runner's checkout has every skill a build's agent needs, for the `build` job of
// .github/workflows/factory.yml, before the agent runs: the config's REQUIRED_SKILLS (factory/factoryConfig.ts), each
// installed by .husky/post-checkout, which never fails, so this checks. It fails naming each skill missing.

import { factoryConfig } from './factoryConfig.ts'
import { missingSkills } from './factoryTree.ts'

const missing = missingSkills(process.cwd(), factoryConfig().requiredSkills)
for (const skill of missing) console.log(`::error::the ${skill} skill isn't installed`)
if (missing.length > 0) process.exit(1)
