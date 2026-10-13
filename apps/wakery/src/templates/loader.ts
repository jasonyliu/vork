import { readFileSync } from 'node:fs';

export class TemplateLoadError extends Error {
  constructor(public readonly filePath: string, public readonly cause: Error) {
    super(`failed to load template ${filePath}: ${cause.message}`);
    this.name = 'TemplateLoadError';
  }
}

export function loadTemplateFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new TemplateLoadError(filePath, err as Error);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new TemplateLoadError(filePath, err as Error);
  }
}
