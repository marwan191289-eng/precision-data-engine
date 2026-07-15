import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TradingTerminal } from "@/components/terminal/TradingTerminal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Accurate Engine Terminal — Elliott · CVD · SMC · LSTM" },
      {
        name: "description",
        content:
          "Multi-engine trading analysis terminal with Elliott Wave, CVD, Smart Money Concepts, and in-browser LSTM neural predictions on live Binance data.",
      },
      { property: "og:title", content: "Accurate Engine Terminal" },
      {
        property: "og:description",
        content: "Elliott · CVD · SMC · LSTM confluence signals on live crypto data.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  // TF.js and Binance fetches are browser-only — mount client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-primary pulse-ring" style={{ color: "var(--color-primary)" }} />
          <span className="font-mono text-sm">initializing engines…</span>
        </div>
      </div>
    );
  }
  return <TradingTerminal />;
}
