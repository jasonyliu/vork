import type { ErrorClass, ErrorEnvelope } from './types.js';

// Exit-code-to-error-class mapping, per `spec_resolver-contracts.md §Exit-Code-to-
// Error-Class mapping`. Code 0 is success (no error class); every non-zero code
// maps to exactly one `error.class`.
export const EXIT = {
  SUCCESS: 0,
  INPUT_PARSE: 1,
  INPUT_VALIDATION: 2,
  CONFIG: 3,
  DB_CONNECT: 4,
  DB_QUERY: 5,
  INVALID_MAPPING_ROW: 6,
  INTERNAL: 7
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const CLASS_BY_EXIT: Record<number, ErrorClass> = {
  [EXIT.INPUT_PARSE]: 'input_parse',
  [EXIT.INPUT_VALIDATION]: 'input_validation',
  [EXIT.CONFIG]: 'config',
  [EXIT.DB_CONNECT]: 'db_connect',
  [EXIT.DB_QUERY]: 'db_query',
  [EXIT.INVALID_MAPPING_ROW]: 'invalid_mapping_row',
  [EXIT.INTERNAL]: 'internal'
};

// A resolution failure carrying the process exit code, the error class it maps to,
// a human-readable message for the audit comment, and an optional structured detail.
export class ResolverError extends Error {
  readonly exitCode: ExitCode;
  readonly errorClass: ErrorClass;
  readonly detail?: Record<string, unknown>;

  constructor(exitCode: Exclude<ExitCode, 0>, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'ResolverError';
    this.exitCode = exitCode;
    this.errorClass = CLASS_BY_EXIT[exitCode];
    this.detail = detail;
  }

  toEnvelope(): ErrorEnvelope {
    const env: ErrorEnvelope = {
      error: { class: this.errorClass, message: this.message }
    };
    if (this.detail !== undefined) env.error.detail = this.detail;
    return env;
  }
}
