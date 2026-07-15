import type { Candle, FairValueGap } from './types';

/**
 * Fair Value Gaps: a 3-candle imbalance where candle[i-1].high < candle[i+1].low
 * (bullish gap) or candle[i-1].low > candle[i+1].high (bearish gap). Fill
 * probability decays with gap age and grows with proximity to current price.
 */
export function detectFairValueGaps(candles: Candle[]): FairValueGap[] {
  if (candles.length < 5) return [];

  const gaps: FairValueGap[] = [];
  const lastPrice = candles[candles.length - 1].close;

  for (let i = 1; i < candles.length - 1; i++) {
    const left = candles[i - 1];
    const right = candles[i + 1];
    const mid = candles[i];

    if (left.high < right.low) {
      const top = right.low;
      const bottom = left.high;
      const size = top - bottom;
      const displacement = Math.abs(mid.close - mid.open) / Math.max(mid.high - mid.low, 1e-9);

      let filled = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].low <= bottom) {
          filled = true;
          break;
        }
      }

      const age = candles.length - 1 - i;
      const distancePct = Math.abs(lastPrice - (top + bottom) / 2) / lastPrice;
      const fillProbability = filled
        ? 100
        : Math.max(10, Math.min(95, 80 - age * 0.5 - distancePct * 500));
      const strength = Math.min(100, displacement * 60 + Math.min(30, (size / lastPrice) * 5000));

      gaps.push({ index: i, time: mid.time, type: 'bullish', top, bottom, fillProbability, strength, filled });
    }

    if (left.low > right.high) {
      const top = left.low;
      const bottom = right.high;
      const size = top - bottom;
      const displacement = Math.abs(mid.close - mid.open) / Math.max(mid.high - mid.low, 1e-9);

      let filled = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].high >= top) {
          filled = true;
          break;
        }
      }

      const age = candles.length - 1 - i;
      const distancePct = Math.abs(lastPrice - (top + bottom) / 2) / lastPrice;
      const fillProbability = filled
        ? 100
        : Math.max(10, Math.min(95, 80 - age * 0.5 - distancePct * 500));
      const strength = Math.min(100, displacement * 60 + Math.min(30, (size / lastPrice) * 5000));

      gaps.push({ index: i, time: mid.time, type: 'bearish', top, bottom, fillProbability, strength, filled });
    }
  }

  return gaps.slice(-20);
}
