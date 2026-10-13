import { describe, expect, test } from 'vitest';
import { substitute, findUnsubstitutedTokens } from '../src/templates/substituter.js';

describe('substitute', () => {
  test('replaces a single {{placeholder}} with the provided value', () => {
    expect(substitute('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  test('replaces multiple placeholders, repeated occurrences included', () => {
    expect(
      substitute('{{greet}}, {{name}}. {{greet}} again, {{name}}.', { greet: 'Hi', name: 'World' })
    ).toBe('Hi, World. Hi again, World.');
  });

  test('leaves an un-supplied placeholder in place (no silent drop)', () => {
    expect(substitute('a {{known}} b {{unknown}} c', { known: 'X' })).toBe('a X b {{unknown}} c');
  });

  test('substitutes empty string when the value is empty', () => {
    expect(substitute('a {{x}} b', { x: '' })).toBe('a  b');
  });
});

describe('findUnsubstitutedTokens', () => {
  test('returns an empty array when no placeholders remain', () => {
    expect(findUnsubstitutedTokens('plain string')).toEqual([]);
  });

  test('returns the names of all surviving {{placeholders}}', () => {
    expect(findUnsubstitutedTokens('a {{one}} b {{two}} c {{one}}')).toEqual(['one', 'two', 'one']);
  });
});
