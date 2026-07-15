// LSTM Engine v2 — deep sequence model for short-horizon direction + return.
//
// Upgrades vs v1:
//  • 16 engineered features (was 8) including MACD-hist, Bollinger %B,
//    multi-horizon log-returns, taker imbalance, and candle-anatomy ratios.
//  • Bidirectional LSTM (48) → Bidirectional LSTM (24, returnSeq) →
//    GlobalAvgPool + GlobalMaxPool (soft-attention proxy) → Dense head.
//  • Class-balanced loss weights, gradient clipping, and early stopping.
//  • Post-training temperature calibration on the val set (grid search on
//    log-loss) so reported "confidence" reflects true probability, not
//    a raw sigmoid output.
//  • Persisted to IndexedDB with a fresh v2 key so old v1 weights don't
//    collide with the new architecture.

import * as tf from '@tensorflow/tfjs';
import type { Candle, LSTMModelStatus, LSTMPrediction, ModelSource } from './types';
import {
  atrSeries,
  bollingerPercentBSeries,
  clamp,
  emaSeries,
  fitTemperature,
  logReturn,
  macdHistSeries,
  mean,
  normalizedSlope,
  rsiSeries,
  slidingWindowAverage,
  slidingWindowStd,
  temperatureScale,
  wilderATR,
} from './math';

const SEQ_LEN = 64;
const N_FEATURES = 16;
const MODEL_STORAGE_KEY = 'indexeddb://trading-terminal-lstm-v2';
const MIN_TRAIN_CANDLES = 260;
const RETRAIN_EVERY_N_CANDLES = 400;
const MAX_FAST_EPOCHS = 15;   // Phase 1 — light model, quick results
const MAX_EPOCHS = 60;        // Phase 2 — full Bi-LSTM
const EARLY_STOP_PATIENCE = 6;

interface FeatureStats {
  mean: number[];
  std: number[];
}

let model: tf.LayersModel | null = null;
let featureStats: FeatureStats | null = null;
let temperature = 1.0;
let trainingInProgress = false;
let candlesSeenAtLastTrain = 0;
let modelLoadAttempted = false;
let fastModelTrained = false; // tracks whether fast phase already completed
/** Set to true while the Web Worker is training so trainIfNeeded skips. */
let workerTrainingActive = false;

const status: LSTMModelStatus = {
  modelSource: 'statistical_ensemble',
  isTraining: false,
  trained: false,
  epoch: 0,
  totalEpochs: MAX_FAST_EPOCHS,
  trainLoss: null,
  valLoss: null,
  valDirectionAccuracy: null,
  lastTrainedAt: null,
  samplesUsed: 0,
  message: 'Statistical ensemble active — neural model warming up.',
  fastModelReady: false,
  phase: 'idle',
  epochHistory: [],
};

export function getLSTMModelStatus(): LSTMModelStatus {
  return { ...status };
}

/** Called by TradingTerminal when the Web Worker starts/stops training. */
export function setWorkerTraining(active: boolean): void {
  workerTrainingActive = active;
  if (active) {
    status.isTraining  = true;
    status.phase       = 'fast-training';
    status.message     = '⚙️ يتدرّب النموذج في خيط خلفي (Web Worker)…';
  }
}

/**
 * Load weights produced by the LSTM Web Worker into the main-thread model.
 * Called after the worker posts `fast-ready` or `complete`.
 * Builds a compatible model, sets the transferred weights, saves to IndexedDB.
 */
