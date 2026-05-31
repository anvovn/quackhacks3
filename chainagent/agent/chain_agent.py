import json
import os
import re
from pathlib import Path

from google import genai
from dotenv import load_dotenv

from agent.elevenlabs import trigger_voice
from agent.snowflake_log import log_snowflake

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")


def strip_markdown(text):
    text = re.sub(r'#{1,6}\s*', '', text)          # headings
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)  # bold/italic
    text = re.sub(r'_([^_]+)_', r'\1', text)       # underscores
    text = re.sub(r'`{1,3}([^`]*)`{1,3}', r'\1', text)    # inline code / code blocks
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)  # bullet points
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)  # numbered lists
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)  # links
    text = re.sub(r'\n{3,}', '\n\n', text)         # excess blank lines
    return text.strip()

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
            reasoning = strip_markdown(generate_text(
                client,
                f"You are a supply chain agent. Explain in plain English, no markdown formatting.\n\nSKU {sku['name']}: {days:.1f} days stock left, lead time {sku['lead_time_days']} days. Velocity: {sku['velocity_per_day']}/day. Should I reorder? How many units?"
            ))
            for line in reasoning.split("."):
                if line.strip(): emit("THINK", line.strip())

            # Step 2: Gemini drafts email
            emit("ACT", "Drafting supplier email...")
            email = strip_markdown(generate_text(
                client,
                f"Draft urgent reorder email for {sku['name']} to {sku['supplier_name']}. Qty: {sku['reorder_qty']} units. Keep it professional and brief. Use plain text only, no markdown."
            ))
            emit("EMAIL", email)
            trigger_voice(sku, days)
            log_snowflake(sku, reasoning, email, days)
