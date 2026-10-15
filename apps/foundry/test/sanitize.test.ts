import { describe, expect, it } from 'vitest';
import { isSecretFieldName, sanitize } from '../src/events.js';

describe('run-event sanitization', () => {
  it('redacts secret-bearing field names by segment', () => {
    for (const name of ['token', 'main_token_path', 'password_path', 'webhook_secret_path', 'api_key', 'pat', 'ownerToken', 'Authorization', 'credentials']) {
      expect(isSecretFieldName(name), name).toBe(true);
    }
  });
  it('leaves ordinary names alone — path is not pat, keyword is not key', () => {
    for (const name of ['path', 'paths', 'linked_branch', 'patch', 'keyword', 'author', 'github_login', 'created_or_skipped', 'project_key_unused'.replace('_key_unused', '_id')]) {
      expect(isSecretFieldName(name), name).toBe(false);
    }
  });
  it('project_key is a secret segment by the rule and stays redacted in run_started', () => {
    // `key` is a secret segment; the bundle's project_key is redacted in the
    // run_started payload — acceptable: the run file name already carries it.
    expect(sanitize({ project_key: 'ascend', path: 'docs/x.md', nested: { token_path: '/t' } })).toEqual({ project_key: '***', path: 'docs/x.md', nested: { token_path: '***' } });
  });
});
