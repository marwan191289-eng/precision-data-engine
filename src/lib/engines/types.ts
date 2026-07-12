export type EngineId =
  | "integration"
  | "regression"
  | "statistics"
  | "fft"
  | "ode";

export interface EngineDoc {
  title: string;
  equations: string[];
  method: string;
  complexity: string;
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
  checksum: string;
  durationMs: number;
  accuracy?: Record<string, number>;
  series?: { name: string; points: Array<{ x: number; y: number }> }[];
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  logs: string[];
}

export interface EngineDefinition<TIn = unknown, TOut = unknown> {
  id: EngineId;
  version: string;
  params: EngineParamSpec[];
  doc: { en: EngineDoc; ar: EngineDoc };
  run(input: TIn): EngineResult<TOut>;
  verify?(input: TIn, result: EngineResult<TOut>): { ok: boolean; absError: number; note: string };
}