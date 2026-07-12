import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useRuns } from "@/hooks/use-runs";
import { Button } from "@/components/ui/button";
import { clearAll } from "@/lib/db";
import { fmt } from "@/lib/engines/checksum";
import { engines } from "@/lib/engines/registry";
import { Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Run History · Precision Engine Suite" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "ar" ? "ar" : "en") as "en" | "ar";
  const runs = useRuns(500);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav.history")}</h1>
        <Button variant="outline" size="sm" onClick={() => clearAll()}>
          <Trash2 className="h-4 w-4" /> {t("common.clear")}
        </Button>
      </div>
      {runs.length === 0 ? (
        <div className="surface-elevated p-10 text-center text-sm text-muted-foreground">{t("history.empty")}</div>
      ) : (
        <div className="surface-elevated overflow-hidden">
          <div className="grid grid-cols-[1fr_1.4fr_120px_100px_140px] gap-3 border-b border-border bg-secondary/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>{t("history.columns.time")}</div>
            <div>{t("history.columns.engine")}</div>
            <div className="text-right">{t("history.columns.duration")}</div>
            <div>{t("history.columns.status")}</div>
            <div>{t("history.columns.checksum")}</div>
          </div>
          <div className="divide-y divide-border/50">
            {runs.map(r => (
              <Link key={r.id}
                to="/engines/$engineId" params={{ engineId: r.engineId }}
                className="grid grid-cols-[1fr_1.4fr_120px_100px_140px] gap-3 px-4 py-2 text-xs transition hover:bg-secondary/40">
                <div className="font-mono text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                <div>{engines[r.engineId].doc[lang].title}</div>
                <div className="text-right font-mono">{fmt(r.result.durationMs, 3)}</div>
                <div className={r.status === "ok" ? "text-success" : "text-destructive"}>{r.status}</div>
                <div className="font-mono text-muted-foreground">{r.result.checksum}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}