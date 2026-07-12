import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { setLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Activity, LayoutDashboard, History, Bell, BookOpen, Cpu, Languages } from "lucide-react";
import { useAlerts } from "@/hooks/use-runs";
import { poolSize } from "@/lib/worker-pool";
import { useEffect, useState } from "react";

const nav = [
  { to: "/", key: "dashboard", icon: LayoutDashboard },
  { to: "/engines", key: "engines", icon: Cpu },
  { to: "/history", key: "history", icon: History },
  { to: "/alerts", key: "alerts", icon: Bell },
  { to: "/docs", key: "docs", icon: BookOpen },
] as const;

export function AppShell() {
  const { t, i18n } = useTranslation();
  const alerts = useAlerts();
  const state = useRouterState();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const dir = i18n.language === "ar" ? "rtl" : "ltr";
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = dir;
      document.documentElement.lang = i18n.language;
    }
  }, [dir, i18n.language]);

  const unread = alerts.filter(a => !a.read).length;

  return (
    <div className="min-h-screen bg-background text-foreground" dir={dir}>
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md gradient-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{t("app.title")}</div>
              <div className="text-[10px] text-muted-foreground">v1.0 · deterministic</div>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1 ms-4">
            {nav.map(n => {
              const active = state.location.pathname === n.to || (n.to !== "/" && state.location.pathname.startsWith(n.to));
              const Icon = n.icon;
              return (
                <Link key={n.to} to={n.to}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"}`}>
                  <Icon className="h-4 w-4" />
                  {t(`nav.${n.key}`)}
                  {n.key === "alerts" && unread > 0 && (
                    <span className="ms-1 rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-foreground">{unread}</span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            {mounted && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary/50 px-2 py-1 text-[11px] font-mono text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                {poolSize()} workers
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setLanguage(i18n.language === "ar" ? "en" : "ar")}>
              <Languages className="h-4 w-4" />
              {i18n.language === "ar" ? "EN" : "AR"}
            </Button>
          </div>
        </div>
      </header>
      <motion.main
        key={state.location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mx-auto max-w-[1600px] px-4 py-6"
      >
        <Outlet />
      </motion.main>
    </div>
  );
}