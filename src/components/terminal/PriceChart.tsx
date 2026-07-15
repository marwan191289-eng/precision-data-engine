import { useMemo } from "react";
import type { Candle, FullAnalysisResult, Pivot } from "@/lib/engines/types";

interface Props {
  candles: Candle[];
  pivots: Pivot[];
  analysis?: FullAnalysisResult | null;
  height?: number;
}

const FIB_LEVELS = [
  { ratio: 0,     label: "0%",     color: "oklch(0.70 0.20 150)" },
  { ratio: 0.236, label: "23.6%",  color: "oklch(0.85 0.18 90)" },
  { ratio: 0.382, label: "38.2%",  color: "oklch(0.82 0.20 65)" },
  { ratio: 0.5,   label: "50%",    color: "oklch(0.80 0.16 200)" },
  { ratio: 0.618, label: "61.8%",  color: "oklch(0.85 0.20 50)" },
  { ratio: 0.786, label: "78.6%",  color: "oklch(0.80 0.22 30)" },
  { ratio: 1.0,   label: "100%",   color: "oklch(0.70 0.24 20)" },
];

const WAVE_COLORS = {
  impulse:    ["#64ffda", "#a8ff78", "#fff176", "#ff9a9e", "#84fab0", "#b794f4"],
  corrective: ["#ffeaa7", "#fd79a8", "#74b9ff", "#a29bfe"],
};

