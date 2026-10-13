import { describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTemplateFile, TemplateLoadError } from '../src/templates/loader.js';
import { createTempDir } from './helpers.js';

describe('loadTemplateFile', () => {
  test('returns parsed JSON for a valid wake-message artifact', () => {
    const dir = createTempDir('wakery-loader-');
    const file = join(dir, 'wake-message.json');
    writeFileSync(file, JSON.stringify({ composition: 'hi', stateBlocks: { default: 'x' }, commentLengths: { lean: 'l' } }));

    const parsed = loadTemplateFile(file);

    expect(parsed).toEqual({ composition: 'hi', stateBlocks: { default: 'x' }, commentLengths: { lean: 'l' } });
  });

  test('throws TemplateLoadError with file path and parser detail for malformed JSON', () => {
    const dir = createTempDir('wakery-loader-');
    const file = join(dir, 'wake-message.json');
    writeFileSync(file, '{"composition": "hi", broken json');

    expect(() => loadTemplateFile(file)).toThrow(TemplateLoadError);
    try {
      loadTemplateFile(file);
    } catch (err) {
      const e = err as TemplateLoadError;
      expect(e.filePath).toBe(file);
      expect(e.message).toContain(file);
      expect(e.cause).toBeInstanceOf(SyntaxError);
    }
  });
});
