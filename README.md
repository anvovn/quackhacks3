# ChainAgent

AI-powered supply chain management dashboard for Portland Optics. Monitors live Shopify inventory, uses Gemini to reason about reorder risk, drafts supplier emails, and tracks inbound shipments.

---

## Architecture Overview

```
Browser (Next.js 14)
    ↕  HTTP / SSE
Next.js API Routes  (/app/api/*)
    ↕  HTTP  (localhost:8000)
FastAPI Backend  (Python)
    ↕
Agent Modules  (Python)
    ↕  External APIs
Shopify · Gemini · Snowflake · SendGrid · Twilio · ElevenLabs
```

---

## Setup

### System Dependencies (Mac)

```bash
brew install portaudio   # required for pyaudio (audio playback)
brew install mpv         # required for elevenlabs audio streaming
```

### Python Dependencies

```bash
pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file in the `chainagent/` directory:

```env
# Google Gemini
GEMINI_API_KEY=

# Shopify - Configure via app

# Snowflake
SNOWFLAKE_USER=
SNOWFLAKE_PASSWORD=
SNOWFLAKE_ACCOUNT=

# SendGrid (email alerts)
SENDGRID_API_KEY=
EMAIL_FROM=alerts@yourdomain.com

# ElevenLabs (voice alerts)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

### Running the App

