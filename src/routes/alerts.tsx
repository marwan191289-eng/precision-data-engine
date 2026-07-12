import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAlerts } from "@/hooks/use-runs";
import { AppShell } from "@/components/layout/AppShell";
import { Bell, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Alerts · Precision Engine Suite" }] }),
  component: () => <AppShell><AlertsPage /></AppShell>,
});

function AlertsPage() {
  const { t } = useTranslation();
  const alerts = useAlerts();
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{t("nav.alerts")}</h1>
      {alerts.length === 0 ? (
        <div className="surface-elevated p-10 text-center text-sm text-muted-foreground">{t("alerts.empty")}</div>
      ) : (
        <div className="grid gap-2">
          {alerts.map(a => {
            const Icon = a.kind === "completed" ? CheckCircle2 : a.kind === "failed" ? XCircle : AlertTriangle;
            const color = a.kind === "completed" ? "text-success" : a.kind === "failed" ? "text-destructive" : "text-warning";
            return (
              <div key={a.id} className="surface-elevated flex items-start gap-3 p-3">
                <Icon className={`h-5 w-5 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{a.engineId}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{new Date(a.createdAt).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{a.message}</div>
                </div>
                <Bell className="h-4 w-4 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}