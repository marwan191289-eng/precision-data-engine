import type { Candle, Pivot } from './types';
import { wilderATR } from './math';

export interface PivotParams {
  leftBars: number;
  rightBars: number;
  minSwingPct: number; // minimum swing size relative to ATR to accept a pivot
}

/**
 * Volatility-adaptive pivot detection window: tighter in calm markets (more
 * pivots -> more Elliott/SMC granularity), wider in volatile markets (fewer,
 * higher-conviction pivots).
 */
export function getDynamicPivotParams(candles: Candle[]): PivotParams {
  if (candles.length < 20) {
    return { leftBars: 3, rightBars: 3, minSwingPct: 0.05 };
  }
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const atr = wilderATR(highs, lows, closes, 14);
  const lastPrice = closes[closes.length - 1];
  const atrPct = lastPrice > 0 ? atr / lastPrice : 0;

  // Low volatility -> smaller window to catch minor swings.
  // High volatility -> larger window to avoid noise pivots.
  let bars = 3;
  if (atrPct > 0.006) bars = 4;
  if (atrPct > 0.012) bars = 5;
  if (atrPct > 0.02) bars = 7;

  return {
    leftBars: bars,
    rightBars: bars,
    minSwingPct: Math.max(0.02, atrPct * 0.8),
  };
}

/**
 * Confirmed swing high/low detection using a symmetric left/right lookback
 * window, with an ATR-relative minimum swing filter to reject noise pivots.
 */
export function getPivotPoints(candles: Candle[], params: PivotParams): Pivot[] {
  const { leftBars, rightBars, minSwingPct } = params;
  const pivots: Pivot[] = [];
  const n = candles.length;
  if (n < leftBars + rightBars + 1) return pivots;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const atr = wilderATR(highs, lows, closes, 14) || closes[closes.length - 1] * 0.01;

  for (let i = leftBars; i < n - rightBars; i++) {
    const window = candles.slice(i - leftBars, i + rightBars + 1);
    const highWindow = window.map((c) => c.high);
    const lowWindow = window.map((c) => c.low);

    const isHigh = candles[i].high === Math.max(...highWindow);
    const isLow = candles[i].low === Math.min(...lowWindow);

    if (isHigh) {
      const prevPivot = pivots[pivots.length - 1];
      const swing = prevPivot ? Math.abs(candles[i].high - prevPivot.price) : atr;
      if (!prevPivot || prevPivot.type !== 'high' || swing / atr >= minSwingPct * 10) {
        if (swing >= atr * minSwingPct * 5 || !prevPivot) {
          pivots.push({ index: i, time: candles[i].time, price: candles[i].high, type: 'high' });
        }
      }
    } else if (isLow) {
      const prevPivot = pivots[pivots.length - 1];
      const swing = prevPivot ? Math.abs(candles[i].low - prevPivot.price) : atr;
      if (!prevPivot || prevPivot.type !== 'low' || swing / atr >= minSwingPct * 10) {
        if (swing >= atr * minSwingPct * 5 || !prevPivot) {
          pivots.push({ index: i, time: candles[i].time, price: candles[i].low, type: 'low' });
        }
      }
    }
  }

  // Collapse consecutive same-type pivots, keeping the more extreme one.
  const collapsed: Pivot[] = [];
  for (const p of pivots) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.type === p.type) {
      const keepNew =
        (p.type === 'high' && p.price >= last.price) ||
        (p.type === 'low' && p.price <= last.price);
      if (keepNew) collapsed[collapsed.length - 1] = p;
    } else {
      collapsed.push(p);
    }
  }

  return collapsed;
}
