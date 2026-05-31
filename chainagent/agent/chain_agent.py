import json
import os
import re
import urllib.request
from pathlib import Path

from google import genai
from dotenv import load_dotenv

from agent.elevenlabs import trigger_voice
from agent.snowflake_log import log_snowflake
from agent.twilio_email import trigger_email
from agent.config import get_key

load_dotenv()

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SHOPIFY_CFG_PATH = DATA_DIR / "shopify-config.json"

VELOCITY_DAYS = 30
REORDER_THRESHOLD_DAYS = 14  # only analyze SKUs with less than this many days of stock

SUPPLEMENT_PATH = DATA_DIR / "sku-supplement.json"
SIM_FALLBACK_VELOCITY = 5  # units/day used when no order or supplement data exists


def _load_supplement() -> dict:
    try:
        return json.loads(SUPPLEMENT_PATH.read_text())
    except Exception:
        return {}


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


def _fetch_velocity(store: str, token: str) -> dict[str, float]:
    import datetime
    since = (datetime.datetime.utcnow() - datetime.timedelta(days=VELOCITY_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = (
        f"https://{store}/admin/api/2024-01/orders.json"
        f"?status=any&created_at_min={since}&fields=line_items&limit=250"
    )
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        orders = json.loads(resp.read())["orders"]

    units: dict[str, int] = {}
    for order in orders:
        for item in order.get("line_items", []):
            sku = item.get("sku")
            if sku:
                units[sku] = units.get(sku, 0) + item["quantity"]

    return {sku: round(total / VELOCITY_DAYS, 1) for sku, total in units.items()}


def _fetch_shopify_skus(store: str, token: str) -> list[dict]:
    url = f"https://{store}/admin/api/2024-01/products.json?fields=id,title,variants&limit=250"
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req, timeout=10) as resp:
        products = json.loads(resp.read())["products"]

    velocity = _fetch_velocity(store, token)

    skus = []
    for product in products:
        variants = product["variants"]
        for variant in variants:
            label = (
                f" {variant['title']}"
                if len(variants) > 1 and variant["title"] != "Default Title"
                else ""
            )
            sku_id = variant["sku"] or f"shopify-{variant['id']}"
            vel = velocity.get(variant["sku"]) if variant["sku"] else None
            skus.append({
                "id": sku_id,
                "variant_id": variant["id"],
                "name": f"{product['title']}{label}",
                "stock": variant["inventory_quantity"],
                "velocity_per_day": vel,  # None means no sales data
                "velocity_source": "shopify_orders" if vel else "no_data",
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


def simulate_one_day() -> list[dict]:
    """Deduct one day of sales velocity from every SKU in Shopify."""
    cfg = _shopify_config()
    if not cfg:
        raise RuntimeError("No Shopify config")

    store, token = cfg["store"], cfg["token"]
    supplement = _load_supplement()

    url = f"https://{store}/admin/api/2024-01/products.json?fields=id,title,variants&limit=250"
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req, timeout=10) as resp:
        products = json.loads(resp.read())["products"]

    # Use live order velocity where available, fall back to supplement, then SIM_FALLBACK_VELOCITY
    try:
        live_velocity = _fetch_velocity(store, token)
    except Exception:
        live_velocity = {}

    changes = []
    for product in products:
        for variant in product["variants"]:
            sku_id = variant["sku"] or f"shopify-{variant['id']}"
            supp = supplement.get(variant.get("sku", "")) or supplement.get(product["title"]) or {}
            vel = (
                live_velocity.get(variant.get("sku", ""))
                or supp.get("velocity_per_day")
                or SIM_FALLBACK_VELOCITY
            )
            deduct = max(1, round(vel))
            stock = variant["inventory_quantity"]
            if stock <= 0:
                continue
            actual = min(deduct, stock)
            try:
                adjust_shopify_inventory(variant["id"], -actual)
                label = (
                    f" {variant['title']}"
                    if len(product["variants"]) > 1 and variant["title"] != "Default Title"
                    else ""
                )
                changes.append({
                    "name": f"{product['title']}{label}",
                    "id": sku_id,
                    "deducted": actual,
                    "remaining": stock - actual,
                })
            except Exception:
                pass

    return changes


def get_gemini_client():
    api_key = get_key("gemini_api_key", "GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def generate_text(client, prompt):
    model = get_key("gemini_model", "GEMINI_MODEL") or "gemini-2.5-flash"
    response = client.models.generate_content(
        model=model,
        contents=prompt,
    )
    return response.text or ""


def run_agent(emit, supplier_name: str = "", supplier_email: str = ""):
    client = get_gemini_client()

    skus = load_skus(emit)
    emit("WATCH", f"Polling {len(skus)} SKUs...")

    effective_supplier = supplier_name or "your supplier"

    skus_with_data = [s for s in skus if s["velocity_per_day"] is not None]
    skus_no_data   = [s for s in skus if s["velocity_per_day"] is None]

    for sku in skus_no_data:
        emit("WATCH", f"{sku['name']} · no sales data in last {VELOCITY_DAYS} days — skipping")

    for sku in skus_with_data:
        vel = sku["velocity_per_day"]
        stock = sku["stock"]
        days = stock / vel if vel > 0 else float("inf")
        emit("WATCH", f"{sku['name']} · {vel}/day (shopify_orders) · {stock} units · days_left: {days:.1f}")

        if days >= REORDER_THRESHOLD_DAYS:
            emit("WATCH", f"{sku['name']} · {days:.0f} days stock — healthy, no action needed")
            continue

        # Step 1: Gemini reasons about risk and recommends reorder qty + urgency
        emit("THINK", "Invoking Gemini · reasoning...")
        raw_reasoning = generate_text(
            client,
            f"""You are a supply chain agent. Explain in plain English, no markdown.

SKU: {sku['name']} (ID: {sku['id']})
Current stock: {stock} units
Sales velocity: {vel} units/day (from last {VELOCITY_DAYS} days of real Shopify orders)
Days of stock remaining: {days:.1f}
Reorder threshold: {REORDER_THRESHOLD_DAYS} days

Stock is below the reorder threshold. Calculate how many units to order to restore {REORDER_THRESHOLD_DAYS * 2} days of supply.
Be specific about urgency. End your response with exactly: REORDER_QTY: <number>"""
        )
        qty_match = re.search(r"REORDER_QTY:\s*(\d+)", raw_reasoning)
        reorder_qty = int(qty_match.group(1)) if qty_match else 0
        reasoning = strip_markdown(re.sub(r"REORDER_QTY:\s*\d+", "", raw_reasoning).strip())
        for line in reasoning.split("."):
            if line.strip():
                emit("THINK", line.strip())

        if reorder_qty == 0:
            emit("WATCH", f"{sku['name']} · Gemini recommends no reorder at this time")
            continue

        emit("RISK", f"Reorder recommended: {sku['name']} · {reorder_qty} units")

        # Step 2: Gemini drafts email from real data only
        emit("ACT", "Drafting supplier email...")
        email = strip_markdown(generate_text(
            client,
            f"""Write a short, professional plain-text reorder email using only the facts below.
Do not add any placeholder text such as [Your Name], [Title], or [Phone Number].
Sign off exactly as: "Portland Optics Operations\n— Sent automatically by ChainAgent"

Facts:
- Product: {sku['name']} (SKU: {sku['id']})
- Supplier: {effective_supplier}
- Current stock: {stock} units
- Sales rate: {vel} units/day (real 30-day Shopify data)
- Days of stock remaining: {days:.0f}
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
        }))
        trigger_voice(sku, days)
        log_snowflake(sku, reasoning, email, days)
