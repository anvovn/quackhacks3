trace_queue = []

def emit(tag, msg):
    trace_queue.append({"tag": tag, "msg": msg})

def dummy_agent_loop(emit_fn):
    import time
    emit_fn("status", "Agent starting...")
    time.sleep(1)
    emit_fn("reasoning", "Analyzing SKU risk...")
    time.sleep(1)
    emit_fn("reasoning", "Drafting supplier email...")
    time.sleep(1)
    emit_fn("status", "Agent finished")
