// The minimal query surface the schema-lifecycle acts need. Structural on
// purpose: pg's Pool, PoolClient, and pg-mem's adapter all satisfy it
// regardless of @types/pg version skew across consuming packages.
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}
