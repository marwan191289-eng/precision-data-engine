import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EngineDefinition, EngineResult } from "@/lib/engines/types";
import { runInWorker, verifyInWorker } from "@/lib/worker-pool";
import { saveRun, saveAlert } from "@/lib/db";
import { parseVector, vectorToString } from "@/lib/parse-vector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Play, ShieldCheck, Loader2 } from "lucide-react";
import { fmt } from "@/lib/engines/checksum";

function buildDefault(engine: EngineDefinition) {
  const out: Record<string, unknown> = {};
  for (const p of engine.params) out[p.key] = p.default;
  return out;
}

export function RunPanel({ engine, onResult }: {
  engine: EngineDefinition;
  onResult: (r: EngineResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "ar" ? "ar" : "en") as "en" | "ar";
  const [state, setState] = useState<Record<string, unknown>>(() => buildDefault(engine));
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<EngineResult | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; absError: number; note: string } | null>(null);

  const set = (k: string, v: unknown) => setState(s => ({ ...s, [k]: v }));

  const run = async () => {
    setRunning(true);
    setVerify(null);
    try {
      const result = await runInWorker(engine.id, state);
      setLastResult(result);
      onResult(result);
      await saveRun({ engineId: engine.id, input: state, result, status: "ok" });
      await saveAlert({ kind: "completed", engineId: engine.id,
        message: `${engine.doc[lang].title}: ${fmt(result.durationMs, 3)} ms · ${result.checksum}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await saveAlert({ kind: "failed", engineId: engine.id, message });
    } finally {
      setRunning(false);
    }
  };

  const doVerify = async () => {
    if (!lastResult) return;
    const v = await verifyInWorker(engine.id, state, lastResult);
    setVerify(v);
  };

  return (
    <div className="surface-elevated p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("common.parameters")}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">{engine.id}@{engine.version}</span>
      </div>
      <div className="grid gap-4">
        {engine.params.map(p => {
          const val = state[p.key];
          if (p.kind === "number") {
            return (
              <div key={p.key} className="grid gap-1.5">
                <Label>{p.label[lang]}</Label>
                <Input type="number" step="any" value={String(val ?? "")}
                  onChange={e => set(p.key, Number(e.target.value))} className="font-mono" />
              </div>
            );
          }
          if (p.kind === "expression" || p.kind === "text") {
            return (
              <div key={p.key} className="grid gap-1.5">
                <Label>{p.label[lang]}</Label>
                <Input value={String(val ?? "")} onChange={e => set(p.key, e.target.value)} className="font-mono" />
              </div>
            );
          }
          if (p.kind === "vector") {
            return (
              <div key={p.key} className="grid gap-1.5">
                <Label>{p.label[lang]}</Label>
                <Textarea
                  rows={3}
                  value={Array.isArray(val) ? vectorToString(val as number[]) : ""}
                  onChange={e => set(p.key, parseVector(e.target.value))}
                  className="font-mono text-xs"
                />
                <span className="text-[10px] text-muted-foreground">
                  {Array.isArray(val) ? `${(val as number[]).length} ${t("common.rows")}` : ""}
                </span>
              </div>
            );
          }
          return null;
        })}
      </div>
      <div className="mt-5 flex items-center gap-2">
        <Button onClick={run} disabled={running} className="gradient-primary text-primary-foreground">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? t("common.running") : t("common.run")}
        </Button>
        <Button variant="outline" onClick={doVerify} disabled={!lastResult || running}>
          <ShieldCheck className="h-4 w-4" />
          {t("common.verify")}
        </Button>
      </div>
      {verify && (
        <div className={`mt-3 rounded-md border p-3 text-xs font-mono ${verify.ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          <div className="font-semibold">{verify.ok ? "✓ Oracle passed" : "✗ Oracle failed"}</div>
          <div>abs error = {fmt(verify.absError, 6)}</div>
          <div className="opacity-80">{verify.note}</div>
        </div>
      )}
    </div>
  );
}