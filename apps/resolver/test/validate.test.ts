import { describe, expect, test } from 'vitest';
import { ResolverError, EXIT } from '../src/errors.js';
import { parseInput, validateInput } from '../src/validate.js';

function expectError(fn: () => unknown, exitCode: number) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ResolverError);
    expect((err as ResolverError).exitCode).toBe(exitCode);
    return err as ResolverError;
  }
  throw new Error('expected a ResolverError to be thrown');
}

describe('parseInput — exit 1 / input_parse', () => {
  test('empty stdin does not parse (matches `resolver < /dev/null` smoke)', () => {
    const e = expectError(() => parseInput(''), EXIT.INPUT_PARSE);
    expect(e.errorClass).toBe('input_parse');
  });

  test('malformed JSON does not parse', () => {
    expectError(() => parseInput('{ not json'), EXIT.INPUT_PARSE);
  });

  test('valid JSON parses', () => {
    expect(parseInput('{"a":1}')).toEqual({ a: 1 });
  });
});

const validOp = { seq: 1, action: 'update', subject: 'file', zone: 'workspace' };

describe('validateInput — exit 2 / input_validation', () => {
  test('accepts a well-formed document', () => {
    const input = validateInput({ project: 'vork', chain: [validOp] });
    expect(input.project).toBe('vork');
    expect(input.chain).toHaveLength(1);
  });

  test('rejects a non-object document', () => {
    expectError(() => validateInput([]), EXIT.INPUT_VALIDATION);
    expectError(() => validateInput('x'), EXIT.INPUT_VALIDATION);
  });

  test('rejects a missing / empty project', () => {
    expectError(() => validateInput({ chain: [validOp] }), EXIT.INPUT_VALIDATION);
    expectError(() => validateInput({ project: '', chain: [validOp] }), EXIT.INPUT_VALIDATION);
    expectError(() => validateInput({ project: 7, chain: [validOp] }), EXIT.INPUT_VALIDATION);
  });

  test('rejects a missing chain and a non-array chain', () => {
    expectError(() => validateInput({ project: 'p' }), EXIT.INPUT_VALIDATION);
    expectError(() => validateInput({ project: 'p', chain: {} }), EXIT.INPUT_VALIDATION);
  });

  test('rejects an empty chain', () => {
    expectError(() => validateInput({ project: 'p', chain: [] }), EXIT.INPUT_VALIDATION);
  });

  test('rejects a non-object operation', () => {
    expectError(() => validateInput({ project: 'p', chain: [42] }), EXIT.INPUT_VALIDATION);
  });

  test('rejects an unknown Action component with a precise detail', () => {
    const e = expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, action: 'frobnicate' }] }),
      EXIT.INPUT_VALIDATION
    );
    expect(e.detail).toMatchObject({
      field: 'chain[0].action',
      value: 'frobnicate',
      reason: 'not a known Action primitive component'
    });
  });

  test('rejects an unknown Subject component', () => {
    expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, subject: 'widget' }] }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('rejects an unknown Zone component', () => {
    expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, zone: 'orbit' }] }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('rejects an uppercased component (case-sensitive vocabulary)', () => {
    expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, action: 'Update' }] }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('rejects whitespace-padded component (not a vocabulary member)', () => {
    expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, action: 'update ' }] }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('rejects a non-integer seq', () => {
    expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, seq: 1.5 }] }),
      EXIT.INPUT_VALIDATION
    );
    expectError(
      () => validateInput({ project: 'p', chain: [{ ...validOp, seq: '1' }] }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('rejects a non-contiguous seq range', () => {
    expectError(
      () =>
        validateInput({
          project: 'p',
          chain: [
            { seq: 1, action: 'read', subject: 'file', zone: 'workspace' },
            { seq: 3, action: 'read', subject: 'file', zone: 'local' }
          ]
        }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('rejects duplicate seq values', () => {
    expectError(
      () =>
        validateInput({
          project: 'p',
          chain: [
            { seq: 1, action: 'read', subject: 'file', zone: 'workspace' },
            { seq: 1, action: 'read', subject: 'file', zone: 'local' }
          ]
        }),
      EXIT.INPUT_VALIDATION
    );
  });

  test('accepts a contiguous range given out of array order', () => {
    const input = validateInput({
      project: 'p',
      chain: [
        { seq: 2, action: 'read', subject: 'file', zone: 'local' },
        { seq: 1, action: 'read', subject: 'file', zone: 'workspace' }
      ]
    });
    // Array order is preserved verbatim; callers correlate via seq.
    expect(input.chain.map((o) => o.seq)).toEqual([2, 1]);
  });
});
