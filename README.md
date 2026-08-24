# ai-trader-api

NestJS service: auth, users, broker session, paper trading, and the WebSocket gateway. TypeScript, MongoDB (Mongoose).

Part of the [ai-trader](https://github.com/devrunch/ai-trader) monorepo — run via the umbrella repo's `docker compose up`, not standalone in production. Deployable standalone to AWS Lambda too (`lambda.ts`, `serverless.yml`) for the HTTP API and SQS consumer — the WebSocket gateway does not run there (no WebSocket API configured), only under Docker Compose.

## What's here

One module per domain under `src/`, each with its own controller/service/DTO split:

| Module | Responsibility |
|---|---|
| `auth/` | Login, registration, JWT (cookie-based) |
| `broker/` | Zerodha session storage — the daily-refreshed Kite Connect access token, written by `ai-trader-signals`'s scripted login, read by both services |
| `portfolio/` | Paper trading — accounts, risk limits, order execution (split out of one 811-line service; see `portfolio-accounts.service.ts`/`risk-limits.service.ts`/`order-execution.service.ts`) |
| `market/` | Thin proxy to `ai-trader-signals`'s market-data routes |
| `signals/` | `SignalsGateway` (Socket.IO — signal broadcasts, order/position updates, and now live price ticks relayed from Redis), the SQS consumer, backtest evaluation |
| `chat/`, `brief/` | Chat agent proxy, pre-market brief |
| `chart-layouts/`, `watchlist/` | User-saved chart state and watchlists |
| `admin/`, `notifications/` | Admin endpoints; notifications is an intentional empty placeholder |
| `common/` | `UpstreamHttpClient` (the one seam for every call to `ai-trader-signals` — timeouts, retry-on-network-error, correct HTTP status mapping), guards (`InternalKeyGuard`, `JwtAuthGuard`, `RolesGuard`) |

## Real-time price ticks

`SignalsGateway` subscribes once to Redis's `market:ticks` channel (published by `ai-trader-signals`) and relays each message to the `symbol:${SYMBOL}` Socket.IO room as a `'tick'` event — the same room `broadcastSignal` already used, untouched. Per-(symbol, exchange) watcher reference counting (not just room membership — the same symbol can trade on two exchanges) decides when to tell `ai-trader-signals` to start/stop a subscription, including on ungraceful disconnect. `GET /internal/market/active-symbols` lets the Python service resubscribe everything after a restart.

## Local development

```bash
cp .env.example .env      # fill in real values
npm install
npm run start:dev
```

Needs a reachable `ai-trader-signals` (`SIGNALS_SERVICE_URL`), MongoDB, and Redis (`REDIS_URL`) — running the full stack via the umbrella repo's `docker compose up` is simpler than wiring these by hand.

## Testing

```bash
npx tsc --noEmit     # types
npm run lint         # eslint (flat config, added — was previously unwired)
npx jest             # 148 tests
```

## Environment

See `.env.example` for the full list. Notable ones: `INTERNAL_API_KEY` (shared secret for `ai-trader-signals`'s internal calls in), `SIGNALS_SERVICE_URL`, `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `FRONTEND_URL` (CORS + WebSocket origin), Zerodha credentials for the daily session refresh trigger.
