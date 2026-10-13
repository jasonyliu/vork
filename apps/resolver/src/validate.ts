import { EXIT, ResolverError } from './errors.js';
import type { ChainOp, ResolverInput } from './types.js';
import { ACTIONS, SUBJECTS, ZONES } from './vocabulary.js';

// Stage 1a — parse stdin as JSON. A parse failure is exit 1 / `input_parse`; no DB
// connection is opened. Empty stdin parses as a failure here (per `manual.md`'s
// `resolver < /dev/null` smoke: exit 1).
export function parseInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ResolverError(EXIT.INPUT_PARSE, 'stdin did not parse as JSON', {
      reason: err instanceof Error ? err.message : String(err)
    });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(message: string, detail: Record<string, unknown>): never {
  throw new ResolverError(EXIT.INPUT_VALIDATION, message, detail);
}

function validateComponent(
  raw: unknown,
  index: number,
  field: 'action' | 'subject' | 'zone',
  vocab: ReadonlySet<string>,
  label: string
): string {
  const path = `chain[${index}].${field}`;
  if (typeof raw !== 'string') {
    fail(`primitive operation at chain[${index}] has a non-string ${field} component`, {
      field: path,
      value: raw,
      reason: `${field} must be a string`
    });
  }
  if (!vocab.has(raw)) {
    fail(`primitive operation at chain[${index}] has invalid ${label} component`, {
      field: path,
      value: raw,
      reason: `not a known ${label} primitive component`
    });
  }
  return raw;
}

// Stage 1b — validate the parsed document against the input envelope: chain shape,
// the Action/Subject/Zone vocabulary per `SECURITY.md §Classification`, and the
// 1-indexed unique contiguous `seq` invariant. Any failure is exit 2 /
// `input_validation`; no DB connection is opened.
//
// The v1 resolution algorithm does not consume `seq`, but malformed `seq` values
// reject here per `spec_resolver-contracts.md §Invariants`.
export function validateInput(parsed: unknown): ResolverInput {
  if (!isObject(parsed)) {
    fail('input document must be a JSON object', { field: '', reason: 'not an object' });
  }

  const projectName = parsed.project;
  if (typeof projectName !== 'string' || projectName.length === 0) {
    fail('input is missing a valid project', {
      field: 'project',
      value: projectName,
      reason: 'project must be a non-empty string'
    });
  }

  const chainRaw = parsed.chain;
  if (!Array.isArray(chainRaw)) {
    fail('input is missing a valid chain array', {
      field: 'chain',
      reason: 'chain must be an array'
    });
  }
  if (chainRaw.length === 0) {
    fail('input chain is empty', { field: 'chain', reason: 'chain must contain at least one operation' });
  }

  const chain: ChainOp[] = [];
  const seqs: number[] = [];
  for (let i = 0; i < chainRaw.length; i++) {
    const op = chainRaw[i];
    if (!isObject(op)) {
      fail(`chain[${i}] is not an object`, { field: `chain[${i}]`, reason: 'operation must be an object' });
    }

    if (typeof op.seq !== 'number' || !Number.isInteger(op.seq)) {
      fail(`chain[${i}] has a non-integer seq`, {
        field: `chain[${i}].seq`,
        value: op.seq,
        reason: 'seq must be an integer'
      });
    }

    const action = validateComponent(op.action, i, 'action', ACTIONS, 'Action');
    const subject = validateComponent(op.subject, i, 'subject', SUBJECTS, 'Subject');
    const zone = validateComponent(op.zone, i, 'zone', ZONES, 'Zone');

    seqs.push(op.seq);
    chain.push({ seq: op.seq, action, subject, zone });
  }

  // seq must be 1-indexed, unique, and form a contiguous 1..len range.
  const expected = new Set<number>();
  for (let n = 1; n <= chain.length; n++) expected.add(n);
  const seen = new Set<number>();
  for (const s of seqs) {
    if (!expected.has(s)) {
      fail('chain seq values are not a contiguous 1-indexed range', {
        field: 'chain[].seq',
        value: s,
        reason: `seq ${s} is outside the expected 1..${chain.length} range`
      });
    }
    if (seen.has(s)) {
      fail('chain seq values are not unique', {
        field: 'chain[].seq',
        value: s,
        reason: `seq ${s} is duplicated`
      });
    }
    seen.add(s);
  }

  return { project: projectName, chain };
}
