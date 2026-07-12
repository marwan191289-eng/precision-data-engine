import type { EngineDefinition, EngineId } from "./types";
import { integrationEngine } from "./integration";
import { regressionEngine } from "./regression";
import { statisticsEngine } from "./statistics";
import { fftEngine } from "./fft";
import { odeEngine } from "./ode";

export const engines: Record<EngineId, EngineDefinition<any, any>> = {
  integration: integrationEngine,
  regression: regressionEngine,
  statistics: statisticsEngine,
  fft: fftEngine,
  ode: odeEngine,
};

export const engineList = Object.values(engines);