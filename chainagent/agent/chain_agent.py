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

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SUPPLEMENT_PATH   = DATA_DIR / "sku-supplement.json"
SHOPIFY_CFG_PATH  = DATA_DIR / "shopify-config.json"

DEFAULT_SUPPLEMENT = {
    "velocity_per_day": 30,
    "lead_time_days": 21,
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
                "variant_id": variant["id"],
                "name": f"{product['title']}{label}",
                "stock": variant["inventory_quantity"],
                "velocity_per_day": supp["velocity_per_day"],
                "lead_time_days": supp["lead_time_days"],
                "reorder_qty": supp["reorder_qty"],
            })
    return skus


def load_skus(emit=None) -> list[dict]:
    cfg = _shopify_config()
    if not cfg:
        raise RuntimeError("No Shopify store configured. Connect your store in Settings.")
    skus = _fetch_shopify_skus(cfg["store"], cfg["token"])
    if emit:
        emit("STATUS", f"Loaded {len(skus)} SKUs from Shopify")
    return skus


def _get_primary_location(store: str, token: str) -> int:
    url = f"https://{store}/admin/api/2024-01/locations.json"
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req, timeout=10) as resp:
        locations = json.loads(resp.read())["locations"]
    return locations[0]["id"]


def adjust_shopify_inventory(variant_id: int, qty: int) -> dict:
    cfg = _shopify_config()
    if not cfg:
        return {"error": "No Shopify config"}

    store, token = cfg["store"], cfg["token"]
    headers = {"X-Shopify-Access-Token": token}

    req = urllib.request.Request(
        f"https://{store}/admin/api/2024-01/variants/{variant_id}.json",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        inventory_item_id = json.loads(resp.read())["variant"]["inventory_item_id"]

    location_id = _get_primary_location(store, token)

    payload = json.dumps({
        "inventory_item_id": inventory_item_id,
        "location_id": location_id,
        "available_adjustment": qty,
    }).encode()
    req = urllib.request.Request(
        f"https://{store}/admin/api/2024-01/inventory_levels/adjust.json",
        data=payload,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


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


def run_agent(emit, supplier_name: str = "", supplier_email: str = ""):
    client = get_gemini_client()

    skus = load_skus(emit)
    emit("WATCH", f"Polling {len(skus)} SKUs...")

    effective_supplier = supplier_name or "your supplier"

    for sku in skus:
        days = sku["stock"] / sku["velocity_per_day"]
        emit("WATCH", f"{sku['name']} · days_left: {days:.1f}")

        if days < sku["lead_time_days"]:
            emit("RISK", f"Threshold breach: {sku['name']}")

            # Step 1: Gemini reasons about risk
            emit("THINK", "Invoking Gemini · reasoning...")
            raw_reasoning = generate_text(
                client,
                f"You are a supply chain agent. Explain in plain English, no markdown formatting.\n\nSKU {sku['name']}: {days:.1f} days stock left, lead time {sku['lead_time_days']} days. Velocity: {sku['velocity_per_day']}/day. Should we reorder? Explain your reasoning, then on the last line write exactly: REORDER_QTY: <number>"
            )
            qty_match = re.search(r"REORDER_QTY:\s*(\d+)", raw_reasoning)
            reorder_qty = int(qty_match.group(1)) if qty_match else sku["reorder_qty"]
            reasoning = strip_markdown(re.sub(r"REORDER_QTY:\s*\d+", "", raw_reasoning).strip())
            for line in reasoning.split("."):
                if line.strip(): emit("THINK", line.strip())

            # Step 2: Gemini drafts email from real data, no hardcoded placeholders
            emit("ACT", "Drafting supplier email...")
            email = strip_markdown(generate_text(
                client,
                f"""Write a short, professional plain-text reorder email using only the facts below.
Do not add any placeholder text such as [Your Name], [Title], or [Phone Number].
Sign off exactly as: "Portland Optics Operations\n— Sent automatically by ChainAgent"

Facts:
- Product: {sku['name']} (SKU: {sku['id']})
- Supplier: {effective_supplier}
- Current stock: {sku['stock']} units
- Sales rate: {sku['velocity_per_day']} units/day
- Stock runway: {days:.0f} days remaining
- Lead time on file: {sku['lead_time_days']} days
- Units needed: {reorder_qty}

Ask the supplier to confirm availability and earliest ship date. Under 100 words. Plain text only."""
            ))
            emit("EMAIL", email)
            emit("REORDER", json.dumps({
                "id": sku["id"],
                "variant_id": sku.get("variant_id"),
                "name": sku["name"],
                "qty": reorder_qty,
                "supplier": effective_supplier,
                "lead_time_days": sku["lead_time_days"],
            }))
            trigger_voice(sku, days)
            log_snowflake(sku, reasoning, email, days)
