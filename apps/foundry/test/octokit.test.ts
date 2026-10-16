import { Octokit } from '@octokit/rest';
import { describe, expect, it } from 'vitest';
import { GITHUB_API_VERSION, octokitOptions } from '../src/github/octokit.js';

// Every request names the API version (`spec_foundry.md`): the live client is
// never exercised in the suite, so the header is asserted on the client's
// request defaults.

describe('octokit client options', () => {
  it('names the GitHub API version on every request', () => {
    const client = new Octokit(octokitOptions('t'));
    const headers = client.request.endpoint.DEFAULTS.headers as Record<string, string>;
    expect(headers['X-GitHub-Api-Version'] ?? headers['x-github-api-version']).toBe(GITHUB_API_VERSION);
    expect(GITHUB_API_VERSION).toBe('2026-03-10');
  });
});