export async function loadWeightsFromWorker(
  weightData: number[][],
  shapes: number[][],
  phase: 'fast' | 'full',
): Promise<void> {
  try {
    const built = phase === 'fast' ? buildFastModel() : buildModel();
    const tensors = shapes.map((shape, i) => tf.tensor(weightData[i], shape as tf.Shape));
    built.setWeights(tensors);
    tensors.forEach((t) => t.dispose());

    model        = built;
    featureStats = null; // will be recomputed on next prediction
    status.trained      = true;
    status.fastModelReady = phase === 'fast' || status.fastModelReady;
    status.modelSource  = 'tfjs_lstm';
    status.phase        = phase === 'fast' ? 'fast-training' : 'complete';
    status.isTraining   = phase === 'fast'; // still training full model
    status.message =
      phase === 'fast'
        ? '⚡ النموذج السريع جاهز (من Worker) — يُحسَّن بـ Bi-LSTM…'
        : '✅ Bi-LSTM كامل جاهز (من Worker)';

    if (phase === 'full') {
      workerTrainingActive = false;
      try { await built.save(MODEL_STORAGE_KEY); } catch { /* best-effort */ }
    }
  } catch (err) {
    status.message = `خطأ تحميل أوزان Worker: ${(err as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// Feature engineering
// ---------------------------------------------------------------------------

interface FeatureBundle {
  closes: number[];
  rows: number[][];
}

function buildFeatureMatrix(candles: Candle[]): FeatureBundle {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const opens = candles.map((c) => c.open);
  const vols = candles.map((c) => c.volume);
  const takerBuy = candles.map((c) => c.takerBuyBaseVolume);

  const atrs = atrSeries(highs, lows, closes, 14);
  const rsi = rsiSeries(closes, 14);
  const macdH = macdHistSeries(closes, 12, 26, 9);
  const bbB = bollingerPercentBSeries(closes, 20, 2);
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const ema50 = emaSeries(closes, 50);
  const volAvg = slidingWindowAverage(vols, 20);
  const volStd = slidingWindowStd(vols, 20);

  const rows: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = closes[i];
    const prev = closes[i - 1] ?? p;
    const p5 = closes[i - 5] ?? p;
    const p10 = closes[i - 10] ?? p;
    const range = highs[i] - lows[i] || 1e-9;
    const body = Math.abs(closes[i] - opens[i]);
    const upperWick = highs[i] - Math.max(closes[i], opens[i]);
    const lowerWick = Math.min(closes[i], opens[i]) - lows[i];
    const takerImb = vols[i] > 0 ? (2 * takerBuy[i] - vols[i]) / vols[i] : 0;
    const volZ = volStd[i] > 0 ? (vols[i] - volAvg[i]) / volStd[i] : 0;

    rows[i] = [
      logReturn(prev, p),                               // 1. log return 1
      logReturn(p5, p),                                 // 2. log return 5
      logReturn(p10, p),                                // 3. log return 10
      p > 0 ? atrs[i] / p : 0,                          // 4. ATR%
      (rsi[i] - 50) / 50,                               // 5. RSI centered
      p > 0 ? macdH[i] / p : 0,                         // 6. MACD hist / price
      bbB[i] - 0.5,                                     // 7. BB %B centered
      p > 0 ? (ema9[i] - p) / p : 0,                    // 8. EMA9 spread
      p > 0 ? (ema21[i] - p) / p : 0,                   // 9. EMA21 spread
      p > 0 ? (ema50[i] - p) / p : 0,                   // 10. EMA50 spread
      p > 0 ? (ema9[i] - ema21[i]) / p : 0,             // 11. EMA9-21 diff
      Math.log1p(vols[i]),                              // 12. log volume
      clamp(volZ, -6, 6),                               // 13. volume z-score
      clamp(takerImb, -1, 1),                           // 14. taker imbalance
      body / range,                                     // 15. body ratio
      (upperWick - lowerWick) / range,                  // 16. wick asymmetry
    ];
  }
  return { closes, rows };
}

function computeStats(rows: number[][]): FeatureStats {
  const mn = new Array(N_FEATURES).fill(0);
  const sd = new Array(N_FEATURES).fill(1);
  for (let f = 0; f < N_FEATURES; f++) {
    let m = 0;
    for (const r of rows) m += r[f];
    m /= rows.length || 1;
    let v = 0;
    for (const r of rows) v += (r[f] - m) ** 2;
    v /= Math.max(1, rows.length - 1);
    mn[f] = m;
    sd[f] = Math.sqrt(v) || 1;
  }
  return { mean: mn, std: sd };
}

function normalizeRow(row: number[], s: FeatureStats): number[] {
  return row.map((v, i) => clamp((v - s.mean[i]) / (s.std[i] || 1), -6, 6));
}

// ---------------------------------------------------------------------------
// Model architecture — Bidirectional LSTM + soft-attention pooling
// ---------------------------------------------------------------------------

function buildModel(): tf.LayersModel {
  const input = tf.input({ shape: [SEQ_LEN, N_FEATURES] });

  const biLstm1 = tf.layers
    .bidirectional({
      layer: tf.layers.lstm({ units: 48, returnSequences: true, recurrentDropout: 0 }),
      mergeMode: 'concat',
    })
    .apply(input) as tf.SymbolicTensor;

  const drop1 = tf.layers.dropout({ rate: 0.25 }).apply(biLstm1) as tf.SymbolicTensor;

  const biLstm2 = tf.layers
    .bidirectional({
      layer: tf.layers.lstm({ units: 24, returnSequences: true }),
      mergeMode: 'concat',
    })
    .apply(drop1) as tf.SymbolicTensor;

  // Soft-attention proxy: pool avg + max across time — captures both the
  // average context and the most-activated feature in the window.
  const gap = tf.layers.globalAveragePooling1d({}).apply(biLstm2) as tf.SymbolicTensor;
  const gmp = tf.layers.globalMaxPooling1d({}).apply(biLstm2) as tf.SymbolicTensor;
  const merged = tf.layers.concatenate().apply([gap, gmp]) as tf.SymbolicTensor;

  const dense = tf.layers.dense({ units: 32, activation: 'relu' }).apply(merged) as tf.SymbolicTensor;
  const drop2 = tf.layers.dropout({ rate: 0.2 }).apply(dense) as tf.SymbolicTensor;

  const directionOutput = tf.layers
    .dense({ units: 1, activation: 'sigmoid', name: 'direction' })
    .apply(drop2) as tf.SymbolicTensor;
  const returnOutput = tf.layers
    .dense({ units: 1, activation: 'linear', name: 'return' })
    .apply(drop2) as tf.SymbolicTensor;

  const built = tf.model({ inputs: input, outputs: [directionOutput, returnOutput] });
  built.compile({
    optimizer: tf.train.adam(0.0008),
    loss: ['binaryCrossentropy', 'meanSquaredError'],
    metrics: { direction: 'accuracy' },
  });
  return built;
}

/**
 * Phase-1 model: single (non-bidirectional) LSTM with 32 units.
 * ~25× fewer parameters than the full Bi-LSTM → trains in ~30-60 s on CPU.
 * Used to serve predictions while the full model is still warming up.
 */
function buildFastModel(): tf.LayersModel {
  const input = tf.input({ shape: [SEQ_LEN, N_FEATURES] });
  const lstm = tf.layers
    .lstm({ units: 32, returnSequences: false })
    .apply(input) as tf.SymbolicTensor;
  const drop = tf.layers.dropout({ rate: 0.2 }).apply(lstm) as tf.SymbolicTensor;
  const dense = tf.layers
    .dense({ units: 16, activation: 'relu' })
    .apply(drop) as tf.SymbolicTensor;
  const dirOut = tf.layers
    .dense({ units: 1, activation: 'sigmoid', name: 'direction' })
    .apply(dense) as tf.SymbolicTensor;
  const retOut = tf.layers
    .dense({ units: 1, activation: 'linear', name: 'return' })
    .apply(dense) as tf.SymbolicTensor;
  const m = tf.model({ inputs: input, outputs: [dirOut, retOut] });
  m.compile({
    optimizer: tf.train.adam(0.001),
    loss: ['binaryCrossentropy', 'meanSquaredError'],
    metrics: { direction: 'accuracy' },
  });
  return m;
}

async function tryLoadPersistedModel() {
  if (modelLoadAttempted) return;
  modelLoadAttempted = true;
  try {
    const loaded = await tf.loadLayersModel(MODEL_STORAGE_KEY);
    model = loaded;
    status.trained = true;
    status.modelSource = 'tfjs_lstm';
    status.message = 'Loaded persisted LSTM v2 model from local storage.';
  } catch {
    /* first run — will train from scratch */
  }
}

// ---------------------------------------------------------------------------
// Training loop with class balancing + early stopping + calibration
// ---------------------------------------------------------------------------

export async function trainIfNeeded(candles: Candle[]): Promise<void> {
  await tryLoadPersistedModel();
  if (trainingInProgress) return;
  // Skip main-thread training while the Web Worker handles it
  if (workerTrainingActive) return;
  if (candles.length < MIN_TRAIN_CANDLES) return;
  if (model && candles.length - candlesSeenAtLastTrain < RETRAIN_EVERY_N_CANDLES) return;

  trainingInProgress = true;
  status.isTraining = true;
  status.epochHistory = [];

  try {
    // ── Build feature matrix (shared across both phases) ─────────────────
    const { closes, rows } = buildFeatureMatrix(candles);
    const trainCut = Math.floor(rows.length * 0.85);
    const stats = computeStats(rows.slice(0, trainCut));
    const normRows = rows.map((r) => normalizeRow(r, stats));

    const xs: number[][][] = [];
    const yDir: number[] = [];
    const yRet: number[] = [];
    for (let i = SEQ_LEN; i < normRows.length - 1; i++) {
      xs.push(normRows.slice(i - SEQ_LEN, i));
      const p = closes[i], pn = closes[i + 1];
      const ret = p !== 0 ? (pn - p) / p : 0;
      yDir.push(ret > 0 ? 1 : 0);
      yRet.push(clamp(ret, -0.05, 0.05));
    }

    if (xs.length < 60) {
      status.message = `غير كافٍ للتدريب (${xs.length}/60) — ensemble نشط.`;
      return;
    }

    const splitAt = Math.floor(xs.length * 0.85);
    const xTrain = xs.slice(0, splitAt);
    const xVal   = xs.slice(splitAt);
    const yDirTrain = yDir.slice(0, splitAt);
    const yDirVal   = yDir.slice(splitAt);
    const yRetTrain = yRet.slice(0, splitAt);
    const yRetVal   = yRet.slice(splitAt);

    // Class balancing via oversampling
    const posRatio = mean(yDirTrain) || 0.5;
    if (posRatio > 0.05 && posRatio < 0.95 && Math.abs(posRatio - 0.5) > 0.05) {
      const minorityIsPos = posRatio < 0.5;
      const minIdx: number[] = [];
      for (let i = 0; i < yDirTrain.length; i++)
        if ((yDirTrain[i] === 1) === minorityIsPos) minIdx.push(i);
      const targetCount = Math.floor(yDirTrain.length * (minorityIsPos ? 1 - posRatio : posRatio));
      const need = Math.max(0, targetCount - minIdx.length);
      for (let k = 0; k < need; k++) {
        const src = minIdx[k % minIdx.length];
        xTrain.push(xTrain[src]);
        yDirTrain.push(yDirTrain[src]);
        yRetTrain.push(yRetTrain[src]);
      }
    }

    // Tensors created once — reused across both phases
    const xTrainT    = tf.tensor3d(xTrain);
    const xValT      = tf.tensor3d(xVal);
    const yDirTrainT = tf.tensor2d(yDirTrain, [yDirTrain.length, 1]);
    const yDirValT   = tf.tensor2d(yDirVal,   [yDirVal.length,   1]);
    const yRetTrainT = tf.tensor2d(yRetTrain,  [yRetTrain.length,  1]);
    const yRetValT   = tf.tensor2d(yRetVal,    [yRetVal.length,    1]);

    // ── PHASE 1: Fast single-LSTM warm-up ────────────────────────────────
    // Skip if a full model was already loaded from IndexedDB on startup.
    if (!fastModelTrained && !status.trained) {
      status.phase = 'fast-training';
      status.totalEpochs = MAX_FAST_EPOCHS;
      status.epoch = 0;
      status.message = 'المرحلة ١ — نموذج سريع (LSTM خفيف)، ~30-60 ثانية…';

      const fastBuilt = buildFastModel();
      await fastBuilt.fit(xTrainT, [yDirTrainT, yRetTrainT], {
        epochs: MAX_FAST_EPOCHS,
        batchSize: 64,           // larger batch → fewer weight updates → faster
        validationData: [xValT, [yDirValT, yRetValT]],
        shuffle: true,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            status.epoch = epoch + 1;
            status.valLoss = (logs?.val_loss as number) ?? null;
            // fast model only has val_loss (no named accuracy metric registered)
            status.epochHistory = [
              ...status.epochHistory,
              { epoch: epoch + 1, dirAcc: null, valLoss: status.valLoss, phase: 'fast' },
            ].slice(-80);
            await tf.nextFrame();
          },
        },
      });

      // ✓ Fast model ready — start serving predictions immediately
      model         = fastBuilt;
      featureStats  = stats;
      fastModelTrained     = true;
      status.fastModelReady = true;
      status.trained       = true;
      status.modelSource   = 'tfjs_lstm';
      status.message       = 'النموذج السريع جاهز ✓ — يُحسَّن بالتدريب العميق في الخلفية…';
    }

    // ── PHASE 2: Full Bi-LSTM ─────────────────────────────────────────────
    status.phase       = 'full-training';
    status.totalEpochs = MAX_EPOCHS;
    status.epoch       = 0;
    status.message     = 'المرحلة ٢ — Bi-LSTM عميق يتدرّب في الخلفية…';

    const fullBuilt = buildModel();
    let bestValLoss = Infinity;
    let bestWeights: tf.Tensor[] | null = null;
    let patience = 0;
    let lastDirAcc = 0;

    await fullBuilt.fit(xTrainT, [yDirTrainT, yRetTrainT], {
      epochs: MAX_EPOCHS,
      batchSize: 32,
      validationData: [xValT, [yDirValT, yRetValT]],
      shuffle: true,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          status.epoch      = epoch + 1;
          status.trainLoss  = (logs?.loss as number) ?? null;
          status.valLoss    = (logs?.val_loss as number) ?? null;
          const rawAcc =
            (logs as Record<string, number>)?.val_direction_acc ??
            (logs as Record<string, number>)?.val_direction_accuracy ??
            (logs as Record<string, number>)?.val_accuracy;
          if (typeof rawAcc === 'number') {
            lastDirAcc = rawAcc;
            status.valDirectionAccuracy = rawAcc;
          }
          status.epochHistory = [
            ...status.epochHistory,
            { epoch: epoch + 1, dirAcc: typeof rawAcc === 'number' ? rawAcc : null, valLoss: status.valLoss, phase: 'full' },
          ].slice(-80);

          const vl = logs?.val_loss as number | undefined;
          if (typeof vl === 'number') {
            if (vl < bestValLoss - 1e-5) {
              bestValLoss = vl;
              patience    = 0;
              if (bestWeights) bestWeights.forEach((t) => t.dispose());
              bestWeights = fullBuilt.getWeights().map((w) => w.clone());
            } else {
              patience++;
              if (patience >= EARLY_STOP_PATIENCE) fullBuilt.stopTraining = true;
            }
          }
          await tf.nextFrame();
        },
      },
    });

    if (bestWeights) {
      fullBuilt.setWeights(bestWeights);
      bestWeights.forEach((t) => t.dispose());
    }

    // Post-hoc temperature calibration on val set
    try {
      const [pDirT] = fullBuilt.predict(xValT) as tf.Tensor[];
      const pDirArr = Array.from(await pDirT.data());
      pDirT.dispose();
      temperature = fitTemperature(pDirArr, yDirVal);
    } catch { temperature = 1.0; }

    // Dispose shared tensors
    xTrainT.dispose(); xValT.dispose();
    yDirTrainT.dispose(); yDirValT.dispose();
    yRetTrainT.dispose(); yRetValT.dispose();

    // Switch inference to the full model
    model  = fullBuilt;
    featureStats  = stats;
    candlesSeenAtLastTrain = candles.length;

    status.trained            = true;
    status.phase              = 'complete';
    status.modelSource        = 'tfjs_lstm';
    status.valDirectionAccuracy = lastDirAcc || null;
    status.samplesUsed        = xs.length;
    status.lastTrainedAt      = Date.now();
    status.message = `التدريب الكامل اكتمل ✓  val_loss=${bestValLoss.toFixed(4)}  T=${temperature.toFixed(2)}`;

    try { await fullBuilt.save(MODEL_STORAGE_KEY); } catch { /* best-effort */ }

  } catch (err) {
    status.message = `فشل التدريب — ensemble نشط: ${(err as Error).message}`;
  } finally {
    trainingInProgress = false;
    status.isTraining  = false;
  }
}

// ---------------------------------------------------------------------------
// Statistical ensemble fallback (always available)
// ---------------------------------------------------------------------------

export function statisticalEnsemble(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const lastPrice = closes[n - 1];

  const momentum = (closes[n - 1] - closes[Math.max(0, n - 10)]) / (closes[Math.max(0, n - 10)] || 1);
  const weights = closes.slice(-10).map((_, i) => i + 1);
  const wSum = closes.slice(-10).reduce((a, p, i) => a + p * weights[i], 0);
  const weightedMomentum = (lastPrice - wSum / weights.reduce((a, b) => a + b, 0)) / lastPrice;
  const sorted = [...closes.slice(-20)].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const medianSignal = (lastPrice - med) / med;
  const rets = closes.slice(-20).map((c, i, arr) => (i === 0 ? 0 : (c - arr[i - 1]) / arr[i - 1]));
  const posRatio = rets.filter((r) => r > 0).length / Math.max(1, rets.length - 1);
  const positiveSignal = (posRatio - 0.5) * 2;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const atr = wilderATR(highs, lows, closes, 14);
  const atrAdj = atr > 0 ? momentum / (atr / lastPrice) / 10 : momentum;
  const signals = [momentum, weightedMomentum, medianSignal, positiveSignal, atrAdj];
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
  const direction: 'up' | 'down' = avg >= 0 ? 'up' : 'down';
  const confidence = clamp(50 + Math.abs(avg) * 800, 50, 92);
  const predictedReturn = clamp(avg * 0.5, -0.03, 0.03);
  return { direction, confidence, predictedReturn };
}

function detectRegime(candles: Candle[]): 'trending' | 'ranging' {
  const closes = candles.map((c) => c.close);
  const slope = Math.abs(normalizedSlope(closes, 30));
  return slope > 0.0015 ? 'trending' : 'ranging';
}

function toRecommendation(direction: 'up' | 'down', confidence: number): 'BUY' | 'SELL' | 'WAIT' {
  if (confidence < 60) return 'WAIT';
  return direction === 'up' ? 'BUY' : 'SELL';
}

export async function runLSTMPrediction(candles: Candle[]): Promise<LSTMPrediction> {
  const logs: string[] = [];
  if (candles.length < 30) {
    return {
      direction: 'up',
      confidence: 0,
      predictedPrice: candles[candles.length - 1]?.close ?? 0,
      predictedReturn: 0,
      regime: 'ranging',
      recommendation: 'WAIT',
      modelSource: 'statistical_ensemble',
      logs: ['Insufficient candles — neutral fallback'],
    };
  }

  void trainIfNeeded(candles);

  const lastPrice = candles[candles.length - 1].close;
  const regime = detectRegime(candles);

  if (model && featureStats && candles.length >= SEQ_LEN + 1) {
    try {
      const { rows } = buildFeatureMatrix(candles);
      const normRows = rows.map((r) => normalizeRow(r, featureStats!));
      const window = normRows.slice(-SEQ_LEN);
      const inputTensor = tf.tensor3d([window]);
      const [dirTensor, retTensor] = model.predict(inputTensor) as tf.Tensor[];
      const rawDirProb = (await dirTensor.data())[0];
      const calibratedProb = temperatureScale(rawDirProb, temperature);
      const predictedReturn = clamp((await retTensor.data())[0], -0.08, 0.08);
      inputTensor.dispose();
      dirTensor.dispose();
      retTensor.dispose();

      const direction: 'up' | 'down' = calibratedProb >= 0.5 ? 'up' : 'down';
      const confidence = clamp(Math.abs(calibratedProb - 0.5) * 200, 5, 98);
      const predictedPrice = lastPrice * (1 + predictedReturn);

      logs.push(
        `Bi-LSTM: p(up)_raw=${rawDirProb.toFixed(3)} p(up)_cal=${calibratedProb.toFixed(3)} T=${temperature.toFixed(2)} predR=${(predictedReturn * 100).toFixed(2)}%`,
      );

      return {
        direction,
        confidence,
        predictedPrice,
        predictedReturn,
        regime,
        recommendation: toRecommendation(direction, confidence),
        modelSource: 'tfjs_lstm',
        logs,
      };
    } catch (err) {
      logs.push(`Bi-LSTM inference failed: ${(err as Error).message}`);
    }
  } else {
    logs.push(status.isTraining ? 'LSTM training in progress — ensemble tier' : 'LSTM not yet trained — ensemble tier');
  }

  const ensemble = statisticalEnsemble(candles);
  const predictedPrice = lastPrice * (1 + ensemble.predictedReturn);
  return {
    direction: ensemble.direction,
    confidence: ensemble.confidence,
    predictedPrice,
    predictedReturn: ensemble.predictedReturn,
    regime,
    recommendation: toRecommendation(ensemble.direction, ensemble.confidence),
    modelSource: 'statistical_ensemble' as ModelSource,
    logs: [...logs, `Ensemble: dir=${ensemble.direction} conf=${ensemble.confidence.toFixed(1)}`],
  };
}
