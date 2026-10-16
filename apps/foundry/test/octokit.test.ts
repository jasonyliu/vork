import { describe, expect, it } from 'vitest';
import { GITHUB_API_VERSION, newOctokit } from '../src/github/octokit.js';

// Every request names the API version (`spec_foundry.md`): asserted on the
// wire, through an injected fetch, since the live client is never exercised in
// the suite.

describe('octokit client', () => {
  it('names GitHub API version 2026-03-10 on every request', async () => {
    const seen: Record<string, string>[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      seen.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])));
      return new Response('{"login":"x","node_id":"U_x"}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = newOctokit('t', { fetch: fakeFetch });
    await client.users.getAuthenticated();
    await client.request('GET /rate_limit');
    expect(GITHUB_API_VERSION).toBe('2026-03-10');
    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(headers['x-github-api-version']).toBe(GITHUB_API_VERSION);
      expect(headers['authorization']).toBe('token t');
    }
  });
});
