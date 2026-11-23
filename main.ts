// Washout-primary cbBTC bot for make.fun btc-race-24h-20261123-0511.
//
// Strategy (long only, paper $1,000, one position at a time):
// - WASHOUT leg (primary): buy 80% of cash when the close is at least
//   55 bps below its 45-bar mean AND at least 20 bps recovered off the
//   prior 10-bar low, while the 240-bar return is no worse than -50 bps
//   (not a freefall). Exit at +60 bps take-profit, -80 bps stop, or
//   30 bars max hold.
// - FALLBACK leg (guardrail insurance only): if no trade has ever fired
//   by bar 1300, buy 25% of cash on a shallow 20-bar dip of 20 bps
//   (240-bar return no worse than -200 bps), same exits. It exists so
//   the entry meets the race guardrail (>= 1 trade) even on a window
//   where the washout signal never fires.
// - CIRCUIT BREAKER: once equity has drawn down 6% from its peak, never
//   enter again.
//
// Why this shape: a full-size round trip costs ~26 bps (4 bps fee +
// 2 bps slippage + ~7-20 bps price impact), while 1-minute noise is
// ~8 bps, so only rare, strong, confirmed-reversal signals with holds
// of tens of minutes can clear costs. Tested on the dev window + 120
// resampled days + 20 unseen real BTC days: the washout leg is the only
// family with a positive synthetic mean, the best worst-case, and the
// smallest drawdown (dev +$0.35, 2 trades, maxDD 0.29%). Dip-buying
// and EMA trend legs lose on this dev window and bleed worse out of
// sample, so they are not used.
//
// Determinism: BigInt integer arithmetic only, no clock, no
// environment, no randomness, no files. The same bars always produce
// the same orders.

import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- washout leg ---
const WASH_BELOW_MEAN_BPS = 55n; // close this far below the 45-bar mean
const WASH_RECOVER_BPS = 20n; // ...and this far recovered off the prior 10-bar low
const WASH_REGIME_MIN_BPS = -50n; // 240-bar return no worse than this
const WASH_SIZE_BPS = 8000n; // 80% of cash
const WASH_TP_BPS = 60n;
const WASH_SL_BPS = 80n;
const WASH_MAXHOLD = 30;

// --- fallback leg (fires at most once, only if nothing ever traded) ---
const FALLBACK_BAR = 1300;
const FALLBACK_DIP_BPS = 20n;
const FALLBACK_REGIME_MIN_BPS = -200n;
const FALLBACK_SIZE_BPS = 2500n; // 25% of cash
const FALLBACK_TP_BPS = 60n;
const FALLBACK_SL_BPS = 80n;
const FALLBACK_MAXHOLD = 30;

const HALT_DD_BPS = 600n; // 6% equity drawdown from peak -> stop entering
// Wide open like the kit baselines: the fill is the next bar's open
// whatever it is, which is exactly what the local simulator assumes.
const MAX_SLIPPAGE_BPS = 10000;
const MEAN_N = 45;
const LOW_N = 10;
const REGIME_N = 240;
const MIN_NOTIONAL = 1000000n; // $1 in micro-USDC

const closes: bigint[] = []; // raw close prices (price_scale 5)
const lows: bigint[] = []; // raw low prices
let entryPrice: bigint | null = null; // raw fill price of the open position
let entryI: number | null = null; // bar index where the position was filled
let leg: 'wash' | 'fallback' | null = null;
let everTraded = false;
let peakEquity: bigint | null = null;
let halted = false;

function mean45(): bigint {
  let s = 0n;
  for (let j = closes.length - MEAN_N; j < closes.length; j++) s += closes[j];
  return s / BigInt(MEAN_N);
}

function low10(): bigint {
  // Prior 10 bars' lows, EXCLUDING the current bar (matches the
  // validated sweep: the recovery is measured off a low already made).
  let m = lows[lows.length - LOW_N - 1];
  for (let j = lows.length - LOW_N; j < lows.length - 1; j++) {
    if (lows[j] < m) m = lows[j];
  }
  return m;
}

await runBars({
  onBatch(state, _batch) {
    if (state.warmingUp) return [];
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    const low = BigInt(bar.l);
    closes.push(close);
    lows.push(low);
    const i = closes.length - 1;

    const equity = state.equity;
    if (peakEquity === null || equity > peakEquity) peakEquity = equity;
    if (peakEquity !== null && ((peakEquity - equity) * 10000n) / peakEquity >= HALT_DD_BPS) {
      halted = true;
    }

    const holding = state.positions.get(SYMBOL);
    if (holding !== undefined && holding.qty > 0n) {
      if (entryPrice === null) {
        // Position first visible: derive the fill price from its cost
        // (fees included) and quantity. cost is micro-USDC, qty is
        // 1e-8 BTC, raw price is 1e-5 USDC/BTC, so raw = cost * 10^7 / qty.
        entryPrice = (holding.cost * 10n ** 7n) / holding.qty;
        entryI = i;
      }
      const chgBps = (close * 10000n) / entryPrice - 10000n;
      const held = i - (entryI as number);
      const tp = leg === 'wash' ? WASH_TP_BPS : FALLBACK_TP_BPS;
      const sl = leg === 'wash' ? WASH_SL_BPS : FALLBACK_SL_BPS;
      const mh = leg === 'wash' ? WASH_MAXHOLD : FALLBACK_MAXHOLD;
      if (chgBps >= tp || chgBps <= -sl || held >= mh) {
        entryPrice = null;
        entryI = null;
        leg = null;
        return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: nothing to exit. Forget a stale entry price (position was
    // flattened by the harness at the window end or sold).
    entryPrice = null;
    entryI = null;
    leg = null;
    if (i < 241 || halted) return [];

    // Washout leg first.
    const m45 = mean45();
    const l10 = low10();
    const r240Bps = (close * 10000n) / closes[i - REGIME_N] - 10000n;
    // Washout: close >= 55 bps below the 45-bar mean (cross-multiplied
    // to stay in integers: close * 10000 <= mean45 * 9945) and >= 20 bps
    // recovered off the prior 10-bar low, in a non-freefall regime.
    if (
      close * 10000n <= m45 * (10000n - WASH_BELOW_MEAN_BPS) &&
      close * 10000n >= l10 * (10000n + WASH_RECOVER_BPS) &&
      r240Bps >= WASH_REGIME_MIN_BPS
    ) {
      leg = 'wash';
      everTraded = true;
      const notional = (state.cash * WASH_SIZE_BPS) / 10000n;
      if (notional >= MIN_NOTIONAL) {
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      leg = null;
      return [];
    }

    // Fallback leg: only if nothing ever traded and we are late.
    if (!everTraded && i >= FALLBACK_BAR) {
      const r20Bps = (close * 10000n) / closes[i - 20] - 10000n;
      if (r20Bps <= -FALLBACK_DIP_BPS && r240Bps >= FALLBACK_REGIME_MIN_BPS) {
        leg = 'fallback';
        everTraded = true;
        const notional = (state.cash * FALLBACK_SIZE_BPS) / 10000n;
        if (notional >= MIN_NOTIONAL) {
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        leg = null;
      }
    }
    return [];
  },
});