export function PriceChart({ candles, pivots, analysis, height = 520 }: Props) {
  const view = useMemo(() => {
    const slice = candles.slice(-160);
    if (slice.length === 0) return null;
    const highs = slice.map((c) => c.high);
    const lows  = slice.map((c) => c.low);
    const max   = Math.max(...highs);
    const min   = Math.min(...lows);
    const range = max - min || 1;
    const pad   = range * 0.06;
    return {
      slice,
      max: max + pad,
      min: min - pad,
      range: range + pad * 2,
      offset: candles.length - slice.length,
      swingHigh: max,
      swingLow:  min,
      swingRange: range,
    };
  }, [candles]);

  // CVD mini-chart data
  const cvdView = useMemo(() => {
    if (!analysis?.cvd?.series?.length) return null;
    const slice = analysis.cvd.series.slice(-160);
    const vals = slice.map((p) => p.value);
    const deltas = slice.map((p) => p.delta);
    const max = Math.max(...vals, 0);
    const min = Math.min(...vals, 0);
    const range = max - min || 1;
    const dmax = Math.max(...deltas.map(Math.abs)) || 1;
    return { slice, max, min, range, deltas, dmax };
  }, [analysis]);

  if (!view) {
    return (
      <div
        className="panel flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        لا توجد بيانات لعرضها
      </div>
    );
  }

  const svgW  = 1000;
  const priceH = cvdView ? Math.round(height * 0.70) : height - 8;
  const cvdH   = cvdView ? height - priceH - 20 : 0;
  const totalH = height + (cvdView ? 8 : 0);

  const barW = (svgW - 60) / view.slice.length;
  const py   = (p: number) => 20 + ((view.max - p) / view.range) * (priceH - 40);

  // Fibonacci prices (measured from visible swing)
  const fibPrices = FIB_LEVELS.map((l) => ({
    ...l,
    price: view.swingHigh - l.ratio * view.swingRange,
  }));

  // Elliott wave best sequence points mapped to visible range
  const best      = analysis?.elliott?.bestSequence ?? null;
  const ellPts    = best?.points.filter((p) => p.index >= view.offset) ?? [];
  const projLines = analysis?.elliott?.projections ?? [];

  // CVD coordinate helpers
  const cvdTop    = priceH + 20;
  const cvdBottom = priceH + 20 + cvdH - 10;
  const cy        = cvdView
    ? (v: number) =>
        cvdTop +
        ((cvdView.max - v) / cvdView.range) * (cvdH - 10)
    : () => 0;

  const pxOf = (idx: number) =>
    30 + (idx - view.offset) * barW + barW / 2;

  return (
    <div className="panel p-3 overflow-hidden">
      <svg
        viewBox={`0 0 ${svgW} ${totalH}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: totalH }}
      >
        {/* ── Fibonacci retracement overlays ─────────────────── */}
        {fibPrices.map((f) => {
          const yy = py(f.price);
          if (yy < 15 || yy > priceH - 5) return null;
          return (
            <g key={f.label}>
              <line
                x1={30}
                x2={svgW - 80}
                y1={yy}
                y2={yy}
                stroke={f.color}
                strokeWidth={f.ratio === 0.618 || f.ratio === 0.382 ? 1.2 : 0.7}
                strokeDasharray={f.ratio === 0.5 ? "6 4" : "3 5"}
                opacity={0.6}
              />
              <text
                x={svgW - 78}
                y={yy - 2}
                fontSize={8.5}
                fontFamily="monospace"
                fill={f.color}
                opacity={0.9}
              >
                {f.label}
              </text>
              <text
                x={svgW - 78}
                y={yy + 9}
                fontSize={7.5}
                fontFamily="monospace"
                fill={f.color}
                opacity={0.6}
              >
                {f.price >= 1000 ? f.price.toFixed(1) : f.price.toFixed(4)}
              </text>
            </g>
          );
        })}

        {/* ── SMC Order Blocks ───────────────────────────────── */}
        {analysis?.smc && (() => {
          const smc = analysis.smc;
          const visibleOBs = [...smc.orderBlocks]
            .filter((ob) => !ob.mitigated)
            .slice(-6);
          const visibleFVGs = [...smc.fairValueGaps]
            .filter((fvg) => !fvg.filled)
            .slice(-5);
          const visibleLiqs = smc.liquidityZones.slice(-4);
          return (
            <g>
              {/* Order Blocks */}
              {visibleOBs.map((ob, i) => {
                const x1 = ob.index >= view.offset
                  ? Math.max(30, pxOf(ob.index) - barW * 0.5)
                  : 30;
                const x2 = svgW - 82;
                const ytop = py(Math.max(ob.top, ob.bottom));
                const ybot = py(Math.min(ob.top, ob.bottom));
                if (ytop > priceH - 4 || ybot < 14) return null;
                const clr = ob.type === "bullish"
                  ? "oklch(0.65 0.22 142)"
                  : "oklch(0.60 0.22 22)";
                const ht = Math.max(2, ybot - ytop);
                return (
                  <g key={`ob-${i}`}>
                    <rect x={x1} y={ytop} width={Math.max(0, x2 - x1)} height={ht}
                      fill={clr} opacity={ob.critical ? 0.20 : 0.10} rx={1} />
                    {ob.critical && (
                      <rect x={x1} y={ytop} width={Math.max(0, x2 - x1)} height={ht}
                        fill="none" stroke={clr} strokeWidth={0.7}
                        strokeDasharray="4 3" opacity={0.55} rx={1} />
                    )}
                    <text x={x2 + 2} y={ytop + 8} fontSize={6.5}
                      fontFamily="monospace" fill={clr} opacity={0.85}>
                      {ob.critical ? "★OB" : "OB"}
                    </text>
                  </g>
                );
              })}

              {/* Fair Value Gaps */}
              {visibleFVGs.map((fvg, i) => {
                const x1 = fvg.index >= view.offset
                  ? Math.max(30, pxOf(fvg.index) - barW * 0.5)
                  : 30;
                const x2 = svgW - 82;
                const ytop = py(Math.max(fvg.top, fvg.bottom));
                const ybot = py(Math.min(fvg.top, fvg.bottom));
                if (ytop > priceH - 4 || ybot < 14) return null;
                const clr = fvg.type === "bullish"
                  ? "oklch(0.72 0.16 165)"
                  : "oklch(0.68 0.16 30)";
                const ht = Math.max(2, ybot - ytop);
                return (
                  <g key={`fvg-${i}`}>
                    <rect x={x1} y={ytop} width={Math.max(0, x2 - x1)} height={ht}
                      fill={clr} opacity={0.07} rx={0.5} />
                    <line x1={x1} x2={x2} y1={ytop} y2={ytop}
                      stroke={clr} strokeWidth={0.6} strokeDasharray="3 3" opacity={0.45} />
                    <line x1={x1} x2={x2} y1={ytop + ht} y2={ytop + ht}
                      stroke={clr} strokeWidth={0.6} strokeDasharray="3 3" opacity={0.45} />
                    <text x={x1 + 3} y={ytop + 8} fontSize={6}
                      fontFamily="monospace" fill={clr} opacity={0.70}>
                      FVG
                    </text>
                  </g>
                );
              })}

              {/* Liquidity Zones */}
              {visibleLiqs.map((liq, i) => {
                const yy = py(liq.price);
                if (yy < 14 || yy > priceH - 4) return null;
                const clr = liq.type === "buy-side"
                  ? "oklch(0.78 0.14 220)"
                  : "oklch(0.75 0.16 5)";
                return (
                  <g key={`liq-${i}`}>
                    <line x1={30} x2={svgW - 84} y1={yy} y2={yy}
                      stroke={clr} strokeWidth={0.9}
                      strokeDasharray="6 5" opacity={0.50} />
                    <text x={svgW - 82} y={yy + 3.5} fontSize={6.5}
                      fontFamily="monospace" fill={clr} opacity={0.75}>
                      {liq.type === "buy-side" ? "BSL" : "SSL"}
                    </text>
                  </g>
                );
              })}

              {/* Break of Structure level */}
              {smc.breakOfStructure && (() => {
                const yy = py(smc.breakOfStructure.level);
                if (yy < 14 || yy > priceH - 4) return null;
                const clr = smc.breakOfStructure.type === "bullish"
                  ? "oklch(0.75 0.20 142)"
                  : "oklch(0.70 0.22 22)";
                return (
                  <g>
                    <line x1={30} x2={svgW - 84} y1={yy} y2={yy}
                      stroke={clr} strokeWidth={1.3}
                      strokeDasharray="9 3" opacity={0.85} />
                    <text x={svgW - 82} y={yy - 2} fontSize={7}
                      fontFamily="monospace" fill={clr} opacity={0.95}>
                      {smc.breakOfStructure.isChangeOfCharacter ? "CHoCH" : "BOS"}
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })()}

        {/* ── Price grid ─────────────────────────────────────── */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={30}
            x2={svgW - 80}
            y1={20 + r * (priceH - 40)}
            y2={20 + r * (priceH - 40)}
            stroke="var(--color-grid)"
            strokeDasharray="4 6"
            strokeWidth={0.5}
          />
        ))}

        {/* ── Price axis labels ──────────────────────────────── */}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const price = view.max - r * view.range;
          return (
            <text
              key={r}
              x={svgW - 75}
              y={20 + r * (priceH - 40) - 2}
              textAnchor="start"
              fontFamily="monospace"
              fontSize={9}
              fill="var(--color-muted-foreground)"
            >
              {price >= 1000 ? price.toFixed(1) : price.toFixed(4)}
            </text>
          );
        })}

        {/* ── Candlesticks ───────────────────────────────────── */}
        {view.slice.map((c, i) => {
          const x    = 30 + i * barW + barW / 2;
          const bull = c.close >= c.open;
          const col  = bull ? "var(--color-bull)" : "var(--color-bear)";
          const openY   = py(c.open);
          const closeY  = py(c.close);
          const bodyTop = Math.min(openY, closeY);
          const bodyH   = Math.max(1, Math.abs(closeY - openY));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={py(c.high)} y2={py(c.low)} stroke={col} strokeWidth={1} />
              <rect
                x={x - Math.max(1, barW * 0.35)}
                y={bodyTop}
                width={Math.max(1.5, barW * 0.7)}
                height={bodyH}
                fill={col}
                opacity={0.9}
              />
            </g>
          );
        })}

        {/* ── Pivot dots ─────────────────────────────────────── */}
        {pivots
          .filter((p) => p.index >= view.offset)
          .map((p) => {
            const localIdx = p.index - view.offset;
            const x  = 30 + localIdx * barW + barW / 2;
            const yy = py(p.price);
            const isHigh = p.type === "high";
            return (
              <g key={`${p.index}-${p.type}`}>
                <circle cx={x} cy={yy} r={2.5}
                  fill={isHigh ? "var(--color-bear)" : "var(--color-bull)"} opacity={0.85} />
                <text x={x} y={isHigh ? yy - 6 : yy + 12}
                  fontSize={7.5} textAnchor="middle"
                  fill="var(--color-muted-foreground)" fontFamily="monospace">
                  {isHigh ? "H" : "L"}
                </text>
              </g>
            );
          })}

        {/* ── Elliott Wave sequence polyline ─────────────────── */}
        {best && ellPts.length >= 2 && (() => {
          const colors = best.degree === "impulse"
            ? WAVE_COLORS.impulse
            : WAVE_COLORS.corrective;
          return (
            <g>
              {/* Segment lines */}
              {ellPts.slice(1).map((pt, i) => {
                const prev = ellPts[i];
                const x1 = pxOf(prev.index);
                const x2 = pxOf(pt.index);
                const y1 = py(prev.price);
                const y2 = py(pt.price);
                if (x1 < 30 || x2 < 30) return null;
                return (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={colors[i % colors.length]}
                    strokeWidth={2}
                    opacity={0.85}
                    strokeLinecap="round"
                  />
                );
              })}
              {/* Wave labels */}
              {ellPts.map((pt, i) => {
                const x = pxOf(pt.index);
                if (x < 30) return null;
                const yy = py(pt.price);
                const above = i % 2 === (best.direction === "up" ? 0 : 1);
                const labelY = above ? yy - 14 : yy + 18;
                return (
                  <g key={`wl-${i}`}>
                    <circle cx={x} cy={yy} r={5}
                      fill={colors[i % colors.length]} opacity={0.9} />
                    <text x={x} y={labelY}
                      fontSize={10} fontWeight="700" textAnchor="middle"
                      fill={colors[i % colors.length]} fontFamily="monospace">
                      {pt.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* ── Elliott projection lines ───────────────────────── */}
        {ellPts.length > 0 && projLines.map((proj, i) => {
          const lastPt = ellPts[ellPts.length - 1];
          if (!lastPt) return null;
          const x1   = pxOf(lastPt.index);
          const yProj = py(proj.price);
          if (yProj < 10 || yProj > priceH - 5 || x1 < 30) return null;
          return (
            <g key={`proj-${i}`}>
              <line
                x1={x1} y1={py(lastPt.price)}
                x2={svgW - 85} y2={yProj}
                stroke="oklch(0.85 0.18 60)"
                strokeWidth={1}
                strokeDasharray="6 4"
                opacity={0.7}
              />
              <text x={svgW - 83} y={yProj + 3}
                fontSize={8} fontFamily="monospace"
                fill="oklch(0.85 0.18 60)" opacity={0.9}>
                {proj.label} ({proj.probability}%)
              </text>
            </g>
          );
        })}

        {/* ── CVD separator ─────────────────────────────────── */}
        {cvdView && (
          <line
            x1={0} x2={svgW}
            y1={priceH + 10} y2={priceH + 10}
            stroke="var(--color-grid)"
            strokeWidth={0.8}
          />
        )}

        {/* ── CVD sub-chart ──────────────────────────────────── */}
        {cvdView && (() => {
          const zeroy = cy(0);
          return (
            <g>
              {/* Zero line */}
              <line x1={30} x2={svgW - 80} y1={zeroy} y2={zeroy}
                stroke="var(--color-grid)" strokeWidth={0.6} strokeDasharray="4 4" />
              {/* CVD label */}
              <text x={32} y={cvdTop + 12} fontSize={8.5} fontFamily="monospace"
                fill="var(--color-muted-foreground)" opacity={0.7}>
                CVD
              </text>
              {/* Delta histogram bars */}
              {cvdView.deltas.map((d, i) => {
                const x = 30 + i * barW;
                const h = Math.abs(d / cvdView.dmax) * (cvdH * 0.35);
                const bull = d >= 0;
                return (
                  <rect key={i}
                    x={x + barW * 0.1}
                    y={bull ? zeroy - h : zeroy}
                    width={Math.max(0.5, barW * 0.8)}
                    height={Math.max(0.5, h)}
                    fill={bull ? "var(--color-bull)" : "var(--color-bear)"}
                    opacity={0.5}
                  />
                );
              })}
              {/* Smoothed CVD line */}
              {(() => {
                const pts = cvdView.slice.map((p, i) => {
                  const x = 30 + i * barW + barW / 2;
                  const y = cy(p.value);
                  return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                });
                return (
                  <path
                    d={pts.join(" ")}
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeWidth={1.5}
                    opacity={0.85}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })()}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