```bash
# Terminal 1 — Python backend
cd chainagent
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — Next.js frontend
cd chainagent
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Backend — `chainagent/backend/main.py`

FastAPI server. All agent state is held in-process (no database).

| Endpoint | Method | Description |
|---|---|---|
| `/run-agent` | POST | Starts agent thread, clears trace queue. Body: `{supplier: {name, email}, pending_ids: []}` |
| `/stream` | GET | SSE stream — yields `{tag, msg}` events from `trace_queue` continuously |
| `/status` | GET | Returns `{agent_running, awaiting_approval, queue_depth}` |
| `/approve` | POST | Sets `approve_event` to signal agent approval |
| `/cancel` | POST | Sets `cancel_event`, emits STATUS cancellation message |
| `/reorder/receive` | POST | Adjusts Shopify inventory when a reorder is received. Body: `{variant_id, qty}` |
| `/skus` | GET | Returns live Shopify products + real 30-day velocity |
| `/snowflake-logs` | GET | Queries `CHAINAGENT.PUBLIC.agent_actions`, returns last 200 rows |
| `/email-config` | GET/POST | Reads/writes `data/email-config.json` |
| `/email-test` | POST | Sends a test alert email via SendGrid |

### SSE Event Tags

The `/stream` endpoint emits `{tag, msg}` events the frontend consumes:

| Tag | Meaning |
|---|---|
| `STATUS` | Agent lifecycle messages (starting, finished, errors) |
| `WATCH` | Per-SKU inventory check log line |
| `THINK` | Gemini reasoning output (one sentence per event) |
| `RISK` | Threshold breach — reorder recommended |
| `ACT` | Agent is drafting the supplier email |
| `EMAIL` | Full email draft text |
| `REORDER` | JSON: `{id, variant_id, name, qty, supplier, lead_time_days}` |
| `ERROR` | Runtime error message |

---

## Agent — `chainagent/agent/`

### `chain_agent.py` — Core agent loop

Runs on each agent invocation:

1. Fetches all Shopify products (`products.json`)
2. Fetches 30-day order history to compute real `velocity_per_day` per SKU (`orders.json`)
3. Skips SKUs with no velocity data (no sales in last 30 days)
4. Skips SKUs whose ID is in `pending_ids` (reorder already in progress)
5. Skips SKUs with `days_left >= 30` — emits "healthy, no action needed"
6. For flagged SKUs: calls Gemini with stock/velocity/days, asks for `REORDER_QTY: <n>`
7. Parses qty from Gemini output, strips markdown, emits `THINK` trace lines
8. Calls Gemini again to draft a plain-text supplier email
9. Emits `EMAIL` + `REORDER`, then calls `trigger_voice` and `log_snowflake`

**Thresholds (configurable at top of file):**
- `VELOCITY_DAYS = 30` — lookback window for computing sales velocity
- `REORDER_THRESHOLD_DAYS = 30` — flag SKUs with less than this many days of stock
- Gemini is asked to replenish to `REORDER_THRESHOLD_DAYS * 2` (60 days of supply)

**Shopify APIs used:**
- `GET /admin/api/2024-01/products.json` — all products and variants
- `GET /admin/api/2024-01/orders.json` — order history for velocity
- `GET /admin/api/2024-01/locations.json` — primary location for inventory adjust
- `GET /admin/api/2024-01/variants/{id}.json` — get `inventory_item_id`
- `POST /admin/api/2024-01/inventory_levels/adjust.json` — restock on "Mark as Received"

**Gemini API used:**
- Model: `gemini-3.5-flash` (configurable via `GEMINI_MODEL` env var)
- Call 1: Reasoning prompt → outputs `REORDER_QTY: <n>` on the last line
- Call 2: Email drafting prompt → plain-text supplier email, no placeholders

---

### `snowflake_log.py` — Audit trail

Every agent reorder action is logged to Snowflake.

**Table:** `CHAINAGENT.PUBLIC.agent_actions`

| Column | Type | Description |
|---|---|---|
| `timestamp` | TIMESTAMP | When the action was logged |
| `sku_id` | VARCHAR | Shopify variant SKU code |
| `sku_name` | VARCHAR | Product display name |
| `days_left` | FLOAT | Days of stock at time of flagging |
| `reasoning` | TEXT | Gemini's reasoning (markdown stripped) |
| `email_draft` | TEXT | The drafted supplier email |
| `status` | VARCHAR | Always `'pending'` on insert |

**Functions:**
- `log_snowflake(sku, reasoning, email, days)` — INSERT
- `query_snowflake(limit=100)` — SELECT latest rows for the Inquiries tab

---

### `elevenlabs.py` — Voice alerts

Streams a TTS audio alert to local speakers when a SKU is flagged.

- **API:** ElevenLabs SDK (`elevenlabs.client.ElevenLabs`)
- **Model:** `eleven_flash_v2_5`
- **Voice:** configured via `ELEVENLABS_VOICE_ID` env var

---

### `twilio_email.py` — Email alerts (founder notifications)

Sends an alert email to the founder when a SKU is flagged. Separate from the supplier reorder email.

- **Recipient:** configured in `data/email-config.json` via the Notifications UI
- **API:** SendGrid v3 REST — `POST https://api.sendgrid.com/v3/mail/send`
- **Auth:** `Authorization: Bearer {SENDGRID_API_KEY}`
- **Sender:** `EMAIL_FROM` env var (must be a verified SendGrid sender)

---

### `twilio_sms.py` — SMS alerts

Sends an SMS to the founder's phone when a SKU is flagged.

- **Recipient:** configured in `data/sms-config.json` via the Notifications UI
- **API:** Twilio REST — `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`
- **Auth:** HTTP Basic — `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`

---

### `gemini_parser.py` — PDF supplier contract parser

Feed a supplier PDF to Gemini and extract structured data. Writes `lead_time_days` back to `data/sku-supplement.json` automatically.

- **API:** Google Gemini multimodal — `Part.from_bytes(pdf_bytes, mime_type="application/pdf")`
- **Extracts:** `lead_time_days` (int), `moq` (int), `unit_price` (float)

---

## Frontend — `chainagent/app/`

### Next.js API Routes (`/app/api/`)

All routes act as thin proxies to either the Python backend or Shopify directly.

