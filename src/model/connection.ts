/**
 * The team's connection: the one tracker its tickets are read from, and the one repo or Jira project in it
 * (ADR 0003). A team has at most one. Jira's carries the account email the token was made by, which Jira needs beside
 * the token; the token itself is never part of a connection, so nothing that stores one holds it.
 */
export type Connection =
  | { tracker: 'github'; owner: string; repo: string }
  | { tracker: 'jira'; site: string; projectKey: string; email: string }
