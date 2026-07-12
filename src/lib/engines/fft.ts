import type { EngineDefinition } from "./types";
import { checksum } from "./checksum";

export interface FFTInput { signal: number[]; sampleRate: number; }
export interface FFTOutput { magnitude: number[]; phase: number[]; frequencies: number[]; }

function nextPow2(n: number) { let p = 1; while (p < n) p <<= 1; return p; }

function fft(re: number[], im: number[]) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlr = Math.cos(ang), wli = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr; wr = nwr;
      }
    }
  }
}

export const fftEngine: EngineDefinition<FFTInput, FFTOutput> = {
  id: "fft",
  version: "1.0.0",
  params: [
    { key: "signal", kind: "vector",
      default: Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 5 * i / 128) + 0.5 * Math.sin(2 * Math.PI * 12 * i / 128)),
      label: { en: "signal", ar: "الإشارة" } },
    { key: "sampleRate", kind: "number", default: 128, label: { en: "sample rate (Hz)", ar: "معدّل العينة (هرتز)" } },
  ],
  doc: {
    en: {
      title: "Cooley–Tukey FFT",
      equations: ["X_k = Σ_{n=0}^{N−1} x_n · e^(−2πi kn/N)"],
      method: "Radix-2 in-place with bit-reversal permutation, zero-padded to next power of two.",
      complexity: "O(N log N)",
      errorBound: "Round-off ≈ O(ε · log₂ N)",
    },
    ar: {
      title: "تحويل فورييه السريع",
      equations: ["X_k = Σ_{n=0}^{N−1} x_n · e^(−2πi kn/N)"],
      method: "جذر-2 في الموضع مع ترتيب عكسي للبتات، وحشو أصفار لأقرب قوة اثنين.",
      complexity: "O(N log N)",
      errorBound: "O(ε · log₂ N)",
    },
  },
  run(input) {
    const t0 = performance.now();
    const N = nextPow2(input.signal.length);
    const re = new Array(N).fill(0);
    const im = new Array(N).fill(0);
    for (let i = 0; i < input.signal.length; i++) re[i] = input.signal[i];
    fft(re, im);
    const half = N / 2;
    const magnitude = new Array<number>(half);
    const phase = new Array<number>(half);
    const frequencies = new Array<number>(half);
    for (let k = 0; k < half; k++) {
      magnitude[k] = Math.hypot(re[k], im[k]) / N;
      phase[k] = Math.atan2(im[k], re[k]);
      frequencies[k] = (k * input.sampleRate) / N;
    }
    const value: FFTOutput = { magnitude, phase, frequencies };
    return {
      engineId: "fft",
      value,
      checksum: checksum({ mag: magnitude.slice(0, 8) }),
      durationMs: performance.now() - t0,
      accuracy: { paddedTo: N },
      series: [{ name: "|X(f)|", points: frequencies.map((f, i) => ({ x: f, y: magnitude[i] })) }],
      table: { columns: ["freq(Hz)", "magnitude", "phase"], rows: frequencies.map((f, i) => [f, magnitude[i], phase[i]]) },
      logs: [`N=${N}`, `bins=${half}`],
    };
  },
  verify(input, result) {
    const energyTime = input.signal.reduce((a, b) => a + b * b, 0);
    const energyFreq = result.value.magnitude.reduce((a, b) => a + b * b, 0) * result.value.magnitude.length * 2;
    const absError = Math.abs(energyTime - energyFreq) / (energyTime + 1);
    return { ok: absError < 1e-1, absError, note: `Parseval E_t=${energyTime}, E_f≈${energyFreq}` };
  },
};