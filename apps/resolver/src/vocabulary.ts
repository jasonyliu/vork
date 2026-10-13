// Primitive-component vocabulary, pinned from `docs/policy/SECURITY.md §Classification`.
//
// Per house policy, apps never read spec/doc content at runtime — the canonical
// Action / Subject / Zone primitives are the source of truth in SECURITY.md, and
// this module is their code-pinned mirror. When SECURITY.md §Actions / §Subjects
// / §Zones change, update these sets in the same change.
//
// All values are lowercase and case-sensitive: an input component is valid iff it
// is an exact member of the corresponding set.

// §Actions — Observe, Ingress, Modify, Destruct, Execute, Egress classes flattened
// to their primitives.
export const ACTIONS: ReadonlySet<string> = new Set([
  // Observe
  'search', 'query', 'enumerate', 'inspect', 'read',
  // Ingress
  'receive', 'fetch', 'pull',
  // Modify
  'create', 'append', 'update', 'move', 'arrange',
  // Destruct
  'delete', 'truncate', 'revoke',
  // Execute
  'invoke', 'interpret', 'control',
  // Egress
  'send', 'submit', 'push', 'publish'
]);

// §Subjects — Data, Control, Interface, Content, Infrastructure classes flattened.
export const SUBJECTS: ReadonlySet<string> = new Set([
  // Data
  'file', 'record', 'store', 'repository',
  // Control
  'config', 'policy', 'credential', 'permission', 'identity',
  // Interface
  'endpoint', 'surface', 'service', 'job',
  // Content
  'message', 'publication',
  // Infrastructure
  'host', 'device', 'network'
]);

// §Zones — flat set.
export const ZONES: ReadonlySet<string> = new Set([
  'workspace', 'local', 'internal', 'external', 'public'
]);
