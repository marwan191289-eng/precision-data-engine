// Shared numeric helpers used across every analysis engine.
// v2 — extended with robust statistics, regime helpers, and calibration utilities.
// Kept dependency-free and allocation-light since they run on every closed candle.

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (const v of values) sumSq += (v - m) * (v - m);
  return Math.sqrt(sumSq / (values.length - 1));
}

export function zScore(value: number, values: number[]): number {
  const sd = stdDev(values);
  if (sd === 0) return 0;
  return (value - mean(values)) / sd;
}

/** Robust z-score using median and MAD — resistant to outliers/wicks. */
export function robustZ(value: number, values: number[]): number {
  if (values.length < 2) return 0;
  const m = median(values);
  const mad = median(values.map((v) => Math.abs(v - m))) || 1e-9;
  return (value - m) / (1.4826 * mad);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  return mean(values.slice(-period));
}

/** Exponential moving average series (same length as input). */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function lastEma(values: number[], period: number): number {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : 0;
}

/** MACD histogram series — momentum acceleration proxy. */
export function macdHistSeries(values: number[], fast = 12, slow = 26, signal = 9): number[] {
  const efast = emaSeries(values, fast);
  const eslow = emaSeries(values, slow);
  const macd = efast.map((v, i) => v - eslow[i]);
  const sig = emaSeries(macd, signal);
  return macd.map((v, i) => v - sig[i]);
}

/** Bollinger %B — where price sits relative to bands, 0..1 typical. */
export function bollingerPercentBSeries(closes: number[], period = 20, mult = 2): number[] {
  const out = new Array(closes.length).fill(0.5);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const m = mean(slice);
    const sd = stdDev(slice);
    if (sd === 0) continue;
    const upper = m + mult * sd;
    const lower = m - mult * sd;
    out[i] = clamp((closes[i] - lower) / (upper - lower), -0.5, 1.5);
  }
  return out;
}

/** Wilder's ATR (Average True Range), returns the latest value. */
export function wilderATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const n = highs.length;
  if (n < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  if (trs.length === 0) return 0;
  const p = Math.min(period, trs.length);
  let atr = mean(trs.slice(0, p));
  for (let i = p; i < trs.length; i++) atr = (atr * (p - 1) + trs[i]) / p;
  return atr;
}

export function atrSeries(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = highs.length;
  const out = new Array(n).fill(0);
  if (n < 2) return out;
  const trs: number[] = [0];
  for (let i = 1; i < n; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  const p = Math.min(period, n - 1);
  let atr = mean(trs.slice(1, p + 1));
  out[p] = atr;
  for (let i = p + 1; i < n; i++) {
    atr = (atr * (p - 1) + trs[i]) / p;
    out[i] = atr;
  }
  return out;
}

/** Wilder's RSI series (aligned to closes length). */
export function rsiSeries(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number {
  const s = rsiSeries(closes, period);
  return s.length ? s[s.length - 1] : 50;
}

/** ADX (Wilder) — trend strength 0..100, latest value. */
export function adx(highs: number[], lows: number[], closes: number[], period = 14): number {
  const n = highs.length;
  if (n < period + 2) return 0;
  const tr: number[] = [];
  const pdm: number[] = [];
  const ndm: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  const smooth = (arr: number[]) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };
  const trS = smooth(tr);
  const pS = smooth(pdm);
  const nS = smooth(ndm);
  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pDI = (100 * pS[i]) / (trS[i] || 1e-9);
    const nDI = (100 * nS[i]) / (trS[i] || 1e-9);
    dx.push((100 * Math.abs(pDI - nDI)) / (pDI + nDI || 1e-9));
  }
  if (dx.length < period) return mean(dx);
  let a = mean(dx.slice(0, period));
  for (let i = period; i < dx.length; i++) a = (a * (period - 1) + dx[i]) / period;
  return a;
}

