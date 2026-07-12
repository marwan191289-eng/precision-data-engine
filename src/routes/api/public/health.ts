import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => Response.json({
        ok: true,
        service: "precision-engine-suite",
        version: "1.0.0",
        engines: ["integration", "regression", "statistics", "fft", "ode"],
        timestamp: new Date().toISOString(),
      }, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      }),
      OPTIONS: async () => new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
        },
      }),
    },
  },
});