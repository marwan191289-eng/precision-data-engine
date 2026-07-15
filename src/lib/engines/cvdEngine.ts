import type { Candle, CVDDivergence, CVDPoint, CVDResult, Trend } from './types';
import { emaSeries, normalizedSlope, rsiSeries, mean, stdDev } from './math';
import { getDynamicPivotParams, getPivotPoints } from './pivots';

/** Estimate per-candle taker buy/sell delta with CLV fallback. */
function candleDelta(c: Candle): number {
  if (c.volume > 0 && c.takerBuyBaseVolume >= 0 && c.takerBuyBaseVolume <= c.volume) {
    return c.takerBuyBaseVolume - (c.volume - c.takerBuyBaseVolume);
  }
  const range = c.high - c.low;
  if (range === 0) return 0;
  return ((c.close - c.low - (c.high - c.close)) / range) * c.volume;
}

/** On-Balance Volume series — confirms or diverges from price trend. */
function obvSeries(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close)      obv += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
    out[i] = obv;
  }
  return out;
}

/** Taker buy ratio: 0=full sell pressure, 1=full buy pressure. */
function takerBuyRatio(c: Candle): number {
  if (c.volume <= 0) return 0.5;
  return Math.max(0, Math.min(1, c.takerBuyBaseVolume / c.volume));
}

/** SMA of the taker buy ratio — smoothed buying-pressure index. */
function smaBuyRatioSeries(candles: Candle[], period: number): number[] {
  const ratios = candles.map(takerBuyRatio);
  const out: number[] = new Array(candles.length).fill(0.5);
  for (let i = period - 1; i < candles.length; i++) {
    out[i] = mean(ratios.slice(i - period + 1, i + 1));
  }
  return out;
}

/** Detect hidden divergences (continuation signals):
 *  Hidden bull: price higher low, CVD lower low → trend continuation up.
 *  Hidden bear: price lower high, CVD higher high → trend continuation down.
 */
function detectDivergences(
  pricePivots: ReturnType<typeof getPivotPoints>,
  smoothed: number[],
): CVDDivergence[] {
  const divergences: CVDDivergence[] = [];
  const highs = pricePivots.filter((p) => p.type === 'high').slice(-6);
  const lows  = pricePivots.filter((p) => p.type === 'low').slice(-6);

  // Regular bearish: price higher high, CVD lower high
  for (let i = 1; i < highs.length; i++) {
    const a = highs[i - 1], b = highs[i];
    if (b.price > a.price) {
      const ca = smoothed[a.index] ?? 0, cb = smoothed[b.index] ?? 0;
      if (cb < ca) {
        const magnitude = Math.min(100, ((ca - cb) / (Math.abs(ca) + 1)) * 100 + 30);
        divergences.push({ type: 'bearish', priceIndex: b.index, cvdIndex: b.index,
          strength: magnitude, description: 'تباين هبوطي: سعر أعلى قمة · CVD قمة أدنى — ضغط الشراء يتراجع' });
      }
    }
    // Hidden bearish: price lower high, CVD higher high
    if (b.price < a.price) {
      const ca = smoothed[a.index] ?? 0, cb = smoothed[b.index] ?? 0;
      if (cb > ca) {
        const magnitude = Math.min(100, ((cb - ca) / (Math.abs(ca) + 1)) * 80 + 20);
        divergences.push({ type: 'bearish', priceIndex: b.index, cvdIndex: b.index,
          strength: magnitude, description: 'تباين هبوطي خفي: سعر قمة أدنى · CVD قمة أعلى — استمرار هبوطي' });
      }
    }
  }

  // Regular bullish: price lower low, CVD higher low
  for (let i = 1; i < lows.length; i++) {
    const a = lows[i - 1], b = lows[i];
    if (b.price < a.price) {
      const ca = smoothed[a.index] ?? 0, cb = smoothed[b.index] ?? 0;
      if (cb > ca) {
        const magnitude = Math.min(100, ((cb - ca) / (Math.abs(ca) + 1)) * 100 + 30);
        divergences.push({ type: 'bullish', priceIndex: b.index, cvdIndex: b.index,
          strength: magnitude, description: 'تباين صعودي: سعر قاع أدنى · CVD قاع أعلى — ضغط البيع يتراجع' });
      }
    }
    // Hidden bullish: price higher low, CVD lower low
    if (b.price > a.price) {
      const ca = smoothed[a.index] ?? 0, cb = smoothed[b.index] ?? 0;
      if (cb < ca) {
        const magnitude = Math.min(100, ((ca - cb) / (Math.abs(ca) + 1)) * 80 + 20);
        divergences.push({ type: 'bullish', priceIndex: b.index, cvdIndex: b.index,
          strength: magnitude, description: 'تباين صعودي خفي: سعر قاع أعلى · CVD قاع أدنى — استمرار صعودي' });
      }
    }
  }

  // Deduplicate: keep only the most recent per price index
  const seen = new Map<number, CVDDivergence>();
  for (const d of divergences) {
    const existing = seen.get(d.priceIndex);
    if (!existing || d.strength > existing.strength) seen.set(d.priceIndex, d);
  }
  return Array.from(seen.values()).sort((a, b) => b.priceIndex - a.priceIndex);
}

// ── Session CVD store ────────────────────────────────────────────────────────
// Maintains true cumulative CVD across API refreshes so the series never
// resets to zero mid-session (previously it restarted every 500-candle fetch).
interface CVDStore {
  timeToValue: Map<number, number>; // candle closeTime → cumDelta
  runningTotal: number;             // cumDelta at newestTime
  newestTime: number;
}
const cvdSessionStore = new Map<string, CVDStore>();
const CVD_STORE_MAX = 3000; // prune oldest entries beyond this limit

