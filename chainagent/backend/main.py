import asyncio
import json
import os
import threading
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent.chain_agent import run_agent

_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

DATA_DIR     = Path(__file__).resolve().parents[1] / "data"
EMAIL_CONFIG = DATA_DIR / "email-config.json"


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
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
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


def _agent_target() -> None:
    """Thread target: runs the real agent and wraps it with lifecycle events."""
    emit("STATUS", "Agent starting...")
    try:
        run_agent(emit)
    except Exception as exc:
        emit("ERROR", str(exc))
    finally:
        emit("STATUS", "Agent finished")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/run-agent")
async def start_agent():
    """Start the agent. Rejects if one is already running."""
    global agent_thread
    if is_running():
        return {"status": "already_running"}

    # Reset all state for a fresh run
    trace_queue.clear()
    approve_event.clear()
    cancel_event.clear()

    agent_thread = threading.Thread(target=_agent_target, daemon=True)
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
    import urllib.error
    cfg = _read_email_config()
    to_email = cfg.get("email", "").strip()
    if not to_email:
        return {"status": "error", "detail": "No email address configured"}
    if not SENDGRID_API_KEY or not EMAIL_FROM:
        return {"status": "error", "detail": "SendGrid credentials not set in .env (SENDGRID_API_KEY, EMAIL_FROM)"}
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

