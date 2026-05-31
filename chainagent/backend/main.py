import asyncio
import json
import threading
from pathlib import Path

from fastapi import FastAPI, Body
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent.chain_agent import run_agent, adjust_shopify_inventory, load_skus, simulate_one_day

DATA_DIR     = Path(__file__).resolve().parents[1] / "data"
EMAIL_CONFIG = DATA_DIR / "email-config.json"
API_KEYS_FILE = DATA_DIR / "api-keys.json"

# Keys exposed to the UI — maps JSON field name → env var fallback
_KEY_DEFS = {
    "gemini_api_key":     "GEMINI_API_KEY",
    "gemini_model":       "GEMINI_MODEL",
    "elevenlabs_api_key": "ELEVENLABS_API_KEY",
    "elevenlabs_voice_id":"ELEVENLABS_VOICE_ID",
    "snowflake_user":     "SNOWFLAKE_USER",
    "snowflake_password": "SNOWFLAKE_PASSWORD",
    "snowflake_account":  "SNOWFLAKE_ACCOUNT",
    "sendgrid_api_key":   "SENDGRID_API_KEY",
    "email_from":         "EMAIL_FROM",
    "twilio_account_sid": "TWILIO_ACCOUNT_SID",
    "twilio_auth_token":  "TWILIO_AUTH_TOKEN",
    "twilio_from":        "TWILIO_FROM",
}

def _read_api_keys() -> dict:
    try:
        return json.loads(API_KEYS_FILE.read_text())
    except Exception:
        return {}

def _write_api_keys(keys: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    API_KEYS_FILE.write_text(json.dumps(keys, indent=2))


def _read_email_config() -> dict:
    try:
        return json.loads(EMAIL_CONFIG.read_text())
    except Exception:
        return {"enabled": False, "email": ""}


def _write_email_config(cfg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EMAIL_CONFIG.write_text(json.dumps(cfg, indent=2))

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="ChainAgent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],   # Next.js dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Shared in-process state
# ---------------------------------------------------------------------------

trace_queue: list[dict] = []
agent_thread: threading.Thread | None = None
approve_event = threading.Event()
cancel_event  = threading.Event()


def emit(tag: str, msg: str) -> None:
    """Append a tagged SSE event to the trace queue."""
    trace_queue.append({"tag": tag, "msg": msg})


def is_running() -> bool:
    return agent_thread is not None and agent_thread.is_alive()


def _agent_target(supplier_name: str = "", supplier_email: str = "") -> None:
    emit("STATUS", "Agent starting...")
    try:
        run_agent(emit, supplier_name=supplier_name, supplier_email=supplier_email)
    except Exception as exc:
        emit("ERROR", str(exc))
    finally:
        emit("STATUS", "Agent finished")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/run-agent")
async def start_agent(body: dict = Body(default={})):
    """Start the agent. Rejects if one is already running."""
    global agent_thread
    if is_running():
        return {"status": "already_running"}

    trace_queue.clear()
    approve_event.clear()
    cancel_event.clear()

    supplier = body.get("supplier", {})

    agent_thread = threading.Thread(
        target=_agent_target,
        args=(supplier.get("name", ""), supplier.get("email", "")),
        daemon=True,
    )
    agent_thread.start()
    return {"status": "started"}


@app.post("/approve")
async def approve_action():
    """Signal the agent to proceed past a human-approval checkpoint."""
    if not is_running():
        return {"status": "no_agent_running"}

    approve_event.set()
    return {"status": "approved"}


@app.post("/cancel")
async def cancel_agent():
    """Signal the agent to stop at the next safe checkpoint."""
    if not is_running():
        return {"status": "no_agent_running"}

    cancel_event.set()
    emit("STATUS", "Cancellation requested")
    return {"status": "cancelling"}


@app.get("/status")
async def get_status():
    """Return agent liveness, queue depth, and pending-approval state."""
    return {
        "status": "online",
        "agent_running": is_running(),
        "queue_depth": len(trace_queue),
        "awaiting_approval": is_running() and not approve_event.is_set(),
    }


@app.get("/stream")
async def stream():
    """SSE stream — proxied by Next.js app/api/stream/route.ts."""
    async def generator():
        seen = 0
        while True:
            if seen < len(trace_queue):
                event = trace_queue[seen]
                yield f"data: {json.dumps(event)}\n\n"
                seen += 1
            else:
                await asyncio.sleep(0.1)

    return StreamingResponse(generator(), media_type="text/event-stream")


class ReceiveBody(BaseModel):
    variant_id: int
    qty: int

@app.post("/reorder/receive")
def receive_reorder(body: ReceiveBody):
    """Adjust Shopify inventory when a reorder is marked as received."""
    try:
        result = adjust_shopify_inventory(body.variant_id, body.qty)
        return {"status": "received", "inventory_level": result}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.get("/skus")
async def get_skus():
    """Return the SKU list from Shopify."""
    return load_skus()


class EmailConfigBody(BaseModel):
    enabled: bool
    email: str


@app.get("/email-config")
def get_email_config():
    return _read_email_config()


@app.post("/email-config")
def save_email_config(body: EmailConfigBody):
    cfg = {"enabled": body.enabled, "email": body.email.strip()}
    _write_email_config(cfg)
    return {"status": "saved", **cfg}


@app.post("/email-test")
def send_test_email():
    from agent.twilio_email import SENDGRID_API_KEY, EMAIL_FROM, _send
    cfg = _read_email_config()
    to_email = cfg.get("email", "").strip()
    if not to_email:
        return {"status": "error", "detail": "No email address configured"}
    if not SENDGRID_API_KEY or not EMAIL_FROM:
        return {"status": "error", "detail": "SendGrid credentials not set in .env (SENDGRID_API_KEY, EMAIL_FROM)"}
    import urllib.error
    try:
        _send(
            to_email,
            subject="[ChainAgent] Test notification",
            body="ChainAgent: Test notification — your email alerts are working correctly.",
        )
        return {"status": "sent"}
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            detail = json.loads(body).get("errors", [{}])[0].get("message", body)
        except Exception:
            detail = body
        return {"status": "error", "detail": f"SendGrid {e.code}: {detail}"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/snowflake-logs")
def get_snowflake_logs():
    """Return agent action history from Snowflake."""
    from agent.snowflake_log import query_snowflake
    try:
        rows = query_snowflake(limit=200)
        # Snowflake timestamps are datetime objects — convert to ISO strings
        for row in rows:
            if hasattr(row.get("timestamp"), "isoformat"):
                row["timestamp"] = row["timestamp"].isoformat()
        return {"rows": rows}
    except Exception as exc:
        return {"rows": [], "error": str(exc)}


@app.post("/simulate-day")
def simulate_day():
    """Deduct one day of velocity from all SKUs in Shopify."""
    try:
        changes = simulate_one_day()
        return {"status": "ok", "changes": changes}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


import os as _os

@app.get("/api-keys")
def get_api_keys_status():
    """Return which keys are configured — booleans only, never raw values."""
    saved = _read_api_keys()
    result = {}
    for field, env_var in _KEY_DEFS.items():
        val = saved.get(field) or _os.getenv(env_var, "")
        result[field] = bool(val)
    return result


@app.post("/api-keys")
def save_api_keys(body: dict = Body(default={})):
    """Persist provided keys to data/api-keys.json. Empty string clears a key."""
    saved = _read_api_keys()
    for field in _KEY_DEFS:
        if field not in body:
            continue
        val = body[field].strip() if isinstance(body[field], str) else ""
        if val:
            saved[field] = val
        elif field in saved:
            del saved[field]
    _write_api_keys(saved)
    return {"status": "saved"}
