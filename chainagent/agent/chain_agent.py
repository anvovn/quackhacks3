import json
import os
from pathlib import Path
from google import genai
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
import snowflake.connector

load_dotenv()
print("VOICE ID:", os.getenv("ELEVENLABS_VOICE_ID"))

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")
SNOWFLAKE_USER = os.getenv("SNOWFLAKE_USER")
SNOWFLAKE_PASSWORD = os.getenv("SNOWFLAKE_PASSWORD")
SNOWFLAKE_ACCOUNT = os.getenv("SNOWFLAKE_ACCOUNT")

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "skus.json"


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def generate_text(client, prompt):
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
    )
    return response.text or ""


def trigger_voice(sku, days):
    from elevenlabs import stream
    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    audio_stream = client.text_to_speech.stream(
        voice_id=ELEVENLABS_VOICE_ID,
        text=f"Alert: {sku['name']} has only {days:.1f} days of stock left. Reorder immediately.",
        model_id="eleven_flash_v2_5",
    )
    stream(audio_stream)


def log_snowflake(sku, reasoning, email):
    conn = snowflake.connector.connect(
        user=SNOWFLAKE_USER,
        password=SNOWFLAKE_PASSWORD,
        account=SNOWFLAKE_ACCOUNT,
    )
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chainagent.logs.agent_runs (sku_name, reasoning, email) VALUES (%s, %s, %s)",
        (sku["name"], reasoning, email)
    )
    conn.commit()
    cursor.close()
    conn.close()


def run_agent(emit):
    client = get_gemini_client()

    with DATA_PATH.open() as sku_file:
        skus = json.load(sku_file)

    emit("WATCH", f"Polling {len(skus)} SKUs...")

    for sku in skus:
        days = sku["stock"] / sku["velocity_per_day"]
        emit("WATCH", f"{sku['name']} · days_left: {days:.1f}")

        if days < sku["lead_time_days"]:
            emit("RISK", f"Threshold breach: {sku['name']}")

            # Step 1: Gemini reasons about risk
            emit("THINK", "Invoking Gemini · reasoning...")
            reasoning = generate_text(
                client,
                f"You are a supply chain agent. Reason step by step.\n\nSKU {sku['name']}: {days:.1f} days stock left, lead time {sku['lead_time_days']} days. Velocity: {sku['velocity_per_day']}/day. Should I reorder? How many units?"
            )
            for line in reasoning.split("."):
                if line.strip(): emit("THINK", line.strip())

            # Step 2: Gemini drafts email
            emit("ACT", "Drafting supplier email...")
            email = generate_text(
                client,
                f"Draft urgent reorder email for {sku['name']} to {sku['supplier_name']}. Qty: {sku['reorder_qty']} units. Keep it professional and brief."
            )
            emit("EMAIL", email)
            trigger_voice(sku, days)
            log_snowflake(sku, reasoning, email)
