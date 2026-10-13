import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @octokit/graphql merges the variables object with its request options and
// rejects a variable named like one of them at call time — a class of defect
// the FakeGitHubApi cannot surface (the live client is never exercised in the
// suite). Caught live on 2026-08-26 ($query in findBoardsByTitle); this guard
// reads the live implementation's GraphQL documents and forbids the names.
const RESERVED = ['query', 'method', 'url', 'headers', 'request', 'baseUrl', 'mediaType'];

describe('octokit.ts repository settings', () => {
  it('keeps the Projects setting on — it surfaces the linked board on the repository side', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'github', 'octokit.ts'), 'utf8');
    expect(source).toMatch(/has_projects:\s*true/);
    expect(source).not.toMatch(/has_projects:\s*false/);
  });
});

describe('octokit.ts GraphQL variables', () => {
  it('declares no variable @octokit/graphql reserves', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'github', 'octokit.ts'), 'utf8');
    const declared = [...source.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((match) => match[1]!);
    expect(declared.length).toBeGreaterThan(0);
    const offending = declared.filter((name) => RESERVED.includes(name));
    expect(offending).toEqual([]);
  });
});
