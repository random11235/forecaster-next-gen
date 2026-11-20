// The instant the forecast ledger stamps each log with, for the tests of the ledger (Seam B's, the Storage contract's
// and the migration's).

/** A UTC instant as the ledger stamps one, ISO 8601 to the millisecond, as `Date.toISOString` writes it. */
export const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
