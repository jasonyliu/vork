import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skeletonInventory, skeletonSource } from './skeleton.js';

// `foundry verify --against <path>` (`spec_foundry.md §Verify`): compare
// structure only — every canonical path present, record templates
// byte-identical, README stubs present. Content beyond the skeleton is never
// flagged; render-mode files are checked for presence, not content (a living
// project's charter has long since diverged from a fresh render). Mutates
// nothing; reports per-path.

export interface VerifyFinding {
  path: string;
  problem: 'missing' | 'template_drift';
}

export interface VerifyResult {
  clean: boolean;
  checked: number;
  findings: VerifyFinding[];
}

export function verifyAgainst(targetDir: string): VerifyResult {
  const findings: VerifyFinding[] = [];
  const inventory = skeletonInventory();
  for (const entry of inventory) {
    const target = join(targetDir, entry.path);
    if (!existsSync(target)) {
      findings.push({ path: entry.path, problem: 'missing' });
      continue;
    }
    if (entry.mode === 'verbatim' && readFileSync(target, 'utf8') !== skeletonSource(entry)) {
      findings.push({ path: entry.path, problem: 'template_drift' });
    }
  }
  return { clean: findings.length === 0, checked: inventory.length, findings };
}

export function formatVerifyReport(targetDir: string, result: VerifyResult): string {
  if (result.clean) return `verify: ${targetDir} — ${result.checked} canonical paths clean`;
  const lines = result.findings.map((finding) =>
    finding.problem === 'missing' ? `  missing: ${finding.path}` : `  template drift: ${finding.path}`
  );
  return [`verify: ${targetDir} — ${result.findings.length} finding(s) over ${result.checked} canonical paths`, ...lines].join('\n');
}
