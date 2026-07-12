export type EngineId =
  | "integration"
  | "regression"
  | "statistics"
  | "fft"
  | "ode";

export interface EngineDoc {
  /** Human title in the current locale. */
  title: string;
  /** LaTeX-free equations (plain text/UTF-8). Rendered verbatim. */
  equations: string[];
  /** Numerical method + references. */
  method: string;
  /** Complexity (Big-O). */
  complexity: string;
  /** Known error bound, worst case. */
  errorBound: string;
}

export interface EngineParamSpec {
  key: string;
  label: { en: string; ar: string };
  kind: "number" | "text" | "vector" | "matrix" | "expression";
  default: unknown;
  help?: { en: string; ar: string };
}

export interface EngineResult<T = unknown> {
  engineId: EngineId;
  value: T;
  /** Deterministic checksum (djb2 of JSON) for scientific reproducibility. */
  checksum: string;
  /** ms spent inside .run(). */
  durationMs: number;
  /** Optional accuracy report (residuals, absolute error, tolerance met…). */
  accuracy?: Record<string, number>;
  /** Optional data-series for charts. */
  series?: { name: string; points: Array<{ x: number; y: number }> }[];
  /** Raw tabular payload for CSV/PDF exports. */
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  logs: string[];
}

export interface EngineDefinition<TIn = unknown, TOut = unknown> {
  id: EngineId;
  version: string;
  params: EngineParamSpec[];
  doc: { en: EngineDoc; ar: EngineDoc };
  /** Pure function. MUST be deterministic given identical input. */
  run(input: TIn): EngineResult<TOut>;
  /** Independent oracle: recomputes the same result via a second method
   *  and returns absolute error vs .run(). Used by the "Verify" button. */
  verify?(input: TIn, result: EngineResult<TOut>): { ok: boolean; absError: number; note: string };
}