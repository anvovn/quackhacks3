# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.responses import StreamingResponse
import asyncio, json
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
import threading

app = FastAPI()
trace_queue = []

def emit(tag, msg):
    trace_queue.append({"tag": tag, "msg": msg})

# Temporary dummy agent loop for testing SSE
def dummy_agent_loop(emit_fn):
    import time
    emit_fn("status", "Agent starting...")
    time.sleep(1)
    emit_fn("reasoning", "Analyzing SKU risk...")
    time.sleep(1)
    emit_fn("reasoning", "Drafting supplier email...")
    time.sleep(1)
    emit_fn("status", "Agent finished")

@app.post("/run-agent")
async def start_agent():
    # In a real scenario, this might trigger the actual chain_agent.py
    # For now, it clears the queue and starts the dummy loop
    trace_queue.clear()
    t = threading.Thread(target=dummy_agent_loop, args=(emit,))
    t.start()
    return {"status": "started"}

@app.post("/approve")
async def approve_action():
    return {"status": "approved"}

@app.get("/status")
async def get_status():
    return {"status": "online"}

@app.get("/stream")
async def stream():
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
