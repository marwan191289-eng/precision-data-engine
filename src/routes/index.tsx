import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { engineList } from "@/lib/engines/registry";
import { EngineCard } from "@/components/engines/EngineCard";
import { useRuns, useAlerts } from "@/hooks/use-runs";
import { poolSize } from "@/lib/worker-pool";
import { Activity, Cpu, Bell, History } from "lucide-react";
import { fmt } from "@/lib/engines/checksum";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const runs = useRuns(10);
  const alerts = useAlerts();
  const openAlerts = alerts.filter(a => !a.read).length;
  const avgMs = runs.length ? runs.reduce((a, r) => a + r.result.durationMs, 0) / runs.length : 0;

  return (
    <div className="grid gap-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="surface-elevated relative overflow-hidden p-8"
      >
        <div className="absolute -end-24 -top-24 h-64 w-64 rounded-full gradient-primary opacity-20 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            deterministic · verifiable · in-browser
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("app.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{t("app.tagline")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/engines" className="rounded-md gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary">
              {t("nav.engines")}
            </Link>
            <Link to="/docs" className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/70">
              {t("nav.docs")}
            </Link>
          </div>
        </div>
      </motion.section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={History} label={t("hero.kpiRuns")} value={String(runs.length ? "≥ " + runs.length : "0")} />
        <Kpi icon={Cpu} label={t("hero.kpiEngines")} value={String(engineList.length)} />
        <Kpi icon={Activity} label={t("hero.kpiWorkers")} value={String(poolSize())} />
        <Kpi icon={Bell} label={t("hero.kpiAlerts")} value={String(openAlerts)} />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{t("nav.engines")}</h2>
          <Link to="/engines" className="text-xs text-muted-foreground hover:text-foreground">→</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {engineList.map(e => <EngineCard key={e.id} engine={e} />)}
        </div>
      </section>

      {runs.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{t("nav.history")}</h2>
            <span className="text-xs text-muted-foreground">avg {fmt(avgMs, 3)} ms</span>
          </div>
          <div className="surface-elevated divide-y divide-border/50">
            {runs.slice(0, 6).map(r => (
              <Link key={r.id} to="/engines/$engineId" params={{ engineId: r.engineId }}
                className="flex items-center gap-3 px-4 py-2.5 text-xs transition hover:bg-secondary/50">
                <span className="font-mono text-muted-foreground">{new Date(r.createdAt).toLocaleTimeString()}</span>
                <span className="flex-1 truncate">{r.engineId}</span>
                <span className="font-mono">{fmt(r.result.durationMs, 3)} ms</span>
                <span className="font-mono text-muted-foreground">{r.result.checksum}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="surface-elevated p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
