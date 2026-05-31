import asyncio
import json
import threading
from pathlib import Path

from fastapi import FastAPI, Body
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent.chain_agent import run_agent, adjust_shopify_inventory, load_skus

DATA_DIR   = Path(__file__).resolve().parents[1] / "data"
SMS_CONFIG = DATA_DIR / "sms-config.json"


def _read_sms_config() -> dict:
    try:
        return json.loads(SMS_CONFIG.read_text())
    except Exception:
        return {"enabled": False, "phone": ""}


def _write_sms_config(cfg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SMS_CONFIG.write_text(json.dumps(cfg, indent=2))

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


class SmsConfigBody(BaseModel):
    enabled: bool
    phone: str


@app.get("/sms-config")
def get_sms_config():
    return _read_sms_config()


@app.post("/sms-config")
def save_sms_config(body: SmsConfigBody):
    cfg = {"enabled": body.enabled, "phone": body.phone.strip()}
    _write_sms_config(cfg)
    return {"status": "saved", **cfg}
