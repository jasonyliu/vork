import type { VariableValues } from '../src/variables.js';

export function fixtureValues(overrides: Partial<VariableValues> = {}): VariableValues {
  return {
    project_name: 'Throwaway Project',
    project_key: 'throwaway',
    mission: 'A one-paragraph mission for the throwaway project.',
    description: 'The goal the throwaway project exists to achieve.',
    scope: 'The current boundary of throwaway work.',
    owner_login: 'owner-login',
    utc_now: '2026-08-24T12:00:00Z',
    utc_now_compact: '20260824T120000Z',
    run_id: '00000000-0000-4000-8000-000000000000',
    ...overrides
  };
}
