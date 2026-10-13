// Durable-identity key derivation is owned by the data layer
// (specs/data/spec_database.md §Durable identity) — @vork/data is the one
// home; wakery re-exports for its existing import sites.
export { md5, makeTaskKey, makeStateKey, mintId } from '@vork/data';
