import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaders for the committed GitHub-artifact shapes under `assets/` —
// label inventory, webhook event set, ruleset payloads, issue forms
// (`spec_foundry-data.md §GitHub artifacts`).

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export interface LabelSpec {
  name: string;
  color: string;
}

export function labelInventory(): LabelSpec[] {
  const parsed = JSON.parse(readFileSync(join(ASSETS_DIR, 'labels.json'), 'utf8')) as { labels: LabelSpec[] };
  return parsed.labels;
}

export function webhookEvents(): string[] {
  const parsed = JSON.parse(readFileSync(join(ASSETS_DIR, 'webhook-events.json'), 'utf8')) as { events: string[] };
  return parsed.events;
}

export interface RulesetPayload {
  name: string;
  target: string;
  enforcement: string;
  conditions: object;
  rules: { type: string; parameters?: object }[];
  bypass_actors: unknown[];
}

// Both committed shapes omit the `required_status_checks` rule — Foundry seeds
// no CI workflow, and a required check with no workflow deadlocks every PR; the
// project adds the check to both rulesets when its CI lands.
export function rulesetPayloads(): RulesetPayload[] {
  return ['protect-main', 'protect-dev'].map(
    (name) => JSON.parse(readFileSync(join(ASSETS_DIR, 'rulesets', `${name}.json`), 'utf8')) as RulesetPayload
  );
}