function getSessionCVDValues(candles: Candle[], sessionKey: string): number[] {
  const store = cvdSessionStore.get(sessionKey);

  if (!store) {
    // First call — build the store from scratch
    let cum = 0;
    const timeToValue = new Map<number, number>();
    for (const c of candles) {
      cum += candleDelta(c);
      timeToValue.set(c.time, cum);
    }
    cvdSessionStore.set(sessionKey, {
      timeToValue,
      runningTotal: cum,
      newestTime: candles[candles.length - 1].time,
    });
    return candles.map((c) => timeToValue.get(c.time) ?? cum);
  }

  // Append only NEW candles (those after our newest stored time)
  const newCandles = candles.filter((c) => c.time > store.newestTime);
  let cum = store.runningTotal;
  for (const c of newCandles) {
    cum += candleDelta(c);
    store.timeToValue.set(c.time, cum);
  }
  if (newCandles.length > 0) {
    store.runningTotal = cum;
    store.newestTime = newCandles[newCandles.length - 1].time;
  }

  // Prune oldest entries to cap memory
  if (store.timeToValue.size > CVD_STORE_MAX) {
    const sorted = [...store.timeToValue.keys()].sort((a, b) => a - b);
    for (const t of sorted.slice(0, store.timeToValue.size - CVD_STORE_MAX)) {
      store.timeToValue.delete(t);
    }
  }

  // Return an array aligned to the current candles slice
  return candles.map((c) => store.timeToValue.get(c.time) ?? 0);
}

/** Call when the user switches symbol or interval to reset the session baseline. */
export function resetCVDSession(sessionKey: string): void {
  cvdSessionStore.delete(sessionKey);
}

// Extended CVDResult — we add OBV trend and buy pressure to the existing type
// by returning them inside `logs` so we don't break the shared type contract.
export function analyzeCVD(candles: Candle[], sessionKey?: string): CVDResult & {
  ema9: number[];
  ema21: number[];
  obv: number[];
  obvTrend: Trend;
  buyPressure: number;
} {
  const logs: string[] = [];
  const empty = {
    series: [], smoothed: [], trend: 'neutral' as Trend, slope: 0, strength: 0,
    divergences: [], logs,
    ema9: [], ema21: [], obv: [], obvTrend: 'neutral' as Trend, buyPressure: 50,
  };

  if (candles.length < 20) {
    logs.push(`Insufficient candles for CVD analysis (${candles.length}/20 minimum)`);
    return empty;
  }

  // ── Cumulative Volume Delta ──────────────────────────────────────────────
  // When a sessionKey is provided, values continue from the previous refresh
  // so the series never resets mid-session (true session CVD).
  const cumulativeValues = sessionKey
    ? getSessionCVDValues(candles, sessionKey)
    : (() => {
        let cum = 0;
        return candles.map((c) => { cum += candleDelta(c); return cum; });
      })();

  const series: CVDPoint[] = candles.map((c, i) => ({
    index: i,
    time: c.time,
    value: cumulativeValues[i],
    delta: candleDelta(c),
  }));

  const raw      = series.map((p) => p.value);
  const ema9val  = emaSeries(raw, 9);
  const ema21val = emaSeries(raw, 21);
  const smoothed = ema9val; // primary smoothed series for divergence / chart

  const slope    = normalizedSlope(smoothed, 20);
  const trend: Trend = slope > 0.0005 ? 'bullish' : slope < -0.0005 ? 'bearish' : 'neutral';
  const strength = Math.min(100, Math.abs(slope) * 20000);

  // ── OBV ─────────────────────────────────────────────────────────────────
  const obv = obvSeries(candles);
  const obvSmooth = emaSeries(obv, 14);
  const obvSlope  = normalizedSlope(obvSmooth, 20);
  const obvTrend: Trend = obvSlope > 0.00005 ? 'bullish' : obvSlope < -0.00005 ? 'bearish' : 'neutral';

  // ── Buy pressure index ───────────────────────────────────────────────────
  const buyRatioSMA = smaBuyRatioSeries(candles, 20);
  const buyPressure = Math.round(buyRatioSMA[buyRatioSMA.length - 1] * 100);

  // ── Divergences ──────────────────────────────────────────────────────────
  const priceParams  = getDynamicPivotParams(candles);
  const pricePivots  = getPivotPoints(candles, priceParams);
  const divergences  = detectDivergences(pricePivots, smoothed);

  // ── CVD / OBV agreement bonus ────────────────────────────────────────────
  const agree = trend === obvTrend && trend !== 'neutral';
  if (agree) logs.push(`CVD and OBV agree (${trend}) — signal reinforced`);

  // ── Strength boost when OBV confirms ────────────────────────────────────
  const confirmedStrength = agree ? Math.min(100, strength * 1.25) : strength;

  logs.push(
    `CVD trend=${trend} slope=${slope.toFixed(5)} strength=${confirmedStrength.toFixed(1)} ` +
    `OBV=${obvTrend} buyPressure=${buyPressure}% divergences=${divergences.length}`,
  );

  return {
    series, smoothed, trend, slope,
    strength: confirmedStrength,
    divergences,
    logs,
    ema9: ema9val,
    ema21: ema21val,
    obv,
    obvTrend,
    buyPressure,
  };
}
