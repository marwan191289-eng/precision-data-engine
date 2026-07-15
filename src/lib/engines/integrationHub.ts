import type { Candle, ConfluenceSignal, DataQuality, FullAnalysisResult, Trend } from './types';
import { getDynamicPivotParams, getPivotPoints } from './pivots';
import { matchElliottWaves } from './elliottEngine';
import { analyzeCVD } from './cvdEngine';
import { analyzeSMC } from './smcEngine';
import { runLSTMPrediction } from './lstmEngine';
import { detectRegime, regimeWeightProfile, type RegimeReading } from './regimeEngine';
import { clamp, logit, sigmoid, stdDev } from './math';
import { detectDominantCycle } from './cycleEngine';
import { runAudit } from './verify';
import { checksum } from './checksum';
import { saveAnalysisRun } from '../db';

const MIN_CANDLES = 50;

function assessDataQuality(candles: Candle[]): DataQuality {
  const reasons: string[] = [];
  let score = 100;
  if (candles.length < MIN_CANDLES) {
    reasons.push(`Only ${candles.length}/${MIN_CANDLES} candles available`);
    score -= 40;
  }
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const dt = candles[i].time - candles[i - 1].time;
    if (dt > 60000 * 1.5) gaps++;
  }
  if (gaps > 0) {
    reasons.push(`${gaps} time gap(s) detected in candle stream`);
    score -= Math.min(30, gaps * 5);
  }
  const zeroVol = candles.filter((c) => c.volume === 0).length;
  if (zeroVol > candles.length * 0.1) {
    reasons.push('High proportion of zero-volume candles');
    score -= 15;
  }
  return { score: Math.max(0, score), candleCount: candles.length, gapsDetected: gaps, reasons };
}

function trendSign(t: Trend): number {
  return t === 'bullish' ? 1 : t === 'bearish' ? -1 : 0;
}

/**
 * Convert an engine reading (direction, magnitude 0..100) into a
 * probability of "up" in [0.05, 0.95]. Neutral maps to 0.5.
 */
function toProb(trend: Trend, magnitude: number): number {
  const sign = trendSign(trend);
  if (sign === 0) return 0.5;
  const p = 0.5 + sign * clamp(magnitude, 0, 100) * 0.0045; // max shift ≈ ±0.45
  return clamp(p, 0.05, 0.95);
}

/** Monte-Carlo uncertainty via bootstrap perturbation of recent returns. */
function estimateUncertainty(candles: Candle[], compositeScore: number): number {
  const closes = candles.map((c) => c.close);
  const rets = closes.slice(-30).map((c, i, arr) => (i === 0 ? 0 : (c - arr[i - 1]) / arr[i - 1]));
  const vol = stdDev(rets) || 0.001;
  const trials = 60;
  let flips = 0;
  const baseSign = compositeScore >= 0 ? 1 : -1;
  for (let t = 0; t < trials; t++) {
    let s = 0;
    for (let i = 1; i < rets.length; i++) s += rets[i] + (Math.random() - 0.5) * 2 * vol;
    if ((s >= 0 ? 1 : -1) !== baseSign) flips++;
  }
  return Math.min(100, (flips / trials) * 100);
}

function buildAlert(
  compositeScore: number,
  dataQuality: DataQuality,
  regime: RegimeReading,
  uncertainty: number,
): string | null {
  if (dataQuality.score < 50) return null;
  const abs = Math.abs(compositeScore);
  if (abs < 30) return null;
  if (uncertainty > 65) return null;
  const dir = compositeScore > 0 ? 'صعودي (شراء)' : 'هبوطي (بيع)';
  const strength = abs > 70 ? 'قوي جداً' : abs > 50 ? 'قوي' : 'متوسط';
  const regimeLabel = ({
    'strong-trend': 'اتجاه قوي',
    'weak-trend': 'اتجاه ضعيف',
    breakout: 'اختراق',
    range: 'عرضي',
    chop: 'مضطرب',
  } as const)[regime.kind];
  return `إشارة ${strength} ${dir} — نظام السوق: ${regimeLabel} (score=${compositeScore.toFixed(0)}, uncertainty=${uncertainty.toFixed(0)}%)`;
}

/**
 * Full multi-engine analysis with Bayesian log-odds fusion.
 *
 * Fusion model:
 *   logit(p_up) = Σ w_i · logit(p_i)
 * where each engine i emits a probability of "up" (p_i) and a weight w_i
 * combining its intrinsic magnitude, its cross-engine agreement bonus, and
 * a regime-specific multiplier from the regime detector.
 */
