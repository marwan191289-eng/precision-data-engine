import type { EngineDefinition, EngineResult } from "./types";
import { checksum } from "./checksum";
import { evaluate } from "mathjs";

export interface IntegrationInput { expression: string; a: number; b: number; n: number; }
export interface IntegrationOutput {
  simpson: number; trapezoid: number; richardson: number;
  samples: Array<{ x: number; y: number }>;
}

function compile(expr: string) { return (x: number) => Number(evaluate(expr, { x })); }

function trapezoid(f: (x: number) => number, a: number, b: number, n: number) {
  const h = (b - a) / n;
  let s = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) s += f(a + i * h);
  return s * h;
}

function simpson(f: (x: number) => number, a: number, b: number, n: number) {
  if (n % 2 !== 0) n += 1;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
  return (s * h) / 3;
}

export const integrationEngine: EngineDefinition<IntegrationInput, IntegrationOutput> = {
  id: "integration",
  version: "1.0.0",
  params: [
    { key: "expression", kind: "expression", default: "sin(x)", label: { en: "f(x)", ar: "الدالة f(x)" } },
    { key: "a", kind: "number", default: 0, label: { en: "a", ar: "a" } },
    { key: "b", kind: "number", default: Math.PI, label: { en: "b", ar: "b" } },
    { key: "n", kind: "number", default: 1000, label: { en: "n subintervals", ar: "n الفواصل" } },
  ],
  doc: {
    en: {
      title: "Numerical Integration",
      equations: [
        "Trapezoidal:  ∫_a^b f(x) dx ≈ h/2 [f(a) + 2 Σ f(a+ih) + f(b)]",
        "Simpson 1/3:  ∫_a^b f(x) dx ≈ h/3 [f(a) + 4 Σ_odd + 2 Σ_even + f(b)]",
        "Richardson:   I ≈ (4·S(n) − S(n/2))/3",
      ],
      method: "Composite Simpson with Richardson extrapolation, cross-checked against composite trapezoid.",
      complexity: "O(n) evaluations of f",
      errorBound: "Simpson: |E| ≤ (b−a)·h^4·max|f^(4)|/180",
    },
    ar: {
      title: "التكامل العددي",
      equations: [
        "شبه المنحرف:  ∫_a^b f(x) dx ≈ h/2 [f(a) + 2 Σ f(a+ih) + f(b)]",
        "سيمبسون 1/3:  ∫_a^b f(x) dx ≈ h/3 [f(a) + 4 Σ_فردي + 2 Σ_زوجي + f(b)]",
        "ريتشاردسون:  I ≈ (4·S(n) − S(n/2))/3",
      ],
      method: "سيمبسون المركّب مع تحسين ريتشاردسون وتحقق متقاطع مع شبه المنحرف.",
      complexity: "O(n) من تقييمات f",
      errorBound: "سيمبسون: |E| ≤ (b−a)·h^4·max|f^(4)|/180",
    },
  },
  run(input): EngineResult<IntegrationOutput> {
    const t0 = performance.now();
    const f = compile(input.expression);
    const simp = simpson(f, input.a, input.b, input.n);
    const trap = trapezoid(f, input.a, input.b, input.n);
    const half = simpson(f, input.a, input.b, Math.max(2, Math.floor(input.n / 2)));
    const rich = (4 * simp - half) / 3;
    const N = 200;
    const samples: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= N; i++) {
      const x = input.a + ((input.b - input.a) * i) / N;
      samples.push({ x, y: f(x) });
    }
    const value: IntegrationOutput = { simpson: simp, trapezoid: trap, richardson: rich, samples };
    return {
      engineId: "integration",
      value,
      checksum: checksum({ simp, trap, rich, n: input.n }),
      durationMs: performance.now() - t0,
      accuracy: { simpsonMinusTrapezoid: Math.abs(simp - trap), richardsonMinusSimpson: Math.abs(rich - simp) },
      series: [{ name: "f(x)", points: samples }],
      table: { columns: ["method", "value"], rows: [["Simpson", simp], ["Trapezoid", trap], ["Richardson", rich]] },
      logs: [`Evaluated f at ${input.n + 1} points`, `Simpson=${simp}`, `Trapezoid=${trap}`, `Richardson=${rich}`],
    };
  },
  verify(input, result) {
    const f = compile(input.expression);
    const refined = simpson(f, input.a, input.b, input.n * 4);
    const absError = Math.abs(refined - result.value.simpson);
    return { ok: absError < 1e-6 * (Math.abs(refined) + 1), absError, note: `Refined Simpson (4n) = ${refined}` };
  },
};