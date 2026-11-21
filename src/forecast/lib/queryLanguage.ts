/**
 * Each tracker's query language, as the Milestone step reads a milestone query edited by hand: each tracker's through
 * its one scanner (`githubTerms`, `jqlTokens`). This module changes only when how a query is read here does.
 *
 * It reads two things. Why a query is refused before it is read: free text, which steers the EM to epics, labels and
 * milestones (fix versions on Jira), and an empty qualifier, such as `label:` (#136's defaults). Nothing else is
 * checked: the query is read as written, so a mistyped qualifier the tracker accepts goes unflagged, as it would in
 * the tracker. And the parts it joins with OR, and what each names, by which the picker finds the choices a query is
 * an OR of; a choice's query is built by its connector, and only read back here.
 */

/** A piece of a query as its scanner finds it, and where in the query it starts. */
interface Piece {
  text: string
  at: number
}

/**
 * The parts of `query` that `pieces` join at its top level, outside brackets, with a piece that `isOr`; each as
 * written, but trimmed, and repeated when the query repeats it. A query with no such piece is one part.
 */
function orParts(query: string, pieces: Piece[], isOr: (piece: string) => boolean): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (const { text, at } of pieces) {
    if (text === '(') depth += 1
    else if (text === ')') depth -= 1
    else if (depth === 0 && isOr(text)) {
      parts.push(query.slice(start, at).trim())
      start = at + text.length
    }
  }
  parts.push(query.slice(start).trim())
  return parts
}

/** A value without the double quotes around it, if it has them, and their escapes. */
function unquoted(value: string): string {
  return /^".*"$/s.test(value) ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value
}

/** The parts a GitHub search query joins with `OR`, which search reads only in capitals: `label:"a" OR milestone:"b"` has two. */
export function githubOrParts(query: string): string[] {
  return orParts(query, githubTerms(query), (term) => term === 'OR')
}

/** What a GitHub query that is one qualifier names: `payments` of `label:"payments"`. None for anything else. */
export function githubNamed(query: string): string | undefined {
  const terms = githubTerms(query)
  const qualifier = terms.length === 1 ? GITHUB_QUALIFIER.exec(terms[0]!.text) : null
  return qualifier ? unquoted(qualifier[2]!) : undefined
}

/** The parts a JQL query joins with `OR`, in any case, or `||`: `labels = "a" or fixVersion = "b"` has two. */
export function jqlOrParts(query: string): string[] {
  return orParts(query, jqlTokens(query), (token) => token.toLowerCase() === 'or' || token === '||')
}

/** What a JQL query that is one `field = value` clause names: `payments` of `labels = "payments"`. None for anything else. */
export function jqlNamed(query: string): string | undefined {
  const tokens = jqlTokens(query).map(({ text }) => text)
  return tokens.length === 3 && tokens[1] === '=' ? unquoted(tokens[2]!) : undefined
}

/** Why GitHub search query `query` is refused, if it is: its first free-text term or empty qualifier. */
export function githubQueryRefusal(query: string): string | undefined {
  for (const { text: term } of githubTerms(query)) {
    if (term === '(' || term === ')' || GITHUB_KEYWORDS.has(term)) continue
    const qualifier = GITHUB_QUALIFIER.exec(term)
    if (!qualifier) return `“${term}” is free text, which isn’t read. Pick tickets by epic, label or milestone, such as ${GITHUB_EXAMPLE}.`
    const [, name, value] = qualifier
    if (value === '' || value === '""') return `${name}: names nothing. Give it one, such as ${GITHUB_EXAMPLE}.`
  }
  return undefined
}

/** A qualifier, negated or not: its name and its value. */
const GITHUB_QUALIFIER = /^-?([A-Za-z][\w.-]*):(.*)$/s

const GITHUB_KEYWORDS: ReadonlySet<string> = new Set(['OR', 'AND', 'NOT'])

const GITHUB_EXAMPLE = 'label:"checkout"'

/** A GitHub query's terms and brackets: a term runs to a space or bracket outside quotes, so `label:"a b"` is one. */
function githubTerms(query: string): Piece[] {
  const terms: Piece[] = []
  let term = ''
  let quoted = false
  const end = (before: number): void => {
    if (term !== '') terms.push({ text: term, at: before - term.length })
    term = ''
  }
  for (let at = 0; at < query.length; at += 1) {
    const char = query[at]!
    if (char === '"') quoted = !quoted
    if (!quoted && /\s/.test(char)) end(at)
    else if (!quoted && (char === '(' || char === ')')) {
      end(at)
      terms.push({ text: char, at })
    } else term += char
  }
  end(query.length)
  return terms
}

/** Why JQL query `query` is refused, if it is: its first text search (`~`), or an operator given no value. */
export function jqlRefusal(query: string): string | undefined {
  const tokens = jqlTokens(query).map(({ text }) => text)
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
function jqlTokens(query: string): Piece[] {
  const tokens = query.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|!=|!~|>=|<=|[=~<>(),]|[^\s"'=!~<>(),]+/g)
  return [...tokens].map((token) => ({ text: token[0], at: token.index }))
}
