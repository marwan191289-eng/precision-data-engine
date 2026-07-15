// Cycle Engine — spectral (FFT) cycle detection.
//
// Ported and adapted from the sibling "precision-data-engine" scientific
// suite (Cooley–Tukey radix-2 FFT with a Parseval self-check). This is the
// first bridge between the two repos: a scientific primitive re-used as a
// sixth confluence signal inside the trading integration hub.
//
// Method:
//   1. Detrend the last WINDOW closes with an OLS line (removes the
//      dominant linear component so a real market cycle isn't swamped by
//      the underlying trend).
//   2. Apply a Hann window (reduces spectral leakage from the cut edges).
//   3. Run a radix-2 FFT, zero-padded to the next power of two.
//   4. Find the dominant non-DC bin and convert it back into a candle
//      period.
//   5. Reconstruct the single-frequency component at the last two samples
//      to read off its instantaneous direction (rising / falling).
//   6. Self-verify with Parseval's theorem (time-domain energy must equal
//      frequency-domain energy) — this is a correctness check on the FFT
//      itself, not on the trading signal, and is reported honestly as such.

import type { Candle, Trend } from './types';

const WINDOW = 128; // candles fed into the transform (power of two, no padding needed)
const MIN_PERIOD = 6; // ignore bins faster than ~6 candles (noise, not a tradable cycle)
// A period must repeat at least twice inside the window to be verifiable as a
// real cycle at all — anything longer is indistinguishable from leftover
// curvature/residual trend that the linear detrend didn't fully remove, and
// reporting it as a "cycle" would be a false claim of periodicity.
const MAX_PERIOD = WINDOW / 2;
// Below this share of spectral energy, the "dominant" bin is not
// distinguishable from noise — report honestly as no cycle rather than a
// low-confidence one. This is a blunt interim floor, not a proper
// red-noise/AR(1) significance test (see INTEGRATION_NOTES.md).
const MIN_STRENGTH_PCT = 15;

export interface CycleResult {
  trend: Trend;
  strength: number; // 0-100, share of spectral energy in the dominant bin
  dominantPeriodCandles: number | null;
  logs: string[];
  verify: { ok: boolean; absError: number; note: string };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place radix-2 Cooley–Tukey FFT. re/im length must be a power of two. */
function fft(re: number[], im: number[]): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlr = Math.cos(ang);
    const wli = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }
}

/** OLS slope/intercept over index 0..n-1 vs values — used to detrend before transforming. */
function olsDetrend(values: number[]): number[] {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return values.map((v, i) => v - (intercept + slope * i));
}

function hann(n: number): number[] {
  if (n === 1) return [1];
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function detectDominantCycle(candles: Candle[]): CycleResult {
  const logs: string[] = [];
  if (candles.length < WINDOW) {
    return {
      trend: 'neutral',
      strength: 0,
      dominantPeriodCandles: null,
      logs: [`cycle engine: need ${WINDOW} candles, got ${candles.length}`],
      verify: { ok: true, absError: 0, note: 'skipped — insufficient data' },
    };
  }

  const closes = candles.slice(-WINDOW).map((c) => c.close);
  const detrended = olsDetrend(closes);
  const win = hann(WINDOW);
  const windowed = detrended.map((v, i) => v * win[i]);

  const N = nextPow2(WINDOW);
  const re = new Array(N).fill(0);
  const im = new Array(N).fill(0);
  for (let i = 0; i < WINDOW; i++) re[i] = windowed[i];
  fft(re, im);

  const half = N / 2;
  const magnitude = new Array<number>(half);
  for (let k = 0; k < half; k++) magnitude[k] = Math.hypot(re[k], im[k]);

  let bestBin = -1;
  let bestMag = 0;
  for (let k = 1; k < half; k++) {
    const period = N / k;
    if (period < MIN_PERIOD || period > MAX_PERIOD) continue;
    if (magnitude[k] > bestMag) {
      bestMag = magnitude[k];
      bestBin = k;
    }
  }

  const totalEnergy = magnitude.reduce((a, m) => a + m * m, 0) || 1e-9;

  // Parseval self-check: sum_n |x_n|^2 = (1/N) * sum_k |X_k|^2 over the FULL
  // N-point spectrum. Using only the half-spectrum `magnitude` array here
  // would silently drop the mirrored negative-frequency energy for a real
  // input and understate E_freq by ~2x — sum over all N raw re/im bins instead.
  const energyTime = windowed.reduce((a, v) => a + v * v, 0);
  let fullSpectrumEnergy = 0;
  for (let k = 0; k < N; k++) fullSpectrumEnergy += re[k] * re[k] + im[k] * im[k];
  const energyFreq = fullSpectrumEnergy / N;
  const absError = Math.abs(energyTime - energyFreq) / (energyTime + 1e-9);
  const verify = {
    ok: absError < 0.15,
    absError,
    note: `Parseval check: E_time=${energyTime.toFixed(4)}, E_freq=${energyFreq.toFixed(4)}`,
  };

  if (bestBin < 0) {
    logs.push(`cycle engine: no bin between ${MIN_PERIOD}-${MAX_PERIOD} candles dominates — no verifiable cycle`);
    return { trend: 'neutral', strength: 0, dominantPeriodCandles: null, logs, verify };
  }

  const dominantPeriodCandles = N / bestBin;
  const strength = Math.max(0, Math.min(100, ((bestMag * bestMag) / totalEnergy) * 100));

  if (strength < MIN_STRENGTH_PCT) {
    logs.push(
      `cycle engine: strongest bin (period≈${dominantPeriodCandles.toFixed(1)}) only ${strength.toFixed(1)}% of spectral energy — below the ${MIN_STRENGTH_PCT}% floor, reporting as no cycle`,
    );
    return { trend: 'neutral', strength, dominantPeriodCandles: null, logs, verify };
  }

  // Reconstruct just the dominant sinusoid at the last two sample points to
  // read its local direction (rising vs falling edge of the cycle).
  const reconstruct = (t: number) => {
    const theta = (2 * Math.PI * bestBin * t) / N;
    return (2 / N) * (re[bestBin] * Math.cos(theta) - im[bestBin] * Math.sin(theta));
  };
  const last = reconstruct(WINDOW - 1);
  const prev = reconstruct(WINDOW - 2);
  const slope = last - prev;
  const trend: Trend = Math.abs(slope) < 1e-9 ? 'neutral' : slope > 0 ? 'bullish' : 'bearish';

  logs.push(
    `cycle engine: dominant period≈${dominantPeriodCandles.toFixed(1)} candles, strength=${strength.toFixed(1)}, dir=${trend}`,
    `verify: ${verify.ok ? 'PASS' : 'FAIL'} (${verify.note})`,
  );

  return { trend, strength, dominantPeriodCandles, logs, verify };
}
