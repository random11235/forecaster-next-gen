import type { Connection } from '../model/connection.js'
import { githubNamed, githubOrParts, githubQueryRefusal, jqlNamed, jqlOrParts, jqlRefusal } from './queryLanguage.js'

/** A tracker a team can connect to. */
export type Tracker = Connection['tracker']

/** The Connect step's form as typed, all but the token, which is never shown back. GitHub's repo is `owner/repo`. */
export interface ConnectionForm {
  tracker: Tracker
  repo: string
  site: string
  projectKey: string
  email: string
}

/** What the Forecaster knows of one tracker, for a connection to it (`C`): its name, its token, and its form. */
export interface TrackerFacts<C extends Connection = Connection> {
  /** As the screens name it. */
  name: string
  /** The read-only permission its token needs: what the EM is told to create. */
  permission: string
  /** The repo, or the Jira site and project, a connection reads, as the screens show it. */
  where(connection: C): string
  /** The connection the form names, tidied: no stray spaces, and as the tracker spells it. */
  connectionOf(form: ConnectionForm): C
  /** The form naming the connection, as the EM would type it. */
  formOf(connection: C): ConnectionForm
  /** What the connection lacks, worded for the Connect step; nothing when it has all it needs to be checked. */
  missing(connection: C): string | undefined
  /** Why the tracker refused the token, worded for the Connect step. */
  refused(connection: C): string
  /** Why the tracker can't find the repo or project, worded for the Connect step. */
  notFound(connection: C): string
  /** Why a milestone query edited by hand is refused before reading, worded for the Milestone step; nothing when it is read. */
  queryRefusal(query: string): string | undefined
  /**
   * The parts a milestone query joins with OR at its top level, outside quotes and brackets, as the tracker reads OR:
   * each as written, and repeated when the query repeats it. A query with no OR is one part.
   */
  orParts(query: string): string[]
  /** What a part that is one plain clause names, which its choice is searched for by: `payments` of a label's; none otherwise. */
  named(part: string): string | undefined
  /** Why a milestone query reaching outside the connection isn't read, worded for the Milestone step. */
  outOfScope(connection: C): string
}

const BLANK_FORM: Omit<ConnectionForm, 'tracker'> = { repo: '', site: '', projectKey: '', email: '' }

/** Each tracker's facts: the one place that tells GitHub and Jira apart outside their connectors and the data file. */
export const TRACKERS: { readonly [T in Tracker]: TrackerFacts<Extract<Connection, { tracker: T }>> } = {
  github: {
    name: 'GitHub',
    permission: 'Issues: read',
    where: ({ owner, repo }) => `${owner}/${repo}`,
    connectionOf: (form) => {
      const parts = form.repo.trim().split('/')
      // anything but owner/repo names no repo, so it is refused as missing
      const [owner = '', repo = ''] = parts.length === 2 ? parts : []
      return { tracker: 'github', owner, repo }
    },
    formOf: (connection) => ({ ...BLANK_FORM, tracker: 'github', repo: TRACKERS.github.where(connection) }),
    missing: ({ owner, repo }) => (owner && repo ? undefined : 'Give the repo as owner/repo, like shop-team/shop.'),
    refused: () => `GitHub refused the token. Check it hasn’t expired, and that it has ${TRACKERS.github.permission} on this repo.`,
    notFound: (connection) => `GitHub can’t see ${TRACKERS.github.where(connection)} with this token. Check the repo’s name, and that the token covers it.`,
    queryRefusal: githubQueryRefusal,
    orParts: githubOrParts,
    named: githubNamed,
    outOfScope: (connection) =>
      `This query reaches outside ${TRACKERS.github.where(connection)}, the connected repo. Take out what names another repo, owner or organisation.`,
  },
  jira: {
    name: 'Jira',
    permission: 'read:jira-work',
    where: ({ site, projectKey }) => `${site} · ${projectKey}`,
    // the site without its scheme or slash, the project key in capitals
    connectionOf: (form) => ({
      tracker: 'jira',
      site: form.site
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, ''),
      projectKey: form.projectKey.trim().toUpperCase(),
      email: form.email.trim(),
    }),
    formOf: ({ site, projectKey, email }) => ({ ...BLANK_FORM, tracker: 'jira', site, projectKey, email }),
    missing: ({ site, projectKey, email }) => {
      if (!site) return 'Give the Jira site, like your-team.atlassian.net.'
      if (!projectKey) return 'Give the Jira project key, like SHOP.'
      if (!email) return 'Give the email of the Atlassian account that made the token.'
      return undefined
    },
    refused: ({ email }) =>
      `Jira refused the token. Check it hasn’t expired, that it has ${TRACKERS.jira.permission}, and that ${email} is the account that made it.`,
    notFound: ({ site, projectKey }) =>
      `Jira can’t find project ${projectKey} on ${site} with this token. Check the site and the project key, and that the account can see it.`,
    queryRefusal: jqlRefusal,
    orParts: jqlOrParts,
    named: jqlNamed,
    outOfScope: ({ projectKey }) => `This query reaches outside project ${projectKey}, the connected Jira project. Take out what names another project.`,
  },
}

/** The facts of the tracker `connection` is to. */
export function trackerOf(connection: Connection): TrackerFacts {
  // TRACKERS is keyed so each tracker's facts take only its own connections, which `connection.tracker` picks out
  return TRACKERS[connection.tracker] as TrackerFacts
}

/** The connection the form names, tidied as its tracker spells it. */
export function connectionOf(form: ConnectionForm): Connection {
  return TRACKERS[form.tracker].connectionOf(form)
}

/** A blank form, on the first tracker offered. */
export const BLANK_CONNECTION_FORM: ConnectionForm = { ...BLANK_FORM, tracker: 'github' }
