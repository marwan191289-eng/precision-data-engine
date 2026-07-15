// Market Regime Detector
// Classifies the current market state so the integration hub can adaptively
// re-weight downstream engines (SMC dominates in ranges, Elliott/LSTM in
// trends, CVD gains weight in breakouts).

import type { Candle } from './types';
import { adx, atrSeries, hurstExponent, kaufmanER, normalizedSlope, quantile } from './math';

export type RegimeKind = 'strong-trend' | 'weak-trend' | 'range' | 'breakout' | 'chop';

export interface RegimeReading {
  kind: RegimeKind;
  direction: 'up' | 'down' | 'flat';
  confidence: number; // 0..100
  hurst: number;
  efficiencyRatio: number;
  adx: number;
  volatilityPct: number; // ATR / price
  volatilityPercentile: number; // 0..1 within recent history
  logs: string[];
}

export function detectRegime(candles: Candle[]): RegimeReading {
  const logs: string[] = [];
  if (candles.length < 40) {
    return {
      kind: 'chop',
      direction: 'flat',
      confidence: 20,
      hurst: 0.5,
      efficiencyRatio: 0,
      adx: 0,
      volatilityPct: 0,
      volatilityPercentile: 0.5,
      logs: ['insufficient candles for regime detection'],
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const price = closes[closes.length - 1];

  const H = hurstExponent(closes, Math.min(30, Math.floor(closes.length / 3)));
  const ER = kaufmanER(closes, 20);
  const A = adx(highs, lows, closes, 14);
  const atrs = atrSeries(highs, lows, closes, 14);
  const atr = atrs[atrs.length - 1];
  const volPct = price > 0 ? atr / price : 0;
  const recentAtrPct = atrs.slice(-100).map((v, i, arr) => v / (closes.slice(-100)[i] || 1));
  const q80 = quantile(recentAtrPct, 0.8);
  const q20 = quantile(recentAtrPct, 0.2);
  const volPctile = q80 === q20 ? 0.5 : Math.max(0, Math.min(1, (volPct - q20) / (q80 - q20)));

  const slope = normalizedSlope(closes, 30);
  const direction: RegimeReading['direction'] =
    Math.abs(slope) < 0.0005 ? 'flat' : slope > 0 ? 'up' : 'down';

  // Composite regime scoring — every signal casts a vote 0..1.
  const trendVote = 0.4 * Math.max(0, (H - 0.5) * 2) + 0.4 * ER + 0.2 * Math.min(1, A / 40);
  const rangeVote = 0.5 * Math.max(0, (0.5 - H) * 2) + 0.5 * (1 - ER);
  const breakoutVote = volPctile > 0.75 && ER > 0.35 ? 0.6 + 0.4 * ER : 0;

  let kind: RegimeKind;
  let confidence: number;
  if (breakoutVote > 0.55 && trendVote > 0.45) {
    kind = 'breakout';
    confidence = Math.round(60 + breakoutVote * 30);
  } else if (trendVote > 0.6 && A > 22) {
    kind = 'strong-trend';
    confidence = Math.round(60 + trendVote * 35);
  } else if (trendVote > 0.4) {
    kind = 'weak-trend';
    confidence = Math.round(45 + trendVote * 35);
  } else if (rangeVote > 0.5) {
    kind = 'range';
    confidence = Math.round(45 + rangeVote * 40);
  } else {
    kind = 'chop';
    confidence = Math.round(30 + (1 - Math.abs(H - 0.5) * 2) * 20);
  }

  logs.push(
    `regime=${kind} dir=${direction} H=${H.toFixed(2)} ER=${ER.toFixed(2)} ADX=${A.toFixed(1)} volPctile=${volPctile.toFixed(2)}`,
  );

  return {
    kind,
    direction,
    confidence,
    hurst: H,
    efficiencyRatio: ER,
    adx: A,
    volatilityPct: volPct,
    volatilityPercentile: volPctile,
    logs,
  };
}

/** Per-regime weight multipliers applied to each engine in the hub. */
export function regimeWeightProfile(kind: RegimeKind): Record<string, number> {
  switch (kind) {
    case 'strong-trend':
      // Cycles are least meaningful when price is trending hard in one direction.
      return { elliott: 1.25, cvd: 1.15, smc: 0.85, lstm: 1.2, cycle: 0.5 };
    case 'weak-trend':
      return { elliott: 1.1, cvd: 1.05, smc: 1.0, lstm: 1.05, cycle: 0.8 };
    case 'breakout':
      // A breakout can be the start of a new cycle phase or invalidate the old one — keep it neutral-low.
      return { elliott: 1.05, cvd: 1.3, smc: 1.1, lstm: 1.15, cycle: 0.7 };
    case 'range':
      // Ranging/oscillating price is exactly where a dominant spectral cycle is most plausible.
      return { elliott: 0.75, cvd: 0.9, smc: 1.35, lstm: 0.9, cycle: 1.3 };
    case 'chop':
    default:
      return { elliott: 0.7, cvd: 0.8, smc: 1.1, lstm: 0.7, cycle: 1.0 };
  }
}
