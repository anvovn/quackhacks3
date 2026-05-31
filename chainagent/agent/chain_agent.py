import json
import os
import re
import urllib.request
from pathlib import Path

from google import genai
from dotenv import load_dotenv

from agent.elevenlabs import trigger_voice
from agent.snowflake_log import log_snowflake

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LOCAL_SKUS_PATH   = DATA_DIR / "skus.json"
SUPPLEMENT_PATH   = DATA_DIR / "sku-supplement.json"
SHOPIFY_CFG_PATH  = DATA_DIR / "shopify-config.json"

DEFAULT_SUPPLEMENT = {
    "velocity_per_day": 30,
    "lead_time_days": 21,
    "supplier_name": "Shopify Store",
    "reorder_qty": 500,
}


def strip_markdown(text):
    text = re.sub(r'#{1,6}\s*', '', text)
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    text = re.sub(r'_([^_]+)_', r'\1', text)
    text = re.sub(r'`{1,3}([^`]*)`{1,3}', r'\1', text)
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _load_supplement() -> dict:
    try:
        return json.loads(SUPPLEMENT_PATH.read_text())
    except Exception:
        return {}


def _shopify_config() -> dict | None:
    store = os.getenv("SHOPIFY_STORE")
    token = os.getenv("SHOPIFY_TOKEN")
    if store and token:
        return {"store": store, "token": token}
    try:
        cfg = json.loads(SHOPIFY_CFG_PATH.read_text())
        if cfg.get("store") and cfg.get("token"):
            return cfg
    except Exception:
        pass
    return None


def _fetch_shopify_skus(store: str, token: str) -> list[dict]:
    url = f"https://{store}/admin/api/2024-01/products.json?fields=id,title,variants&limit=250"
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req, timeout=10) as resp:
        products = json.loads(resp.read())["products"]

    supplement = _load_supplement()
    skus = []
    for product in products:
        variants = product["variants"]
        for variant in variants:
            supp = (
                supplement.get(variant["sku"])
                or supplement.get(product["title"])
                or DEFAULT_SUPPLEMENT
            )
            label = (
                f" {variant['title']}"
                if len(variants) > 1 and variant["title"] != "Default Title"
                else ""
            )
            skus.append({
                "id": variant["sku"] or f"shopify-{variant['id']}",
                "name": f"{product['title']}{label}",
                "stock": variant["inventory_quantity"],
                "velocity_per_day": supp["velocity_per_day"],
                "lead_time_days": supp["lead_time_days"],
                "supplier_name": supp["supplier_name"],
                "reorder_qty": supp["reorder_qty"],
            })
    return skus


def load_skus(emit=None) -> list[dict]:
    cfg = _shopify_config()
    if cfg:
        try:
            skus = _fetch_shopify_skus(cfg["store"], cfg["token"])
            if emit:
                emit("STATUS", f"Loaded {len(skus)} SKUs from Shopify")
            return skus
        except Exception as exc:
            if emit:
                emit("STATUS", f"Shopify fetch failed ({exc}), falling back to local data")
    return json.loads(LOCAL_SKUS_PATH.read_text())


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

    skus = load_skus(emit)
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
