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
    api_key = os.getenv("ELEVENLABS_API_KEY")
    voice_id = os.getenv("ELEVENLABS_VOICE_ID")

    assert api_key, "ELEVENLABS_API_KEY is missing from .env"
    assert voice_id, "ELEVENLABS_VOICE_ID is missing from .env"

    from agent.elevenlabs import trigger_voice

    emit("VOICE", "Playing audio live...")
    trigger_voice(
        {"name": "Widget A"},
        1.5,
    )
    emit("VOICE", "Playback complete")

# ── 6. test: snowflake connection and insert ──────────────────────────────────
def test_snowflake():
    import snowflake.connector

    user     = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    account  = os.getenv("SNOWFLAKE_ACCOUNT")

    assert user,     "SNOWFLAKE_USER is missing from .env"
    assert password, "SNOWFLAKE_PASSWORD is missing from .env"
    assert account,  "SNOWFLAKE_ACCOUNT is missing from .env"

    conn = snowflake.connector.connect(
        user=user,
        password=password,
        account=account,
    )
    cursor = conn.cursor()

    # insert a test row
    cursor.execute(
        "INSERT INTO CHAINAGENT.PUBLIC.agent_actions (timestamp, sku_id, sku_name, days_left, reasoning, email_draft, status) VALUES (CURRENT_TIMESTAMP, %s, %s, %s, %s, %s, 'pending')",
        ("TEST-001", "Test SKU", 5.0, "This is a test reasoning entry.", "This is a test email draft.")
    )
    conn.commit()

    # read it back
    cursor.execute("SELECT * FROM CHAINAGENT.PUBLIC.agent_actions ORDER BY timestamp DESC LIMIT 1")
    row = cursor.fetchone()
    assert row is not None, "No rows found — insert failed"
    emit("SNOWFLAKE", f"Row inserted and retrieved: {row}")

    cursor.close()
    conn.close()

# ── 7. test: full agent run (mocks voice + snowflake) ────────────────────────
def test_agent():
    import agent.chain_agent as agent_module
    import agent.elevenlabs as voice_module
    import agent.snowflake_log as snowflake_module

    def stub_voice(sku, days):
        emit("VOICE", f"[stubbed] alert for {sku['name']}")

    def stub_snowflake(sku, reasoning, email, days):
        emit("SNOWFLAKE", "[stubbed] log call")

    voice_module.trigger_voice = stub_voice
    snowflake_module.log_snowflake = stub_snowflake
    agent_module.trigger_voice = stub_voice
    agent_module.log_snowflake = stub_snowflake

    emit("AGENT", "Starting full agent run...")
    agent_module.run_agent(emit)

# ── run all ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    tests = [test_env, test_client, test_generate, test_data, test_voice, test_snowflake, test_agent]
    for test in tests:
        print(f"\n{'─'*50}")
        print(f"Running: {test.__name__}")
        print('─'*50)
        try:
            test()
            print(f"✓ {test.__name__} passed")
        except Exception as e:
            print(f"✗ {test.__name__} FAILED: {e}")