/**
 * Run the full multi-engine analysis pipeline.
 *
 * @param candles   Full 500-candle slice including the still-building live candle.
 * @param sessionKey  Optional `${symbol}_${interval}` key.  When supplied:
 *   • Only closed candles (isClosed !== false) are fed to analysis engines,
 *     preventing the open candle from distorting Elliott / SMC / LSTM signals.
 *   • CVD keeps a session-level running total so it never resets to zero
 *     on each refresh (true cumulative CVD for the browser session).
 */
/**
 * Options for a lighter-weight run. Used by the Multi-Timeframe table which
 * scans several intervals in parallel — it must NEVER kick off LSTM training
 * on the main thread (would freeze the browser for each extra timeframe)
 * and does not need its own row in the local audit trail.
 */
export interface RunAnalysisOptions {
  /** Skip LSTM training and DB persistence. Prediction still runs on any
   *  already-loaded model, otherwise falls back to statistical ensemble. */
  lightweight?: boolean;
}

export async function runFullAnalysis(
  candles: Candle[],
  sessionKey?: string,
  opts?: RunAnalysisOptions,
): Promise<FullAnalysisResult> {
  const logs: string[] = [];
  const timestamp = Date.now();
  const lightweight = opts?.lightweight === true;

  // ── Separate live (open) candle from closed candles ──────────────────────
  // REST klines mark the last entry isClosed=false (still building).
  // All engines receive only closed bars; the chart gets the full slice.
  const closedCandles = candles.filter((c) => c.isClosed !== false);
  // Fallback: if isClosed wasn't set (e.g. from the MTF table fetching without
  // the new binance.ts), use the full slice minus the last candle.
  const engineCandles =
    closedCandles.length >= 30
      ? closedCandles
      : candles.length > 1
        ? candles.slice(0, -1)
        : candles;

  // Current price from the live candle (may be mid-bar)
  const price = candles[candles.length - 1]?.close ?? 0;

  const dataQuality = assessDataQuality(engineCandles);
  if (dataQuality.score < 30 || engineCandles.length < 30) {
    return {
      timestamp,
      price,
      dataQuality,
      pivots: [],
      elliott: null,
      cvd: null,
      smc: null,
      lstm: null,
      cycle: null,
      confluence: [],
      compositeScore: 0,
      uncertainty: 100,
      alert: null,
      logs: [`Data quality too low (score=${dataQuality.score})`],
    };
  }

  const pivotParams = getDynamicPivotParams(engineCandles);
  const pivots = getPivotPoints(engineCandles, pivotParams);

  const regime  = detectRegime(engineCandles);
  const elliott = matchElliottWaves(pivots);
  const cvd     = analyzeCVD(engineCandles, sessionKey);   // session-cumulative when key supplied
  const smc     = analyzeSMC(engineCandles, pivots, elliott, cvd);
  const lstm    = await runLSTMPrediction(engineCandles, { skipTraining: lightweight });
  const cycle   = detectDominantCycle(engineCandles);

  logs.push(...regime.logs, ...elliott.logs, ...cvd.logs, ...smc.logs, ...lstm.logs, ...cycle.logs);

  const wMul = regimeWeightProfile(regime.kind);

  // Per-engine probability of up + base weight.
  const smcMag = smc.criticalOrderBlocks.length > 0 ? 80 : smc.breakOfStructure ? 55 : 30;
  const lstmTrend: Trend = lstm.confidence < 55 ? 'neutral' : lstm.direction === 'up' ? 'bullish' : 'bearish';

  interface Engine {
    name: string;
    trend: Trend;
    prob: number;
    baseWeight: number;
    magnitude: number;
    key: keyof typeof wMul;
  }

  const engines: Engine[] = [
    {
      name: 'Elliott Wave',
      trend: elliott.trend,
      prob: toProb(elliott.trend, elliott.confidence),
      baseWeight: elliott.confidence > 0 ? 30 : 10,
      magnitude: elliott.confidence,
      key: 'elliott',
    },
    {
      name: 'CVD',
      trend: cvd.trend,
      prob: toProb(cvd.trend, cvd.strength),
      baseWeight: cvd.strength > 0 ? 25 : 10,
      magnitude: cvd.strength,
      key: 'cvd',
    },
    {
      name: 'Smart Money Concepts',
      trend: smc.bias,
      prob: toProb(smc.bias, smcMag),
      baseWeight: 25,
      magnitude: smcMag,
      key: 'smc',
    },
    {
      name: 'Deep LSTM',
      trend: lstmTrend,
      prob: toProb(lstmTrend, lstm.confidence),
      baseWeight: lstm.modelSource === 'tfjs_lstm' ? 30 : 15,
      magnitude: lstm.confidence,
      key: 'lstm',
    },
    {
      name: 'Spectral Cycle (FFT)',
      trend: cycle.trend,
      prob: toProb(cycle.trend, cycle.strength),
      // Low base weight by design — this is the newest, least battle-tested
      // engine in the hub. It earns more influence via regimeWeightProfile
      // in ranging/choppy markets where cyclical behavior is more plausible
      // than in strong trends.
      baseWeight: cycle.dominantPeriodCandles ? 15 : 5,
      magnitude: cycle.strength,
      key: 'cycle',
    },
  ];

  // Pairwise agreement bonus — engines that all lean the same way get a
  // multiplicative boost proportional to how many peers agree with them.
  const totalSigned = engines.reduce((a, e) => a + trendSign(e.trend), 0);
  const agreementBonus = (t: Trend) => {
    const s = trendSign(t);
    if (s === 0) return 1;
    const same = engines.filter((e) => trendSign(e.trend) === s).length;
    // 2/4 → 1.0, 3/4 → 1.15, 4/4 → 1.3
    return 1 + Math.max(0, same - 2) * 0.15;
  };

  const confluence: ConfluenceSignal[] = [];
  let logOddsSum = 0;
  let weightSum = 0;

  for (const e of engines) {
    const w = e.baseWeight * (wMul[e.key] ?? 1) * agreementBonus(e.trend);
    const l = logit(e.prob);
    logOddsSum += w * l;
    weightSum += w;
    confluence.push({
      name: e.name,
      direction: e.trend,
      weight: +w.toFixed(2),
      contribution: +(w * l).toFixed(3),
    });
  }

  // Elliott/CVD structural confluence bonus preserved from v1.
  if (
    elliott.bestSequence &&
    ((elliott.trend === 'bullish' && cvd.trend === 'bullish') ||
      (elliott.trend === 'bearish' && cvd.trend === 'bearish'))
  ) {
    const bonusW = 12 * (wMul.elliott + wMul.cvd) * 0.5;
    const bonusL = logit(toProb(elliott.trend, 70));
    logOddsSum += bonusW * bonusL;
    weightSum += bonusW;
    confluence.push({
      name: 'Elliott ⇄ CVD Confluence',
      direction: elliott.trend,
      weight: +bonusW.toFixed(2),
      contribution: +(bonusW * bonusL).toFixed(3),
    });
    logs.push('Elliott and CVD agree — Bayesian confluence bonus applied.');
  }

  const meanLogOdds = weightSum > 0 ? logOddsSum / weightSum : 0;
  const pUp = sigmoid(meanLogOdds);
  const compositeScore = clamp((pUp - 0.5) * 200, -100, 100);

  const baseUncertainty = estimateUncertainty(candles, compositeScore);
  // Regime confidence lowers uncertainty in strong trends, raises in chop.
  const regimeAdj = regime.kind === 'chop' ? 1.25 : regime.kind === 'strong-trend' ? 0.75 : 1.0;
  const uncertainty = clamp(baseUncertainty * regimeAdj, 0, 100);

  const alert = buildAlert(compositeScore, dataQuality, regime, uncertainty);

  logs.push(
    `Bayesian fusion: p(up)=${pUp.toFixed(3)} → score=${compositeScore.toFixed(1)} | regime=${regime.kind} (conf ${regime.confidence}) | uncertainty=${uncertainty.toFixed(1)}`,
  );

  // ── Transparency layer: independent cross-checks + reproducible fingerprint ──
  const audit = runAudit({
    candles: engineCandles,
    regime,
    elliott,
    cvdTrend: cvd.trend,
    smcTrend: smc.bias,
    lstm,
    compositeScore,
  });
  logs.push(`Audit: ${audit.score}/100 checks passed`, ...audit.logs);

  const runChecksum = checksum({
    price,
    compositeScore: +compositeScore.toFixed(2),
    lastCandleTime: engineCandles[engineCandles.length - 1]?.time,
    candleCount: engineCandles.length,
  });

  // Fire-and-forget local persistence — never blocks or throws into the caller.
  // Skipped for lightweight (MTF) runs to keep IndexedDB bounded and avoid
  // hammering the disk every 60s per adjacent timeframe.
  if (!lightweight) {
    const [symbol, interval] = (sessionKey ?? 'UNKNOWN_UNKNOWN').split('_');
    void saveAnalysisRun({
      symbol,
      interval,
      timestamp,
      price,
      compositeScore,
      uncertainty,
      auditScore: audit.score,
      alert,
      auditFlags: audit.checks.filter((c) => !c.ok).map((c) => c.name),
    });
  }

  return {
    timestamp,
    price,
    dataQuality,
    pivots,
    elliott,
    cvd,
    smc,
    lstm,
    cycle,
    confluence,
    compositeScore,
    uncertainty,
    alert,
    logs,
    regime,
    audit,
    checksum: runChecksum,
  };
}
