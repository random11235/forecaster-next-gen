/**
 * Why a milestone query edited by hand is refused before it is read, in each tracker's language: free text, which
 * steers the EM to epics, labels and milestones (fix versions on Jira), and an empty qualifier, such as `label:`
 * (#136's defaults). Nothing else is checked: the query is read as written, so a mistyped qualifier the tracker
 * accepts goes unflagged, as it would in the tracker.
 */

/** Why GitHub search query `query` is refused, if it is: its first free-text term or empty qualifier. */
export function githubQueryRefusal(query: string): string | undefined {
  for (const term of githubTerms(query)) {
    if (term === '(' || term === ')' || GITHUB_KEYWORDS.has(term)) continue
    const qualifier = /^-?([A-Za-z][\w.-]*):(.*)$/s.exec(term)
    if (!qualifier) return `“${term}” is free text, which isn’t read. Pick tickets by epic, label or milestone, such as ${GITHUB_EXAMPLE}.`
    const [, name, value] = qualifier
    if (value === '' || value === '""') return `${name}: names nothing. Give it one, such as ${GITHUB_EXAMPLE}.`
  }
  return undefined
}

const GITHUB_KEYWORDS: ReadonlySet<string> = new Set(['OR', 'AND', 'NOT'])

const GITHUB_EXAMPLE = 'label:"checkout"'

/** A GitHub query's terms and brackets: a term runs to a space or bracket outside quotes, so `label:"a b"` is one. */
function githubTerms(query: string): string[] {
  const terms: string[] = []
  let term = ''
  let quoted = false
  const end = (): void => {
    if (term !== '') terms.push(term)
    term = ''
  }
  for (const char of query) {
    if (char === '"') quoted = !quoted
    if (!quoted && /\s/.test(char)) end()
    else if (!quoted && (char === '(' || char === ')')) {
      end()
      terms.push(char)
    } else term += char
  }
  end()
  return terms
}

/** Why JQL query `query` is refused, if it is: its first text search (`~`), or an operator given no value. */
export function jqlRefusal(query: string): string | undefined {
  const tokens = jqlTokens(query)
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at]!
    const operator = JQL_OPERATORS.has(token.toLowerCase()) ? token : undefined
    if (!operator) continue
    const negated = operator.toLowerCase() === 'in' && tokens[at - 1]?.toLowerCase() === 'not'
    const field = tokens[at - (negated ? 2 : 1)] ?? ''
    const said = `${field} ${negated ? `${tokens[at - 1]} ` : ''}${operator}`
    const value = tokens[at + 1]
    if (operator.endsWith('~')) {
      const clause = value === undefined ? said : `${said} ${value}`
      return `“${clause}” searches free text, which isn’t read. Pick tickets by fix version, epic or label, such as ${JQL_EXAMPLE}.`
    }
    const listed = value === '(' ? tokens[at + 2] : value
    if (listed === undefined || listed === ')' || listed === '""' || listed === "''" || JQL_KEYWORDS.has(listed.toLowerCase())) {
      return `${said} names nothing. Give it one, such as ${JQL_EXAMPLE}.`
    }
  }
  return undefined
}

const JQL_OPERATORS: ReadonlySet<string> = new Set(['=', '!=', '~', '!~', '>', '>=', '<', '<=', 'in', 'is'])

const JQL_KEYWORDS: ReadonlySet<string> = new Set(['and', 'or', 'order'])

const JQL_EXAMPLE = 'labels = "checkout"'

/** A JQL query's tokens: quoted strings whole, operators, brackets and commas, and words between them. */
function jqlTokens(query: string): string[] {
  return query.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|!=|!~|>=|<=|[=~<>(),]|[^\s"'=!~<>(),]+/g) ?? []
}
