import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EngineResult } from "@/lib/engines/types";
import { engines } from "@/lib/engines/registry";
import { Button } from "@/components/ui/button";
import { exportRunToPdf } from "@/lib/pdf-export";
import { exportRunToCsv, exportRunToJson } from "@/lib/csv-export";
import { fmt } from "@/lib/engines/checksum";
import { FileDown, FileSpreadsheet, Braces } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { VirtualTable } from "@/components/engines/VirtualTable";

const chartColors = ["oklch(0.75 0.18 180)", "oklch(0.72 0.18 155)", "oklch(0.80 0.17 85)", "oklch(0.65 0.20 40)"];

export function ResultView({ result }: { result: EngineResult }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "ar" ? "ar" : "en") as "en" | "ar";
  const engine = engines[result.engineId];
  const chartData = useMemo(() => {
    if (!result.series?.length) return [];
    const first = result.series[0].points;
    return first.map((p, i) => {
      const row: Record<string, number> = { x: p.x };
      result.series!.forEach(s => { row[s.name] = s.points[i]?.y ?? NaN; });
      return row;
    });
  }, [result]);

  return (
    <div className="grid gap-4">
      <div className="surface-elevated p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.output")}</div>
            <div className="text-lg font-semibold">{engine.doc[lang].title}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => exportRunToPdf(result, lang)}>
              <FileDown className="h-4 w-4" /> {t("common.exportPdf")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRunToCsv(result)}>
              <FileSpreadsheet className="h-4 w-4" /> {t("common.exportCsv")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRunToJson(result)}>
              <Braces className="h-4 w-4" /> JSON
            </Button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("common.duration")} value={`${fmt(result.durationMs, 4)} ms`} />
          <Stat label={t("common.checksum")} value={result.checksum} mono />
          <Stat label="engine" value={`${result.engineId}@${engine.version}`} mono />
          <Stat label="series" value={String(result.series?.length ?? 0)} />
        </div>
        {result.accuracy && (
          <div className="mt-4 rounded-md border border-border bg-secondary/40 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t("common.accuracy")}</div>
            <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
              {Object.entries(result.accuracy).map(([k, v]) => (
                <div key={k}><span className="text-muted-foreground">{k}: </span>{fmt(v)}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="surface-elevated p-5">
          <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">chart</div>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="oklch(0.30 0.03 240)" strokeDasharray="3 3" />
                <XAxis dataKey="x" stroke="oklch(0.70 0.02 240)" fontSize={11} />
                <YAxis stroke="oklch(0.70 0.02 240)" fontSize={11} />
                <Tooltip contentStyle={{ background: "oklch(0.20 0.025 240)", border: "1px solid oklch(0.30 0.03 240)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {result.series!.map((s, i) => (
                  <Line key={s.name} type="monotone" dataKey={s.name} dot={false}
                    stroke={chartColors[i % chartColors.length]} strokeWidth={2} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {result.table && (
        <div className="surface-elevated p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">table · {result.table.rows.length} {t("common.rows")}</div>
          </div>
          <VirtualTable columns={result.table.columns} rows={result.table.rows} />
        </div>
      )}

      <details className="surface-elevated p-5">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">logs</summary>
        <pre className="mt-3 max-h-64 overflow-auto font-mono text-[11px] leading-relaxed text-muted-foreground">{result.logs.join("\n")}</pre>
      </details>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm ${mono ? "font-mono" : "font-semibold"}`}>{value}</div>
    </div>
  );
}