| Route | Backend | Notes |
|---|---|---|
| `/api/stream` | Python `:8000` | Pipes SSE body directly — no buffering |
| `/api/run-agent` | Python `:8000` | Passes supplier + pending_ids |
| `/api/approve` | Python `:8000` | |
| `/api/cancel` | Python `:8000` | |
| `/api/status` | Python `:8000` | 2s timeout, returns `"offline"` gracefully |
| `/api/reorder/receive` | Python `:8000` | |
| `/api/snowflake-logs` | Python `:8000` | `force-dynamic`, no cache |
| `/api/email-config` | Python `:8000` | 3s timeout |
| `/api/email-test` | Python `:8000` | 15s timeout |
| `/api/sms-config` | Python `:8000` | 3s timeout |
| `/api/sms-test` | Python `:8000` | 15s timeout |
| `/api/skus` | **Shopify direct** | Products + 30-day velocity, computed in Next.js |
| `/api/orders` | **Shopify direct** | Last 50 customer orders |
| `/api/deliveries` | **Shopify direct** | Fulfillment times grouped by country |
| `/api/suppliers` | **Shopify direct** | Vendor names extracted from products |
| `/api/settings` | **Shopify direct** | Validates credentials, writes `shopify-config.json` |

### `hooks/useAgentStream.ts`

Core React hook managing all agent state:

- Polls `/api/status` every 2s (5s when offline)
- Opens an `EventSource` to `/api/stream` on each run
- Handles `EMAIL` tag → sets `emailContent`, `showEmail`
- Handles `REORDER` tag → stages reorder; if user approved early, adds to `pendingReorders` immediately
- Exposes: `trace`, `agentRunning`, `showEmail`, `emailContent`, `emailResult`, `showReply`, `pendingReorders`, `stagedReorder`, `runAgent()`, `approve()`, `cancel()`, `reset()`, `removeReorder()`

### `dashboard/page.tsx` — Main UI

Single-page dashboard (~1600 lines) with sidebar navigation.

| Section | Data source | Persisted |
|---|---|---|
| Overview | Shopify resync + local brand config | — |
| Agent Control | SSE stream via `useAgentStream` | Session only |
| Inventory | `/api/skus` (Shopify live) | — |
| Stock Inbounds | `pendingReorders` from SSE | Session only |
| Agent Orders | Purchase orders + audit log | `localStorage` |
| Agent Inquiries | `/api/snowflake-logs` → Snowflake | Snowflake (permanent) |
| Notifications | `/api/email-config`, `/api/sms-config` | `data/*.json` |
| Settings | `/api/settings`, agent prefs | `data/shopify-config.json` + `localStorage` |

---

## Data Files — `chainagent/data/`

| File | Purpose |
|---|---|
| `shopify-config.json` | Shopify store domain and access token |
| `sku-supplement.json` | Per-SKU overrides for velocity, lead time, supplier name, reorder qty. Used as fallback and updated by the PDF parser |
| `email-config.json` | SendGrid recipient address and enabled flag |
| `sms-config.json` | Twilio recipient phone number and enabled flag |

### `sku-supplement.json` format

```json
{
  "DHOD5-EC999003": {
    "velocity_per_day": 31,
    "lead_time_days": 21,
    "supplier_name": "Supplier Name",
    "reorder_qty": 600
  }
}
```

Keys are matched against Shopify variant SKU codes first, then product titles. Unmatched products fall back to `DEFAULT_SUPPLEMENT` in `chain_agent.py`.

---

## Stock Inbounds Flow

```
Agent flags SKU → Gemini outputs REORDER_QTY
    ↓
Backend emits EMAIL + REORDER events via SSE
    ↓
Frontend stages reorder (stagedReorder state)
    ↓
User clicks "Approve & Send"
    → pendingReorders[] updated
    → "Stock Inbounds" card appears with ETA countdown
    ↓
User clicks "Mark as Received" on inbound card
    → POST /api/reorder/receive {variant_id, qty}
    → Shopify inventory_levels/adjust +qty
    → Card removed, dashboard inventory refreshes
```

**Note:** The ETA countdown is calculated from `Date.now() + lead_time_days`. Nothing happens automatically when it reaches zero — "Mark as Received" must be clicked manually to actually update Shopify.
