import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaders for the committed GitHub-artifact shapes under `assets/` —
// label inventory and ruleset payloads (`spec_foundry-data.md §GitHub artifacts`).

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export interface LabelSpec {
  name: string;
  color: string;
}

export function labelInventory(): LabelSpec[] {
  const parsed = JSON.parse(readFileSync(join(ASSETS_DIR, 'labels.json'), 'utf8')) as { labels: LabelSpec[] };
  return parsed.labels;
}

export interface RulesetPayload {
  name: string;
  target: string;
  enforcement: string;
  conditions: object;
  rules: { type: string; parameters?: object }[];
  bypass_actors: unknown[];
}

// Both committed shapes gain the `required_status_checks` rule when the
// project's CI lands — a required check before any workflow exists would
// deadlock every PR.
export function rulesetPayloads(): RulesetPayload[] {
  return ['protect-main', 'protect-dev'].map(
    (name) => JSON.parse(readFileSync(join(ASSETS_DIR, 'rulesets', `${name}.json`), 'utf8')) as RulesetPayload
  );
}

