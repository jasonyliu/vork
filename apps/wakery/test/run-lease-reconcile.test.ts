import { describe, expect, test } from 'vitest';
import { shouldCompleteRunLease } from '../src/adapters/openclaw/run-lease-reconcile.js';

describe('shouldCompleteRunLease', () => {
  test('returns true when downstream run session has assistant output', () => {
    expect(shouldCompleteRunLease({
      exists: true,
      assistantMessageCount: 1
    })).toBe(true);
  });

  test('returns false when no run session exists yet', () => {
    expect(shouldCompleteRunLease({
      exists: false,
      assistantMessageCount: 0
    })).toBe(false);
  });

  test('returns false when the run session has no assistant output yet', () => {
    expect(shouldCompleteRunLease({
      exists: true,
      assistantMessageCount: 0
    })).toBe(false);
  });
});
