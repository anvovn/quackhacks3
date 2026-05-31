import json
import os
import urllib.request
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN  = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_FROM        = os.getenv("TWILIO_FROM")  # e.g. "+15551234567"

DATA_DIR   = Path(__file__).resolve().parents[1] / "data"
SMS_CONFIG = DATA_DIR / "sms-config.json"


def _load_config() -> dict:
    try:
        return json.loads(SMS_CONFIG.read_text())
    except Exception:
        return {"enabled": False, "phone": ""}


def trigger_sms(sku: dict, days: float) -> None:
    cfg = _load_config()
    if not cfg.get("enabled"):
        return

    to_number = cfg.get("phone", "").strip()
    if not to_number:
        return

    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_FROM:
        raise RuntimeError("Twilio credentials not set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)")

    body = (
        f"ChainAgent: {sku['name']} has only {days:.1f} days of stock left "
        f"(lead time {sku['lead_time_days']} days). Reorder drafted. Log in to approve."
    )

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    payload = urllib.parse.urlencode({"To": to_number, "From": TWILIO_FROM, "Body": body}).encode()

    import base64
    credentials = base64.b64encode(f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()).decode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()
