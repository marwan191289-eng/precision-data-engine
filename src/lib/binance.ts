import type { Candle } from "./engines/types";

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Symbol {
  symbol: string;
  label: string;
}

export const POPULAR_SYMBOLS: Symbol[] = [
  { symbol: "BTCUSDT",  label: "BTC / USDT"  },
  { symbol: "ETHUSDT",  label: "ETH / USDT"  },
  { symbol: "BNBUSDT",  label: "BNB / USDT"  },
  { symbol: "SOLUSDT",  label: "SOL / USDT"  },
  { symbol: "XRPUSDT",  label: "XRP / USDT"  },
  { symbol: "ADAUSDT",  label: "ADA / USDT"  },
  { symbol: "LTCUSDT",  label: "LTC / USDT"  },
  { symbol: "BCHUSDT",  label: "BCH / USDT"  },
  { symbol: "AAVEUSDT", label: "AAVE / USDT" },
  { symbol: "AVAXUSDT", label: "AVAX / USDT" },
  { symbol: "DOGEUSDT", label: "DOGE / USDT" },
];

/**
 * Fetch klines from Binance public REST API.
 * Kline array shape:
 * [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume,
 *  trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]
 */
export async function fetchCandles(
  symbol: string,
  interval: Interval,
  limit = 500,
): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((k, i) => ({
    time: Number(k[6]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    takerBuyBaseVolume: Number(k[9]),
    // REST klines: every candle except the last is definitively closed.
    // The final element is the still-building candle.
    isClosed: i < raw.length - 1,
  }));
}
