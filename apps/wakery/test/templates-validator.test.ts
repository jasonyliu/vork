import { describe, expect, test } from 'vitest';
import { validateTemplate, TemplateValidationError } from '../src/templates/validator.js';

function validWakeMessage() {
  return {
    composition: 'Hello {{name}}\n{{lane_instructions}}',
    stateBlocks: {
      default: 'do the right thing',
      'assignee:Todo:Approved': 'accept or pend'
    },
    commentLengths: {
      lean: 'one sentence',
      verbose: 'a paragraph'
    }
  };
}

describe('validateTemplate (wake-message)', () => {
  test('returns the typed template for a valid wake-message artifact', () => {
    const template = validateTemplate('wake-message', validWakeMessage());

    expect(template.composition).toContain('{{lane_instructions}}');
    expect(template.stateBlocks.default).toBe('do the right thing');
    expect(template.commentLengths.lean).toBe('one sentence');
  });

  test('throws TemplateValidationError naming composition when composition is missing', () => {
    const bad = validWakeMessage() as Record<string, unknown>;
    delete bad.composition;

    expect(() => validateTemplate('wake-message', bad)).toThrow(TemplateValidationError);
    try {
      validateTemplate('wake-message', bad);
    } catch (err) {
      const e = err as TemplateValidationError;
      expect(e.templateName).toBe('wake-message');
      expect(e.missingKey).toBe('composition');
    }
  });

  test('throws TemplateValidationError naming stateBlocks when stateBlocks is missing', () => {
    const bad = validWakeMessage() as Record<string, unknown>;
    delete bad.stateBlocks;

    try {
      validateTemplate('wake-message', bad);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).missingKey).toBe('stateBlocks');
    }
  });

  test('throws TemplateValidationError naming commentLengths when commentLengths is missing', () => {
    const bad = validWakeMessage() as Record<string, unknown>;
    delete bad.commentLengths;

    try {
      validateTemplate('wake-message', bad);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).missingKey).toBe('commentLengths');
    }
  });

  test('throws TemplateValidationError naming stateBlocks.default when default block is missing', () => {
    const bad = validWakeMessage();
    delete (bad.stateBlocks as Record<string, unknown>).default;

    try {
      validateTemplate('wake-message', bad);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).missingKey).toBe('stateBlocks.default');
    }
  });

  test('throws TemplateValidationError for an unknown template name', () => {
    expect(() => validateTemplate('unknown', validWakeMessage())).toThrow(TemplateValidationError);
  });
});

describe('validateTemplate (rewake-message)', () => {
  test('returns the typed template for a valid rewake-message artifact', () => {
    const template = validateTemplate('rewake-message', { composition: 're-wake {{wake_id}} {{settled_holds_block}}' });
    expect(template.composition).toContain('{{settled_holds_block}}');
  });

  test('throws TemplateValidationError naming composition when composition is missing', () => {
    try {
      validateTemplate('rewake-message', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).templateName).toBe('rewake-message');
      expect((err as TemplateValidationError).missingKey).toBe('composition');
    }
  });

  test('throws TemplateValidationError when composition is the wrong type', () => {
    try {
      validateTemplate('rewake-message', { composition: 42 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).missingKey).toBe('composition');
    }
  });

  test('retired template names (probe-message, resume-message) are unknown', () => {
    expect(() => validateTemplate('probe-message', { composition: 'x' })).toThrow(TemplateValidationError);
    expect(() => validateTemplate('resume-message', { composition: 'x' })).toThrow(TemplateValidationError);
  });
});

describe('validateTemplate (govern-notice-message)', () => {
  test('returns the typed template for a valid govern-notice-message artifact', () => {
    const template = validateTemplate('govern-notice-message', { composition: 'govern {{gate}} {{decision_required}}' });
    expect(template.composition).toContain('{{gate}}');
  });

  test('throws TemplateValidationError naming composition when composition is missing', () => {
    try {
      validateTemplate('govern-notice-message', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).templateName).toBe('govern-notice-message');
      expect((err as TemplateValidationError).missingKey).toBe('composition');
    }
  });

  test('throws TemplateValidationError when composition is the wrong type', () => {
    try {
      validateTemplate('govern-notice-message', { composition: 42 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateValidationError);
      expect((err as TemplateValidationError).missingKey).toBe('composition');
    }
  });
});
