import { useEffect, useRef, useState } from "react";
import { fetchCandles, type Interval } from "@/lib/binance";
import { runFullAnalysis } from "@/lib/engines/integrationHub";
import type { FullAnalysisResult } from "@/lib/engines/types";

// ── timeframe adjacency ──────────────────────────────────────────────────────
const TF_ORDER: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

function adjacentTFs(iv: Interval): { lower: Interval | null; higher: Interval | null } {
  const i = TF_ORDER.indexOf(iv);
  return { lower: i > 0 ? TF_ORDER[i - 1] : null, higher: i < TF_ORDER.length - 1 ? TF_ORDER[i + 1] : null };
}

// ── display helpers ──────────────────────────────────────────────────────────
const REGIME_LABEL: Record<string, string> = {
  "strong-trend": "⚡ اتجاه قوي",
  "weak-trend":   "↗ ضعيف",
  breakout:       "🚀 اختراق",
  range:          "↔ عرضي",
  chop:           "🌀 مضطرب",
};

function DirDot({ v }: { v: "bullish" | "bearish" | "neutral" | null | undefined }) {
  if (!v) return <span className="text-muted-foreground text-[11px]">—</span>;
  const cfg = {
    bullish: { color: "var(--color-bull)",    label: "▲" },
    bearish: { color: "var(--color-bear)",    label: "▼" },
    neutral: { color: "var(--color-neutral)", label: "●" },
  }[v];
  return (
    <span className="text-sm font-bold" style={{ color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 15 ? "var(--color-bull)" : score <= -15 ? "var(--color-bear)" : "var(--color-neutral)";
  return (
    <span
      className="text-xs font-bold font-mono tabular-nums px-1.5 py-0.5 rounded"
      style={{ color, background: `color-mix(in oklab, ${color} 12%, var(--color-secondary))` }}
    >
      {score > 0 ? "+" : ""}{score.toFixed(0)}
    </span>
  );
}

// ── row type ─────────────────────────────────────────────────────────────────
interface MTFRow {
  interval: Interval;
  analysis: FullAnalysisResult | null;
  loading: boolean;
  isCurrent: boolean;
}

interface Props {
  symbol: string;
  currentInterval: Interval;
  currentAnalysis: FullAnalysisResult | null;
}

const REFRESH_MS = 60_000; // refresh adjacent TFs every 60 s

export function MultiTimeframeTable({ symbol, currentInterval, currentAnalysis }: Props) {
  const { lower, higher } = adjacentTFs(currentInterval);

  const [lowerRow,  setLowerRow]  = useState<MTFRow>({ interval: lower  ?? "1m", analysis: null, loading: false, isCurrent: false });
  const [higherRow, setHigherRow] = useState<MTFRow>({ interval: higher ?? "1d", analysis: null, loading: false, isCurrent: false });

  const runningRef = useRef(false);

  useEffect(() => {
    // Reset adjacent rows when symbol or interval changes
    if (lower)  setLowerRow(r  => ({ ...r,  interval: lower,  analysis: null }));
    if (higher) setHigherRow(r => ({ ...r, interval: higher, analysis: null }));
  }, [symbol, currentInterval, lower, higher]);

  useEffect(() => {
    if (!lower && !higher) return;

    async function fetchMTF() {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const tasks: Promise<void>[] = [];
        if (lower) {
          setLowerRow(r => ({ ...r, loading: true }));
          tasks.push(
            fetchCandles(symbol, lower, 300)
              .then(cs => runFullAnalysis(cs, `${symbol}_${lower}`, { lightweight: true }))
              .then(a  => setLowerRow({ interval: lower!, analysis: a, loading: false, isCurrent: false }))
              .catch(() => setLowerRow(r => ({ ...r, loading: false }))),
          );
        }
        if (higher) {
          setHigherRow(r => ({ ...r, loading: true }));
          tasks.push(
            fetchCandles(symbol, higher, 300)
              .then(cs => runFullAnalysis(cs, `${symbol}_${higher}`, { lightweight: true }))
              .then(a  => setHigherRow({ interval: higher!, analysis: a, loading: false, isCurrent: false }))
              .catch(() => setHigherRow(r => ({ ...r, loading: false }))),
          );
        }
        await Promise.all(tasks);
      } finally {
        runningRef.current = false;
      }
    }

    void fetchMTF();
    const id = window.setInterval(() => void fetchMTF(), REFRESH_MS);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, currentInterval]);

  const currentRow: MTFRow = {
    interval: currentInterval,
    analysis: currentAnalysis,
    loading:  false,
    isCurrent: true,
  };

  // Build ordered row list: lower → current → higher
  const rows: MTFRow[] = [
    ...(lower  ? [lowerRow]   : []),
    currentRow,
    ...(higher ? [higherRow]  : []),
  ];

  if (rows.length < 2) return null; // only one timeframe available, nothing to compare

  return (
    <div className="panel p-4 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: "linear-gradient(90deg, transparent, var(--color-primary), transparent)" }}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider">توافق الإطارات الزمنية</h3>
        <span className="text-[10px] text-muted-foreground font-mono">MTF · يتجدد كل 60 ث</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" style={{ borderCollapse: "separate", borderSpacing: "0 3px" }}>
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <th className="text-right pb-2 pr-2 font-normal">الإطار</th>
              <th className="text-center pb-2 font-normal">النظام</th>
              <th className="text-center pb-2 font-normal">إليوت</th>
              <th className="text-center pb-2 font-normal">CVD</th>
              <th className="text-center pb-2 font-normal">SMC</th>
              <th className="text-center pb-2 font-normal">LSTM</th>
              <th className="text-center pb-2 font-normal">الإشارة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const a = row.analysis;
              const isCurrent = row.isCurrent;
              return (
                <tr
                  key={row.interval}
                  className="transition-colors"
                  style={
                    isCurrent
                      ? {
                          background: "color-mix(in oklab, var(--color-primary) 8%, var(--color-secondary))",
                          borderRadius: "8px",
                        }
                      : {}
                  }
                >
                  {/* Timeframe label */}
                  <td className="py-2 pr-3 pl-2">
                    <div className="flex items-center gap-1.5">
                      {isCurrent && (
                        <span
                          className="w-1.5 h-1.5 rounded-full pulse-ring"
                          style={{ background: "var(--color-primary)", color: "var(--color-primary)" }}
                        />
                      )}
                      <span
                        className="font-mono font-bold"
                        style={{ color: isCurrent ? "var(--color-primary)" : "var(--color-foreground)" }}
                      >
                        {row.interval}
                      </span>
                    </div>
                  </td>

                  {/* Regime */}
                  <td className="text-center py-2 px-1">
                    {row.loading ? (
                      <span className="text-muted-foreground">…</span>
                    ) : a?.regime ? (
                      <span className="text-[10px]">{REGIME_LABEL[a.regime.kind] ?? a.regime.kind}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Elliott */}
                  <td className="text-center py-2 px-1">
                    {row.loading ? <span className="text-muted-foreground">…</span>
                      : <DirDot v={a?.elliott?.trend} />}
                  </td>

                  {/* CVD */}
                  <td className="text-center py-2 px-1">
                    {row.loading ? <span className="text-muted-foreground">…</span>
                      : <DirDot v={a?.cvd?.trend} />}
                  </td>

                  {/* SMC */}
                  <td className="text-center py-2 px-1">
                    {row.loading ? <span className="text-muted-foreground">…</span>
                      : <DirDot v={a?.smc?.bias} />}
                  </td>

                  {/* LSTM */}
                  <td className="text-center py-2 px-1">
                    {row.loading ? (
                      <span className="text-muted-foreground">…</span>
                    ) : a?.lstm ? (
                      <DirDot v={a.lstm.direction === "up" ? "bullish" : "bearish"} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Composite */}
                  <td className="text-center py-2 pl-2 pr-1">
                    {row.loading ? (
                      <span className="text-muted-foreground text-[10px]">…</span>
                    ) : a ? (
                      <ScorePill score={a.compositeScore} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Agreement summary */}
      {(() => {
        const scores = rows
          .map((r) => r.analysis?.compositeScore)
          .filter((s): s is number => s !== null && s !== undefined);
        if (scores.length < 2) return null;
        const bullish = scores.filter((s) => s > 15).length;
        const bearish = scores.filter((s) => s < -15).length;
        const total   = scores.length;
        const agree   = Math.max(bullish, bearish);
        const dir     = bullish >= bearish ? "bullish" : "bearish";

        return (
          <div
            className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between text-[11px]"
          >
            <span className="text-muted-foreground">
              التوافق: {agree}/{total} إطارات{" "}
              <span style={{ color: dir === "bullish" ? "var(--color-bull)" : "var(--color-bear)" }}>
                {dir === "bullish" ? "▲ صعودية" : "▼ هبوطية"}
              </span>
            </span>
            <span className="font-mono text-muted-foreground">
              {agree === total ? "✓ توافق كامل" : agree > 1 ? "◐ توافق جزئي" : "✗ تعارض"}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
