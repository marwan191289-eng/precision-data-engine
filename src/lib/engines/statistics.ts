import type { EngineDefinition } from "./types";
import { checksum } from "./checksum";

export interface StatsInput { data: number[]; }
export interface StatsOutput {
  n: number; mean: number; variance: number; stddev: number;
  min: number; max: number; median: number;
  q1: number; q3: number; skewness: number; kurtosis: number;
}

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export const statisticsEngine: EngineDefinition<StatsInput, StatsOutput> = {
  id: "statistics",
  version: "1.0.0",
  params: [{ key: "data", kind: "vector", default: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], label: { en: "data", ar: "البيانات" } }],
  doc: {
    en: {
      title: "Descriptive Statistics",
      equations: [
        "Welford:  M_k = M_{k−1} + (x_k − M_{k−1})/k",
        "S_k = S_{k−1} + (x_k − M_{k−1})(x_k − M_k)",
        "Var = S_n/(n−1)",
      ],
      method: "One-pass Welford for numerically stable mean/variance; sort for quantiles.",
      complexity: "O(n log n)",
      errorBound: "Welford accumulator error: O(ε·n)",
    },
    ar: {
      title: "الإحصاء الوصفي",
      equations: [
        "Welford:  M_k = M_{k−1} + (x_k − M_{k−1})/k",
        "S_k = S_{k−1} + (x_k − M_{k−1})(x_k − M_k)",
        "التباين = S_n/(n−1)",
      ],
      method: "Welford بتمريرة واحدة والفرز للشرائح.",
      complexity: "O(n log n)",
      errorBound: "O(ε·n)",
    },
  },
  run(input) {
    const t0 = performance.now();
    const data = input.data;
    const n = data.length;
    if (n === 0) throw new Error("Empty data");
    let mean = 0, M2 = 0;
    for (let k = 0; k < n; k++) {
      const delta = data[k] - mean;
      mean += delta / (k + 1);
      M2 += delta * (data[k] - mean);
    }
    const variance = n > 1 ? M2 / (n - 1) : 0;
    const stddev = Math.sqrt(variance);
    let skew = 0, kurt = 0;
    if (stddev > 0) {
      for (let i = 0; i < n; i++) {
        const z = (data[i] - mean) / stddev;
        skew += z ** 3; kurt += z ** 4;
      }
      skew /= n; kurt = kurt / n - 3;
    }
    const sorted = [...data].sort((a, b) => a - b);
    const value: StatsOutput = {
      n, mean, variance, stddev,
      min: sorted[0], max: sorted[n - 1],
      median: quantile(sorted, 0.5),
      q1: quantile(sorted, 0.25),
      q3: quantile(sorted, 0.75),
      skewness: skew, kurtosis: kurt,
    };
    return {
      engineId: "statistics",
      value,
      checksum: checksum(value),
      durationMs: performance.now() - t0,
      accuracy: { variance },
      series: [{ name: "sorted", points: sorted.map((y, i) => ({ x: i, y })) }],
      table: { columns: ["stat", "value"], rows: Object.entries(value).map(([k, v]) => [k, v as number]) },
      logs: [`n=${n}`, `mean=${mean}`, `stddev=${stddev}`],
    };
  },
  verify(input, result) {
    const n = input.data.length;
    const m = input.data.reduce((a, b) => a + b, 0) / n;
    const v = input.data.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1);
    const absError = Math.abs(m - result.value.mean) + Math.abs(v - result.value.variance);
    return { ok: absError < 1e-9, absError, note: `Two-pass mean=${m}, var=${v}` };
  },
};