/** Kaufman Efficiency Ratio — |net move| / sum(|per-step moves|). 0..1, high = trending. */
export function kaufmanER(closes: number[], window = 20): number {
  const n = closes.length;
  if (n < window + 1) return 0;
  const slice = closes.slice(-window - 1);
  const net = Math.abs(slice[slice.length - 1] - slice[0]);
  let path = 0;
  for (let i = 1; i < slice.length; i++) path += Math.abs(slice[i] - slice[i - 1]);
  return path === 0 ? 0 : clamp(net / path, 0, 1);
}

/** Hurst exponent (rescaled-range, simplified). ~0.5 random walk, >0.5 trending, <0.5 mean-reverting. */
export function hurstExponent(values: number[], maxLag = 20): number {
  if (values.length < maxLag + 2) return 0.5;
  const lags: number[] = [];
  const rs: number[] = [];
  for (let lag = 2; lag <= maxLag; lag++) {
    const diffs: number[] = [];
    for (let i = lag; i < values.length; i++) diffs.push(values[i] - values[i - lag]);
    const s = stdDev(diffs);
    if (s > 0) {
      lags.push(Math.log(lag));
      rs.push(Math.log(s));
    }
  }
  if (lags.length < 3) return 0.5;
  // linear regression slope = Hurst estimator
  const xm = mean(lags);
  const ym = mean(rs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < lags.length; i++) {
    num += (lags[i] - xm) * (rs[i] - ym);
    den += (lags[i] - xm) ** 2;
  }
  return clamp(den === 0 ? 0.5 : num / den, 0, 1);
}

/** Linear-regression slope over last `window`, normalized by |mean(y)|. */
export function normalizedSlope(values: number[], window: number): number {
  const slice = values.slice(-window);
  const n = slice.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(slice);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (slice[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  if (den === 0 || yMean === 0) return 0;
  return num / den / Math.abs(yMean);
}

/** Fibonacci-ratio closeness score in [0, 1]. */
export function fibonacciScore(ratio: number, targets: number[], tolerance = 0.12): number {
  let best = 0;
  for (const target of targets) {
    const diff = Math.abs(ratio - target) / Math.max(target, 0.001);
    const score = Math.max(0, 1 - diff / tolerance);
    if (score > best) best = score;
  }
  return best;
}

/** O(n) trailing-window mean, aligned to input. */
export function slidingWindowAverage(values: number[], window: number): number[] {
  const n = values.length;
  const out = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

/** O(n) trailing-window standard deviation (Welford-style). */
export function slidingWindowStd(values: number[], window: number): number[] {
  const n = values.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    out[i] = stdDev(values.slice(start, i + 1));
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return (to - from) / from;
}

export function logReturn(from: number, to: number): number {
  if (from <= 0 || to <= 0) return 0;
  return Math.log(to / from);
}

/** Numerically stable sigmoid. */
export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/** Convert probability p ∈ (0,1) to log-odds (logit). */
export function logit(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(q / (1 - q));
}

/** Temperature-scale a probability via logit / T. T>1 softens, T<1 sharpens. */
export function temperatureScale(p: number, T: number): number {
  if (T <= 0) return p;
  return sigmoid(logit(p) / T);
}

/** Grid-search a temperature T ∈ [0.5, 3.0] minimizing binary log-loss on (p, y). */
export function fitTemperature(probs: number[], labels: number[]): number {
  if (probs.length === 0) return 1;
  const grid: number[] = [];
  for (let t = 0.5; t <= 3.0001; t += 0.05) grid.push(+t.toFixed(2));
  let bestT = 1;
  let bestLoss = Infinity;
  for (const T of grid) {
    let loss = 0;
    for (let i = 0; i < probs.length; i++) {
      const p = clamp(temperatureScale(probs[i], T), 1e-6, 1 - 1e-6);
      loss += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
    }
    loss /= probs.length;
    if (loss < bestLoss) {
      bestLoss = loss;
      bestT = T;
    }
  }
  return bestT;
}

/** Brier score — lower is better calibrated. */
export function brierScore(probs: number[], labels: number[]): number {
  if (probs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i] - labels[i]) ** 2;
  return s / probs.length;
}
