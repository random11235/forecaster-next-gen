/**
 * Compiles only when `Missing` is `never`. Given the members a list of a union's values leaves out,
 * `Exclude<Union, (typeof LIST)[number]>`, it fails to compile while the list misses one.
 */
export type NoneMissing<Missing extends never> = Missing
