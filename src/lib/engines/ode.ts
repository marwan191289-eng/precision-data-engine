import type { EngineDefinition } from "./types";
import { checksum } from "./checksum";
import { evaluate } from "mathjs";

export interface ODEInput { expression: string; t0: number; y0: number; tEnd: number; h: number; }
export interface ODEOutput { trajectory: Array<{ t: number; y: number }>; }

export const odeEngine: EngineDefinition<ODEInput, ODEOutput> = {
  id: "ode",
  version: "1.0.0",
  params: [
    { key: "expression", kind: "expression", default: "-2*y + t", label: { en: "f(t, y)", ar: "f(t, y)" } },
    { key: "t0", kind: "number", default: 0, label: { en: "t₀", ar: "t₀" } },
    { key: "y0", kind: "number", default: 1, label: { en: "y₀", ar: "y₀" } },
    { key: "tEnd", kind: "number", default: 5, label: { en: "t_end", ar: "t النهاية" } },
    { key: "h", kind: "number", default: 0.05, label: { en: "step h", ar: "الخطوة h" } },
  ],
  doc: {
    en: {
      title: "Runge–Kutta 4",
      equations: [
        "k₁ = f(t,y), k₂ = f(t+h/2, y+h k₁/2)",
        "k₃ = f(t+h/2, y+h k₂/2), k₄ = f(t+h, y+h k₃)",
        "y_{n+1} = y_n + h(k₁+2k₂+2k₃+k₄)/6",
      ],
      method: "Explicit RK4. Local truncation error O(h⁵), global O(h⁴).",
      complexity: "O((t_end−t₀)/h)",
      errorBound: "Global O(h⁴).",
    },
    ar: {
      title: "رونج–كوتا 4",
      equations: [
        "k₁ = f(t,y), k₂ = f(t+h/2, y+h k₁/2)",
        "k₃ = f(t+h/2, y+h k₂/2), k₄ = f(t+h, y+h k₃)",
        "y_{n+1} = y_n + h(k₁+2k₂+2k₃+k₄)/6",
      ],
      method: "RK4 صريح، خطأ محلي O(h⁵) وخطأ كلي O(h⁴).",
      complexity: "O((t_end−t₀)/h)",
      errorBound: "O(h⁴)",
    },
  },
  run(input) {
    const t0m = performance.now();
    const f = (t: number, y: number) => Number(evaluate(input.expression, { t, y }));
    const traj: Array<{ t: number; y: number }> = [{ t: input.t0, y: input.y0 }];
    let t = input.t0, y = input.y0;
    const steps = Math.ceil((input.tEnd - input.t0) / input.h);
    for (let i = 0; i < steps; i++) {
      const k1 = f(t, y);
      const k2 = f(t + input.h / 2, y + (input.h * k1) / 2);
      const k3 = f(t + input.h / 2, y + (input.h * k2) / 2);
      const k4 = f(t + input.h, y + input.h * k3);
      y += (input.h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
      t += input.h;
      traj.push({ t, y });
    }
    return {
      engineId: "ode",
      value: { trajectory: traj },
      checksum: checksum({ last: traj[traj.length - 1] }),
      durationMs: performance.now() - t0m,
      accuracy: { steps },
      series: [{ name: "y(t)", points: traj.map(p => ({ x: p.t, y: p.y })) }],
      table: { columns: ["t", "y"], rows: traj.map(p => [p.t, p.y]) },
      logs: [`steps=${steps}`, `y(t_end)=${traj[traj.length - 1].y}`],
    };
  },
  verify(input, result) {
    const halfH = input.h / 2;
    const f = (t: number, y: number) => Number(evaluate(input.expression, { t, y }));
    let t = input.t0, y = input.y0;
    const steps = Math.ceil((input.tEnd - input.t0) / halfH);
    for (let i = 0; i < steps; i++) {
      const k1 = f(t, y);
      const k2 = f(t + halfH / 2, y + (halfH * k1) / 2);
      const k3 = f(t + halfH / 2, y + (halfH * k2) / 2);
      const k4 = f(t + halfH, y + halfH * k3);
      y += (halfH * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
      t += halfH;
    }
    const yEnd = result.value.trajectory[result.value.trajectory.length - 1].y;
    const absError = Math.abs(y - yEnd);
    return { ok: absError < 1e-3, absError, note: `Half-step endpoint y=${y}` };
  },
};