import type { EngineDefinition } from "./types";
import { checksum } from "./checksum";

export interface RegressionInput { x: number[]; y: number[]; }
export interface RegressionOutput {
  slope: number; intercept: number; r2: number;
  seSlope: number; seIntercept: number; residuals: number[];
}

export const regressionEngine: EngineDefinition<RegressionInput, RegressionOutput> = {
  id: "regression",
  version: "1.0.0",
  params: [
    { key: "x", kind: "vector", default: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], label: { en: "x vector", ar: "متجه x" } },
    { key: "y", kind: "vector", default: [2.1, 3.9, 6.1, 8.0, 9.9, 12.2, 13.8, 16.1, 18.2, 20.0], label: { en: "y vector", ar: "متجه y" } },
  ],
  doc: {
    en: {
      title: "OLS Linear Regression",
      equations: [
        "β̂ = Σ(xᵢ−x̄)(yᵢ−ȳ) / Σ(xᵢ−x̄)²",
        "α̂ = ȳ − β̂ x̄",
        "R² = 1 − Σ(yᵢ−ŷᵢ)² / Σ(yᵢ−ȳ)²",
        "SE(β̂) = √(σ̂² / Σ(xᵢ−x̄)²),   σ̂² = RSS/(n−2)",
      ],
      method: "Closed-form OLS with two-pass mean centering for numerical stability.",
      complexity: "O(n)",
      errorBound: "Exact up to floating-point (ε ≈ 2.22e−16 per FLOP).",
    },
    ar: {
      title: "الانحدار الخطي (OLS)",
      equations: [
        "β̂ = Σ(xᵢ−x̄)(yᵢ−ȳ) / Σ(xᵢ−x̄)²",
        "α̂ = ȳ − β̂ x̄",
        "R² = 1 − Σ(yᵢ−ŷᵢ)² / Σ(yᵢ−ȳ)²",
      ],
      method: "المربعات الصغرى بحل مغلق مع تمريرين لتمركز المتوسط.",
      complexity: "O(n)",
      errorBound: "دقيق حتى حدود الفاصلة العائمة.",
    },
  },
  run(input) {
    const t0 = performance.now();
    const n = Math.min(input.x.length, input.y.length);
    if (n < 2) throw new Error("Need at least 2 samples");
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += input.x[i]; sy += input.y[i]; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = input.x[i] - mx, dy = input.y[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    const residuals = new Array<number>(n);
    let rss = 0;
    for (let i = 0; i < n; i++) {
      const r = input.y[i] - (intercept + slope * input.x[i]);
      residuals[i] = r; rss += r * r;
    }
    const r2 = 1 - rss / syy;
    const sigma2 = rss / Math.max(1, n - 2);
    const seSlope = Math.sqrt(sigma2 / sxx);
    const seIntercept = Math.sqrt(sigma2 * (1 / n + (mx * mx) / sxx));
    const value: RegressionOutput = { slope, intercept, r2, seSlope, seIntercept, residuals };
    return {
      engineId: "regression",
      value,
      checksum: checksum({ slope, intercept, r2 }),
      durationMs: performance.now() - t0,
      accuracy: { r2, rss },
      series: [
        { name: "observed", points: input.x.slice(0, n).map((x, i) => ({ x, y: input.y[i] })) },
        { name: "fit", points: input.x.slice(0, n).map((x) => ({ x, y: intercept + slope * x })) },
      ],
      table: {
        columns: ["stat", "value"],
        rows: [["slope", slope], ["intercept", intercept], ["R²", r2], ["SE(slope)", seSlope], ["SE(intercept)", seIntercept], ["n", n]],
      },
      logs: [`n=${n}`, `slope=${slope}`, `intercept=${intercept}`, `R²=${r2}`],
    };
  },
  verify(input, result) {
    const n = Math.min(input.x.length, input.y.length);
    let sxx = 0, sx = 0, sxy = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += input.x[i]; sy += input.y[i]; sxx += input.x[i] ** 2; sxy += input.x[i] * input.y[i]; }
    const det = n * sxx - sx * sx;
    const slope = (n * sxy - sx * sy) / det;
    const intercept = (sy - slope * sx) / n;
    const absError = Math.abs(slope - result.value.slope) + Math.abs(intercept - result.value.intercept);
    return { ok: absError < 1e-9, absError, note: `Normal equations slope=${slope}, intercept=${intercept}` };
  },
};