// Shared types and the Risk-Code domain for Resolver.
//
// The Resolver-emit set is `{R100, R200, R300, R999}` per `SECURITY.md §Resolver`
// and `spec_resolver.md §Invariants`. Resolver never emits the Auditor-direct
// codes (`R0`, `R994`–`R998`).

export type RiskCode = 'R100' | 'R200' | 'R300' | 'R999';

// The Resolver-emit set, in aggregation order `R100 < R200 < R300 < R999`.
// `max(...)` over a chain uses the index into this array as the rank.
export const RISK_ORDER: readonly RiskCode[] = ['R100', 'R200', 'R300', 'R999'];

export const RESOLVER_EMIT_SET: ReadonlySet<string> = new Set(RISK_ORDER);

export function isRiskCode(value: unknown): value is RiskCode {
  return typeof value === 'string' && RESOLVER_EMIT_SET.has(value);
}

// `max(...)` aggregation under the order above. Returns the strictest (highest-rank)
// code among the inputs. Order-independent, per `spec_resolver.md §Procedure Stage 2`.
export function maxRiskCode(codes: readonly RiskCode[]): RiskCode {
  let max: RiskCode = RISK_ORDER[0];
  for (const code of codes) {
    if (RISK_ORDER.indexOf(code) > RISK_ORDER.indexOf(max)) max = code;
  }
  return max;
}

// One primitive operation as it arrives on stdin.
export interface ChainOp {
  seq: number;
  action: string;
  subject: string;
  zone: string;
}

// A validated input document.
export interface ResolverInput {
  project: string;
  chain: ChainOp[];
}

// One resolved primitive operation on the success-envelope output.
export interface ResolvedOp extends ChainOp {
  risk_code: RiskCode;
}

// The success envelope written to stdout (exit 0).
export interface SuccessEnvelope {
  task_risk_code: RiskCode;
  resolution_context: string; // 'wildcard' | `project:<name>`
  chain: ResolvedOp[];
}

// The error envelope written to stdout (non-zero exit).
export interface ErrorEnvelope {
  error: {
    class: ErrorClass;
    message: string;
    detail?: Record<string, unknown>;
  };
}

// Error classes map one-to-one with the non-zero exit codes per
// `spec_resolver-contracts.md §Exit-Code-to-Error-Class mapping`.
export type ErrorClass =
  | 'input_parse'
  | 'input_validation'
  | 'config'
  | 'db_connect'
  | 'db_query'
  | 'invalid_mapping_row'
  | 'internal';
