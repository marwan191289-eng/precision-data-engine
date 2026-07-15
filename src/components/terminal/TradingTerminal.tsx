import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCandles, POPULAR_SYMBOLS, type Interval } from "@/lib/binance";
import type { Candle, FullAnalysisResult, LSTMModelStatus } from "@/lib/engines/types";
import { runFullAnalysis } from "@/lib/engines/integrationHub";
import { getLSTMModelStatus, loadWeightsFromWorker, setWorkerTraining } from "@/lib/engines/lstmEngine";
import { resetCVDSession } from "@/lib/engines/cvdEngine";
import { PriceChart } from "./PriceChart";
import { ScoreGauge } from "./ScoreGauge";
import { EnginePanel, Metric, TrendBadge } from "./EnginePanel";
import { FibonacciPanel } from "./FibonacciPanel";
import { BacktestPanel } from "./BacktestPanel";
import { ReportPanel } from "./ReportPanel";
import { MultiTimeframeTable } from "./MultiTimeframeTable";

const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const REFRESH_MS = 15000;
type Tab = "chart" | "fibonacci" | "backtest" | "report";

export function TradingTerminal() {
  const [symbol,      setSymbol]      = useState("BTCUSDT");
  const [interval,    setIntervalVal] = useState<Interval>("15m");
  const [candles,     setCandles]     = useState<Candle[]>([]);
  const [analysis,    setAnalysis]    = useState<FullAnalysisResult | null>(null);
  const [lstmStatus,  setLstmStatus]  = useState<LSTMModelStatus | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [activeTab,   setActiveTab]   = useState<Tab>("chart");
  const runningRef            = useRef(false);
  /** Tracks the last time a manual refresh was triggered — debounce guard. */
  const lastManualRefreshRef  = useRef(0);
  /** Tracks which `${symbol}_${interval}` the worker was already started for. */
  const workerStartedRef      = useRef<string | null>(null);
  const workerRef             = useRef<Worker | null>(null);

  const sessionKey = `${symbol}_${interval}`;

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    // Keep the previous analysis visible on error — only clear the error banner
    setError(null);
    try {
      const cs = await fetchCandles(symbol, interval, 500);
      setCandles(cs);

      // Pre-empt main-thread LSTM training BEFORE runFullAnalysis calls
      // trainIfNeeded — otherwise the flag arrives too late.
      const willUseWorker =
        workerRef.current !== null &&
        cs.length >= 260 &&
        workerStartedRef.current !== sessionKey;
      if (willUseWorker) setWorkerTraining(true);

      // Pass sessionKey so engines receive only closed candles and CVD
      // maintains a running total across refreshes (no reset to zero).
      const res = await runFullAnalysis(cs, sessionKey);
      setAnalysis(res);
      setLstmStatus(getLSTMModelStatus());
      setLastUpdated(Date.now());

      // Now start the Web Worker (flag already set above)
      if (willUseWorker) {
        workerStartedRef.current = sessionKey;
        workerRef.current!.postMessage({ type: 'train', candles: cs });
      }
    } catch (e) {
      // Network error: keep showing last valid analysis (no setAnalysis(null))
      setError((e as Error).message);
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [symbol, interval, sessionKey]);

  // Auto-refresh every 15 s
  useEffect(() => {
    void run();
    const id = window.setInterval(() => void run(), REFRESH_MS);
    return () => {
      window.clearInterval(id);
      // Reset session CVD baseline when switching symbol or interval
      resetCVDSession(sessionKey);
    };
  }, [run, sessionKey]);

  // Poll lstmStatus every second to show live training progress
  useEffect(() => {
    const id = window.setInterval(() => setLstmStatus(getLSTMModelStatus()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── Web Worker lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('../workers/lstm.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = w;

      w.onmessage = (e: MessageEvent) => {
        const msg = e.data as {
          type: string;
          phase?: 'fast' | 'full';
          epoch?: number;
          totalEpochs?: number;
          valLoss?: number | null;
          dirAcc?: number | null;
          weightData?: number[][];
          shapes?: number[][];
          valDirectionAccuracy?: number;
          message?: string;
        };

        if (msg.type === 'progress') {
          // Forward progress to lstmStatus so sparkline & progress bar update
          setLstmStatus((prev) =>
            prev
              ? {
                  ...prev,
                  phase:      msg.phase ?? prev.phase,
                  epoch:      msg.epoch ?? prev.epoch,
                  totalEpochs: msg.totalEpochs ?? prev.totalEpochs,
                  valLoss:    msg.valLoss ?? null,
                  valDirectionAccuracy: msg.dirAcc ?? prev.valDirectionAccuracy,
                  isTraining: true,
                  epochHistory: [
                    ...(prev.epochHistory ?? []),
                    {
                      epoch:   msg.epoch ?? 0,
                      dirAcc:  msg.dirAcc ?? null,
                      valLoss: msg.valLoss ?? null,
                      phase:   msg.phase ?? 'fast',
                    },
                  ].slice(-80),
                }
              : prev,
          );
        } else if (msg.type === 'fast-ready' && msg.weightData && msg.shapes) {
          void loadWeightsFromWorker(msg.weightData, msg.shapes, 'fast').then(() =>
            setLstmStatus(getLSTMModelStatus()),
          );
        } else if (msg.type === 'complete' && msg.weightData && msg.shapes) {
          void loadWeightsFromWorker(msg.weightData, msg.shapes, 'full').then(() =>
            setLstmStatus(getLSTMModelStatus()),
          );
        } else if (msg.type === 'error') {
          // Worker training failed — fall back to main-thread training on next run()
          setWorkerTraining(false);
          workerStartedRef.current = null; // allow re-attempt
          console.warn('[LSTM Worker]', msg.message);
        }
      };

      w.onerror = () => {
        setWorkerTraining(false);
        workerStartedRef.current = null;
      };
    } catch {
      // Web Workers not supported in this environment — main-thread training fallback
      workerRef.current = null;
    }

    return () => {
      w?.terminate();
      workerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const price        = analysis?.price ?? candles[candles.length - 1]?.close ?? 0;
  const prevPrice    = candles[candles.length - 2]?.close ?? price;
  const priceChange  = price - prevPrice;
  const priceChangePct = prevPrice ? (priceChange / prevPrice) * 100 : 0;

  // CVD extended data (engine returns extra fields beyond the base type)
  const cvdExt = analysis?.cvd as (typeof analysis.cvd & {
    obvTrend?: "bullish" | "bearish" | "neutral";
    buyPressure?: number;
    ema9?: number[];
    ema21?: number[];
  }) | null;

  return (
    <div className="min-h-screen">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="border-b border-border/50 backdrop-blur-xl bg-background/60 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl relative overflow-hidden flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--gradient-hero)" }}
            >
              <div
                className="absolute inset-0 opacity-60"
                style={{ background: "radial-gradient(circle at 30% 30%, var(--color-primary), transparent 60%)" }}
              />
              <span className="relative font-bold text-base" style={{ color: "var(--color-primary)" }}>Æ</span>
            </div>
            <div>
              <h1 className="font-bold text-[15px] leading-tight tracking-tight">
                Accurate Engine <span style={{ color: "var(--color-primary)" }}>Terminal</span>
              </h1>
              <p className="text-[10px] text-muted-foreground font-mono">
                Elliott · CVD · SMC · LSTM · Fibonacci
              </p>
            </div>
          </div>

          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {POPULAR_SYMBOLS.map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.label}</option>
              ))}
            </select>

            <div className="flex rounded-lg overflow-hidden border border-border">
              {INTERVALS.map((iv) => (
                <button
                  key={iv}
                  onClick={() => setIntervalVal(iv)}
                  className={`px-2.5 py-1.5 text-[11px] font-mono font-semibold transition-colors ${
                    interval === iv
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {iv}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                const now = Date.now();
                // Rate-limit: ignore manual refreshes faster than 2 s apart
                if (now - lastManualRefreshRef.current < 2000) return;
                lastManualRefreshRef.current = now;
                void run();
              }}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a10 10 0 100 10z" />
                  </svg>
                  جاري…
                </span>
              ) : "تحديث"}
            </button>
          </div>
        </div>

        {/* Price bar */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-3.5 flex flex-wrap items-baseline gap-5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[28px] font-bold font-mono tabular-nums leading-none">
              {price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: price < 1 ? 6 : 2,
              })}
            </span>
            <span
              className={`text-sm font-mono font-semibold ${priceChange >= 0 ? "text-bull" : "text-bear"}`}
            >
              {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChangePct).toFixed(2)}%
            </span>
          </div>

          {analysis && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground font-mono">
              <span>شموع: {analysis.dataQuality.candleCount}</span>
              <span>جودة: {analysis.dataQuality.score}%</span>
              <span>محاور: {analysis.pivots.length}</span>
              {lastUpdated && (
                <span>تحديث: {new Date(lastUpdated).toLocaleTimeString("ar")}</span>
              )}
              {analysis.regime && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    background: "color-mix(in oklab, var(--color-primary) 12%, transparent)",
                    color: "var(--color-primary)",
                  }}
                >
                  {({
                    "strong-trend": "⚡ اتجاه قوي",
                    "weak-trend":   "↗ اتجاه ضعيف",
                    breakout:       "🚀 اختراق",
                    range:          "↔ عرضي",
                    chop:           "🌀 مضطرب",
                  } as const)[analysis.regime.kind]}
                </span>
              )}
            </div>
          )}
          {error && <span className="text-[11px] text-bear font-mono">⚠ {error}</span>}
        </div>

        {/* Tab bar */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex gap-1 border-t border-border/30">
          {(["chart", "fibonacci", "backtest", "report"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                activeTab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "chart"     && "📈 التحليل"}
              {t === "fibonacci" && "🌀 فيبوناتشي · إليوت"}
              {t === "backtest"  && "⚙ الباكتيست"}
              {t === "report"    && "📋 تقرير المحركات"}
            </button>
          ))}
        </div>
      </header>

      {/* ── Alert banner ────────────────────────────────────── */}
      {analysis?.alert && (
        <div
          className="max-w-[1600px] mx-auto px-4 sm:px-6 mt-4"
        >
          <div
            className="rounded-xl px-5 py-3 flex items-center gap-3 border"
            style={{
              borderColor: analysis.compositeScore >= 0 ? "var(--color-bull)" : "var(--color-bear)",
              background:  analysis.compositeScore >= 0
                ? "color-mix(in oklab, var(--color-bull) 7%, var(--color-panel))"
                : "color-mix(in oklab, var(--color-bear) 7%, var(--color-panel))",
            }}
          >
            <span
              className="w-2 h-2 rounded-full pulse-ring flex-shrink-0"
              style={{
                background: analysis.compositeScore >= 0 ? "var(--color-bull)" : "var(--color-bear)",
                color:      analysis.compositeScore >= 0 ? "var(--color-bull)" : "var(--color-bear)",
              }}
            />
            <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground flex-shrink-0">
              تنبيه
            </span>
            <span className="text-sm font-medium">{analysis.alert}</span>
          </div>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────── */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-5">

        {/* ── TAB: Chart ────────────────────────────── */}
        {activeTab === "chart" && (
          <div className="grid grid-cols-12 gap-4">
            {/* Chart + confluence */}
            <section className="col-span-12 lg:col-span-8 space-y-4">
              <PriceChart
                candles={candles}
                pivots={analysis?.pivots ?? []}
                analysis={analysis}
                height={520}
              />

              {/* Confluence breakdown */}
              {analysis && (
                <div className="panel p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider">
                      توزيع الإشارات
                    </h3>
                    <span className="text-xs text-muted-foreground font-mono">
                      {analysis.confluence.length} محرك
                    </span>
                  </div>
                  <div className="space-y-3">
                    {analysis.confluence.map((s) => {
                      const contribPct = (s.contribution / s.weight) * 100;
                      const bullish    = s.contribution >= 0;
                      const color      = bullish ? "var(--color-bull)" : "var(--color-bear)";
                      return (
                        <div key={s.name}>
                          <div className="flex items-center justify-between mb-1 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{s.name}</span>
                              <TrendBadge trend={s.direction} />
                            </div>
                            <span className="font-mono text-muted-foreground text-[11px]">
                              w={s.weight} · c={s.contribution.toFixed(1)}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-secondary overflow-hidden relative">
                            <div
                              className="absolute top-0 bottom-0"
                              style={{
                                left:   bullish ? "50%" : `${50 + contribPct}%`,
                                width:  `${Math.abs(contribPct) / 2}%`,
                                background: color,
                                opacity: 0.85,
                              }}
                            />
                            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Multi-timeframe agreement table */}
              <MultiTimeframeTable
                symbol={symbol}
                currentInterval={interval}
                currentAnalysis={analysis}
              />
            </section>

            {/* Right column */}
            <aside className="col-span-12 lg:col-span-4 space-y-4">
              {analysis && (
                <ScoreGauge score={analysis.compositeScore} uncertainty={analysis.uncertainty} />
              )}

              {/* Regime */}
              {analysis?.regime && (
                <div className="panel p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    نظام السوق
                  </div>
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-base font-semibold">
                      {({
                        "strong-trend": "⚡ اتجاه قوي",
                        "weak-trend":   "↗ اتجاه ضعيف",
                        breakout:       "🚀 اختراق",
                        range:          "↔ عرضي",
                        chop:           "🌀 مضطرب",
                      } as const)[analysis.regime.kind]}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      ثقة {analysis.regime.confidence}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-muted-foreground">
                    <div>Hurst</div>
                    <div className="text-right text-foreground">{analysis.regime.hurst.toFixed(2)}</div>
                    <div>Kaufman ER</div>
                    <div className="text-right text-foreground">{analysis.regime.efficiencyRatio.toFixed(2)}</div>
                    <div>ADX(14)</div>
                    <div className="text-right text-foreground">{analysis.regime.adx.toFixed(1)}</div>
                    <div>Vol %ile</div>
                    <div className="text-right text-foreground">
                      {(analysis.regime.volatilityPercentile * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              )}

              {/* LSTM */}
              {lstmStatus && (
                <EnginePanel
                  title="LSTM Neural"
                  subtitle={
                    lstmStatus.modelSource === "tfjs_lstm"
                      ? "TensorFlow.js — تدريب مكتمل"
                      : "Statistical Ensemble (احتياطي)"
                  }
                  accent={lstmStatus.modelSource === "tfjs_lstm" ? "primary" : "neutral"}
                >
                  {analysis?.lstm && (
                    <>
                      <Metric label="الاتجاه المتوقع"
                        tone={analysis.lstm.direction === "up" ? "bull" : "bear"}
                        value={analysis.lstm.direction === "up" ? "↑ صعود" : "↓ هبوط"} />
                      <Metric label="الثقة"   value={`${analysis.lstm.confidence.toFixed(1)}%`} />
                      <Metric label="السعر المتوقع"
                        value={analysis.lstm.predictedPrice.toFixed(
                          analysis.lstm.predictedPrice < 1 ? 6 : 2)} />
                      <Metric label="العائد المتوقع"
                        tone={analysis.lstm.predictedReturn >= 0 ? "bull" : "bear"}
                        value={`${(analysis.lstm.predictedReturn * 100).toFixed(2)}%`} />
                      <Metric label="النظام"
                        value={analysis.lstm.regime === "trending" ? "اتجاه" : "عرضي"} />
                      <Metric label="التوصية"
                        tone={
                          analysis.lstm.recommendation === "BUY"  ? "bull"
                          : analysis.lstm.recommendation === "SELL" ? "bear" : "neutral"
                        }
                        value={analysis.lstm.recommendation} />
                    </>
                  )}
                  <div className="pt-2 border-t border-border/50 space-y-2">
                    {/* Phase badge + epoch counter */}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                      <span className="flex items-center gap-1.5">
                        {lstmStatus.isTraining && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                            style={{ background: "var(--color-primary)" }}
                          />
                        )}
                        {lstmStatus.phase === "fast-training"  ? "⚡ إحماء سريع"
                          : lstmStatus.phase === "full-training" ? "🔬 تدريب عميق"
                          : lstmStatus.phase === "complete"      ? "✓ اكتمل"
                          : lstmStatus.trained ? "مدرّب" : "إحماء"}
                      </span>
                      <span>epoch {lstmStatus.epoch}/{lstmStatus.totalEpochs}</span>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width:      `${(lstmStatus.epoch / Math.max(1, lstmStatus.totalEpochs)) * 100}%`,
                          background: lstmStatus.phase === "fast-training"
                            ? "var(--color-warn)"
                            : "var(--color-primary)",
                          boxShadow:  "var(--glow-primary)",
                        }}
                      />
                    </div>

                    {/* Epoch accuracy sparkline */}
                    {lstmStatus.epochHistory && lstmStatus.epochHistory.length > 1 && (() => {
                      const hist = lstmStatus.epochHistory;
                      const fullPts = hist.filter(e => e.dirAcc !== null);
                      // use dirAcc when available, otherwise fall back to 1 - normalised valLoss
                      const pts: number[] = hist.map(e => {
                        if (e.dirAcc !== null) return e.dirAcc;
                        const vl = e.valLoss;
                        if (vl === null) return 0.5;
                        return Math.max(0, Math.min(1, 1 - vl * 4));
                      });
                      const W = 200, H = 32;
                      const minV = Math.min(...pts);
                      const maxV = Math.max(...pts);
                      const range = Math.max(0.01, maxV - minV);
                      const px = (i: number) => (i / (pts.length - 1)) * W;
                      const py = (v: number) => H - ((v - minV) / range) * (H - 4) - 2;
                      const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
                      const last = pts[pts.length - 1];
                      // colour: green if we have real dirAcc and it's ≥50%, else amber
                      const lineColor = fullPts.length > 0 && last >= 0.5
                        ? "var(--color-bull)"
                        : "var(--color-warn)";
                      return (
                        <div>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1 font-mono">
                            <span>دقة الاتجاه (epoch)</span>
                            {fullPts.length > 0 && (
                              <span style={{ color: lineColor }}>
                                {(last * 100).toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <svg
                            viewBox={`0 0 ${W} ${H}`}
                            width="100%"
                            height={H}
                            className="overflow-visible"
                          >
                            {/* 50% reference line */}
                            {fullPts.length > 0 && (
                              <line
                                x1={0} x2={W}
                                y1={py(0.5)} y2={py(0.5)}
                                stroke="var(--color-border)"
                                strokeWidth={0.6}
                                strokeDasharray="3 3"
                              />
                            )}
                            {/* Phase boundary */}
                            {hist.findIndex(e => e.phase === "full") > 0 && (() => {
                              const bi = hist.findIndex(e => e.phase === "full");
                              const bx = px(bi);
                              return (
                                <line x1={bx} x2={bx} y1={0} y2={H}
                                  stroke="var(--color-border)"
                                  strokeWidth={0.7} opacity={0.6} />
                              );
                            })()}
                            {/* Sparkline */}
                            <path
                              d={d}
                              fill="none"
                              stroke={lineColor}
                              strokeWidth={1.4}
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              opacity={0.9}
                            />
                            {/* Last dot */}
                            <circle
                              cx={px(pts.length - 1)}
                              cy={py(last)}
                              r={2}
                              fill={lineColor}
                            />
                          </svg>
                        </div>
                      );
                    })()}

                    {lstmStatus.valLoss !== null && (
                      <div className="text-[10px] text-muted-foreground font-mono">
                        val_loss={lstmStatus.valLoss.toFixed(4)}
                        {lstmStatus.valDirectionAccuracy !== null &&
                          ` · dir_acc=${(lstmStatus.valDirectionAccuracy * 100).toFixed(1)}%`}
                        {lstmStatus.fastModelReady && lstmStatus.phase !== "complete" &&
                          " · ⚡ fast ready"}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {lstmStatus.message}
                    </p>
                  </div>
                </EnginePanel>
              )}

              {/* Elliott */}
              {analysis?.elliott && (
                <EnginePanel
                  title="Elliott Wave"
                  subtitle={
                    analysis.elliott.currentWave
                      ? `موجة حالية: ${analysis.elliott.currentWave}`
                      : "بحث عن نمط"
                  }
                  accent={
                    analysis.elliott.trend === "bullish" ? "bull"
                    : analysis.elliott.trend === "bearish" ? "bear" : "neutral"
                  }
                >
                  <Metric label="الاتجاه" value={<TrendBadge trend={analysis.elliott.trend} />} />
                  <Metric label="الثقة"   value={`${analysis.elliott.confidence.toFixed(0)}%`} />
                  <Metric label="التسلسلات" value={analysis.elliott.sequences.length} />
                  {analysis.elliott.bestSequence && (
                    <Metric
                      label="النوع"
                      value={analysis.elliott.bestSequence.degree === "impulse" ? "دافعة 5" : "تصحيح ABC"}
                    />
                  )}
                  {analysis.elliott.projections.length > 0 && (
                    <div className="pt-2 border-t border-border/50">
                      <div className="text-[10px] text-muted-foreground uppercase mb-2 tracking-wider">
                        أهداف Fibonacci
                      </div>
                      {analysis.elliott.projections.slice(0, 4).map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs font-mono py-1">
                          <span className="text-muted-foreground">{p.label}</span>
                          <span>{p.price.toFixed(p.price < 1 ? 4 : 2)}</span>
                          <span className="text-muted-foreground">{p.probability}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </EnginePanel>
              )}

              {/* CVD */}
              {analysis?.cvd && (
                <EnginePanel
                  title="CVD · OBV · Volume Delta"
                  subtitle="ضغط الشراء · تباينات الحجم"
                  accent={
                    analysis.cvd.trend === "bullish" ? "bull"
                    : analysis.cvd.trend === "bearish" ? "bear" : "neutral"
                  }
                >
                  <Metric label="اتجاه CVD"  value={<TrendBadge trend={analysis.cvd.trend} />} />
                  <Metric label="القوة"       value={`${analysis.cvd.strength.toFixed(0)}%`} />
                  {cvdExt?.obvTrend && (
                    <Metric
                      label="اتجاه OBV"
                      value={<TrendBadge trend={cvdExt.obvTrend as "bullish" | "bearish" | "neutral"} />}
                      hint="On-Balance Volume"
                    />
                  )}
                  {cvdExt?.buyPressure !== undefined && (
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground text-[11px]">ضغط الشراء</span>
                        <span className="font-mono font-medium"
                          style={{ color: cvdExt.buyPressure > 55 ? "var(--color-bull)" : cvdExt.buyPressure < 45 ? "var(--color-bear)" : "var(--color-neutral)" }}>
                          {cvdExt.buyPressure}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${cvdExt.buyPressure}%`,
                            background: cvdExt.buyPressure > 55
                              ? "var(--color-bull)"
                              : cvdExt.buyPressure < 45
                                ? "var(--color-bear)"
                                : "var(--color-neutral)",
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <Metric label="التباينات" value={analysis.cvd.divergences.length}
                    tone={analysis.cvd.divergences.length > 0 ? "neutral" : undefined} />
                  {analysis.cvd.divergences.slice(0, 2).map((d, i) => (
                    <div key={i}
                      className="text-[11px] p-2 rounded-lg border border-border/50"
                      style={{
                        background: d.type === "bullish"
                          ? "color-mix(in oklab, var(--color-bull) 7%, var(--color-secondary))"
                          : "color-mix(in oklab, var(--color-bear) 7%, var(--color-secondary))",
                      }}>
                      <TrendBadge trend={d.type} /> {d.description}
                    </div>
                  ))}
                </EnginePanel>
              )}

              {/* SMC */}
              {analysis?.smc && (
                <EnginePanel
                  title="Smart Money Concepts"
                  subtitle="Order Blocks · FVG · Liquidity"
                  accent={
                    analysis.smc.bias === "bullish" ? "bull"
                    : analysis.smc.bias === "bearish" ? "bear" : "neutral"
                  }
                >
                  <Metric label="التحيز"       value={<TrendBadge trend={analysis.smc.bias} />} />
                  <Metric label="Order Blocks"  value={analysis.smc.orderBlocks.length} />
                  <Metric label="OBs حرجة"
                    value={analysis.smc.criticalOrderBlocks.length}
                    tone={analysis.smc.criticalOrderBlocks.length > 0 ? "bull" : undefined} />
                  <Metric label="Fair Value Gaps" value={analysis.smc.fairValueGaps.length} />
                  <Metric label="مناطق السيولة" value={analysis.smc.liquidityZones.length} />
                  {analysis.smc.breakOfStructure && (
                    <Metric
                      label={analysis.smc.breakOfStructure.isChangeOfCharacter ? "CHoCH" : "BOS"}
                      tone={analysis.smc.breakOfStructure.type === "bullish" ? "bull" : "bear"}
                      value={analysis.smc.breakOfStructure.level.toFixed(2)}
                    />
                  )}
                  {analysis.smc.equilibrium && (
                    <Metric
                      label="موضع السعر"
                      value={
                        analysis.smc.equilibrium.pricePosition === "premium"  ? "Premium Zone"
                        : analysis.smc.equilibrium.pricePosition === "discount" ? "Discount Zone"
                        : "Equilibrium"
                      }
                    />
                  )}
                </EnginePanel>
              )}

              {/* Cycle (FFT) + Audit — Phase 1 additions */}
              {analysis?.cycle && (
                <EnginePanel
                  title="Spectral Cycle (FFT)"
                  subtitle="كشف الدورات الطيفية"
                  accent={
                    analysis.cycle.trend === "bullish" ? "bull"
                    : analysis.cycle.trend === "bearish" ? "bear" : "neutral"
                  }
                >
                  <Metric label="الاتجاه" value={<TrendBadge trend={analysis.cycle.trend} />} />
                  <Metric
                    label="مدة الدورة (شمعة)"
                    value={analysis.cycle.dominantPeriodCandles ? analysis.cycle.dominantPeriodCandles.toFixed(1) : "—"}
                  />
                  <Metric label="القوة" value={`${analysis.cycle.strength.toFixed(0)}%`} />
                  <Metric
                    label="التحقق الذاتي (Parseval)"
                    value={analysis.cycle.verify.ok ? "PASS" : "FAIL"}
                    tone={analysis.cycle.verify.ok ? "bull" : "bear"}
                  />
                </EnginePanel>
              )}

              {analysis?.audit && (
                <EnginePanel
                  title="Audit — طبقة التدقيق"
                  subtitle="فحوصات تحقق مستقلة لكل تشغيلة"
                  accent={analysis.audit.score >= 75 ? "bull" : analysis.audit.score >= 50 ? "neutral" : "bear"}
                >
                  <Metric
                    label="درجة التدقيق"
                    value={`${analysis.audit.score}/100`}
                    tone={analysis.audit.score >= 75 ? "bull" : analysis.audit.score >= 50 ? undefined : "bear"}
                  />
                  {analysis.checksum && (
                    <Metric label="Checksum" value={analysis.checksum} />
                  )}
                  {analysis.audit.checks.map((c) => (
                    <Metric
                      key={c.name}
                      label={c.name}
                      value={c.ok ? "✓" : "✗"}
                      hint={c.detail}
                      tone={c.ok ? "bull" : "bear"}
                    />
                  ))}
                </EnginePanel>
              )}
            </aside>
          </div>
        )}

        {/* ── TAB: Fibonacci ────────────────────────── */}
        {activeTab === "fibonacci" && candles.length > 0 && (
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8 space-y-4">
              <PriceChart candles={candles} pivots={analysis?.pivots ?? []} analysis={analysis} height={480} />
            </div>
            <div className="col-span-12 lg:col-span-4">
              {analysis ? (
                <FibonacciPanel analysis={analysis} candles={candles} />
              ) : (
                <div className="panel p-5 text-sm text-muted-foreground">
                  انتظر اكتمال التحليل…
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: Backtest ─────────────────────────── */}
        {activeTab === "backtest" && (
          <div className="max-w-2xl">
            <BacktestPanel candles={candles} />
          </div>
        )}

        {/* ── TAB: Report ───────────────────────────── */}
        {activeTab === "report" && (
          <div className="max-w-4xl">
            <ReportPanel analysis={analysis} />
          </div>
        )}
      </main>

      <footer className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 text-center text-[11px] text-muted-foreground border-t border-border/20 mt-8 space-y-1">
        <p>
          البيانات مباشرة من Binance Public API · جميع المحركات تعمل محلياً في المتصفح ·
          LSTM يتدرّب عبر TensorFlow.js
        </p>
        <p className="opacity-50">
          Not financial advice — for analysis and research purposes only.
        </p>
      </footer>
    </div>
  );
}
