# btc-race-dipbot-2

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/cleoworks/btc-race-dipbot-2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/cleoworks/btc-race-dipbot-2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Washout-primary cbBTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC.

The bot trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars, paper money only. It buys 80% of cash after a confirmed washout — close at least 55 bps below its 45-bar mean and at least 20 bps recovered off the prior 10-bar low, while the 240-bar return is no worse than -50 bps — and exits at +60 bps take-profit, -80 bps stop, or 30 bars max hold. A small late fallback leg insures the >= 1 trade guardrail, and a 6% equity-drawdown circuit breaker stops new entries.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (see `vendor/makefun-bars.ts`, a byte-identical copy of the kit SDK shim). Standard library only; no network, no clock, no files; deterministic.

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
