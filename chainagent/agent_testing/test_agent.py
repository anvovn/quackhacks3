import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Absolute path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ── minimal emit so we can see the trace ──────────────────────────────────────
def emit(tag, msg):
    print(f"[{tag}] {msg}")

# ── 1. test: env var is set ───────────────────────────────────────────────────
def test_env():
    key = os.getenv("GEMINI_API_KEY")
    assert key, "GEMINI_API_KEY is missing from .env"
    print(f"[ENV] Key found: {key[:8]}...")

# ── 2. test: gemini client connects ──────────────────────────────────────────
def test_client():
    from agent.chain_agent import get_gemini_client
    client = get_gemini_client()
    assert client is not None
    emit("CLIENT", "Gemini client created successfully")

# ── 3. test: model returns text ───────────────────────────────────────────────
def test_generate():
    from agent.chain_agent import get_gemini_client, generate_text
    client = get_gemini_client()
    response = generate_text(client, "Say hello in one sentence.")
    assert isinstance(response, str) and len(response) > 0
    emit("GENERATE", f"Response: {response}")

# ── 4. test: skus.json loads correctly ───────────────────────────────────────
def test_data():
    from agent.chain_agent import DATA_PATH
    import json
    with DATA_PATH.open() as f:
        skus = json.load(f)
    assert len(skus) > 0, "skus.json is empty"
    for sku in skus:
        assert "name" in sku
        assert "stock" in sku
        assert "velocity_per_day" in sku
        assert "lead_time_days" in sku
        assert "supplier_name" in sku
        assert "reorder_qty" in sku
    emit("DATA", f"{len(skus)} SKUs loaded and validated")

# ── 5. test: elevenlabs voice ─────────────────────────────────────────────────
def test_voice():
    from elevenlabs.client import ElevenLabs
    from elevenlabs import stream

    api_key = os.getenv("ELEVENLABS_API_KEY")
    voice_id = os.getenv("ELEVENLABS_VOICE_ID")

    assert api_key, "ELEVENLABS_API_KEY is missing from .env"
    assert voice_id, "ELEVENLABS_VOICE_ID is missing from .env"

    client = ElevenLabs(api_key=api_key)

    audio_stream = client.text_to_speech.stream(
        voice_id=voice_id,
        text="Alert: critical stock level detected for Widget A. Reorder immediately.",
        model_id="eleven_flash_v2_5"
    )

    emit("VOICE", "Playing audio live...")
    stream(audio_stream)
    emit("VOICE", "Playback complete")

# ── 6. test: full agent run (mocks voice + snowflake) ────────────────────────
def test_agent():
    import agent.chain_agent as agent_module

    agent_module.trigger_voice = lambda sku, days: emit("VOICE", f"[stubbed] alert for {sku['name']}")
    agent_module.log_snowflake = lambda sku, reasoning, email: emit("SNOWFLAKE", "[stubbed] log call")

    emit("AGENT", "Starting full agent run...")
    agent_module.run_agent(emit)

# ── run all ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    tests = [test_env, test_client, test_generate, test_data, test_voice, test_agent]
    for test in tests:
        print(f"\n{'─'*50}")
        print(f"Running: {test.__name__}")
        print('─'*50)
        try:
            test()
            print(f"✓ {test.__name__} passed")
        except Exception as e:
            print(f"✗ {test.__name__} FAILED: {e}")