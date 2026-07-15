// Verification / audit layer.
//
// Ported in spirit from precision-data-engine's `verify(input, result)`
// pattern: every scientific engine there re-derives its answer through an
// independent method and reports the absolute error. This module brings the
// same discipline to the trading engines — it does NOT change the trading
// decision, it only measures how much the primary engines agree with an
// independent recomputation, and surfaces that honestly to the UI and the
// audit log.
//
// This is intentionally conservative: an engine disagreeing with its check
// is not "wrong" (markets are not closed-form problems the way an integral
// is), it is a transparency signal — "here is how much independent
// corroboration this specific run had."

import type { Candle, ElliottResult, LSTMPrediction, Trend } from './types';
import type { RegimeReading } from './regimeEngine';
import { normalizedSlope } from './math';
import { statisticalEnsemble } from './lstmEngine';

export interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AuditResult {
  score: number; // 0-100, share of checks that passed
  checks: CheckItem[];
  logs: string[];
}

function trendSign(t: Trend): number {
  return t === 'bullish' ? 1 : t === 'bearish' ? -1 : 0;
}

/**
 * Cross-check the regime direction against a plain OLS slope over the same
 * window regimeEngine uses internally (30 candles). This does not re-derive
 * Hurst/ADX/ER — it only checks that the *directional* read is consistent
 * with the simplest possible estimator, as a sanity floor.
 */
function checkRegimeDirection(candles: Candle[], regime: RegimeReading): CheckItem {
  const closes = candles.map((c) => c.close);
  const slope = normalizedSlope(closes, 30);
  const independentDir = Math.abs(slope) < 0.0005 ? 'flat' : slope > 0 ? 'up' : 'down';
  const ok = independentDir === regime.direction || regime.direction === 'flat' || independentDir === 'flat';
  return {
    name: 'Regime direction (independent OLS slope)',
    ok,
    detail: `regime.direction=${regime.direction}, independent=${independentDir}, slope=${slope.toFixed(5)}`,
  };
}

/**
 * Cross-check the LSTM prediction against the statistical ensemble
 * regardless of which one is the "primary" model source. If the neural
 * model and the transparent statistical fallback disagree on direction,
 * that is exactly the kind of thing a trader should be told about plainly.
 */
function checkLstmAgreement(candles: Candle[], lstm: LSTMPrediction): CheckItem {
  if (candles.length < 30) {
    return { name: 'LSTM vs statistical ensemble', ok: true, detail: 'skipped — insufficient candles' };
  }
  const ensemble = statisticalEnsemble(candles);
  const ok = ensemble.direction === lstm.direction;
  return {
    name: 'LSTM vs statistical ensemble',
    ok,
    detail: `lstm=${lstm.direction} (${lstm.modelSource}, conf ${lstm.confidence.toFixed(0)}), ensemble=${ensemble.direction} (conf ${ensemble.confidence.toFixed(0)})`,
  };
}

/** Elliott wave rule-violation check — the engine already scores this; audit just surfaces it. */
function checkElliottRuleIntegrity(elliott: ElliottResult): CheckItem {
  const seq = elliott.bestSequence;
  if (!seq) return { name: 'Elliott rule integrity', ok: true, detail: 'no active sequence' };
  const ok = seq.ruleViolations.length === 0;
  return {
    name: 'Elliott rule integrity',
    ok,
    detail: ok ? 'no rule violations in best sequence' : `violations: ${seq.ruleViolations.join('; ')}`,
  };
}

/** Do the discrete engines (Elliott/CVD/SMC) actually agree with the composite sign, or is the composite riding on LSTM/cycle alone? */
function checkStructuralAgreement(
  compositeScore: number,
  elliottTrend: Trend,
  cvdTrend: Trend,
  smcTrend: Trend,
): CheckItem {
  const compositeSign = compositeScore > 5 ? 1 : compositeScore < -5 ? -1 : 0;
  const votes = [elliottTrend, cvdTrend, smcTrend].map(trendSign);
  const agreeing = votes.filter((v) => v === compositeSign && v !== 0).length;
  const ok = compositeSign === 0 || agreeing >= 1;
  return {
    name: 'Structural engines support composite direction',
    ok,
    detail: `composite sign=${compositeSign}, agreeing structural engines=${agreeing}/3`,
  };
}

export function runAudit(params: {
  candles: Candle[];
  regime: RegimeReading;
  elliott: ElliottResult;
  cvdTrend: Trend;
  smcTrend: Trend;
  lstm: LSTMPrediction;
  compositeScore: number;
}): AuditResult {
  const { candles, regime, elliott, cvdTrend, smcTrend, lstm, compositeScore } = params;
  const checks: CheckItem[] = [
    checkRegimeDirection(candles, regime),
    checkLstmAgreement(candles, lstm),
    checkElliottRuleIntegrity(elliott),
    checkStructuralAgreement(compositeScore, elliott.trend, cvdTrend, smcTrend),
  ];
  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const logs = checks.map((c) => `${c.ok ? 'PASS' : 'FLAG'} — ${c.name}: ${c.detail}`);
  return { score, checks, logs };
}
