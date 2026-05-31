import base64
import json
import urllib.request
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv

from agent.config import get_key

load_dotenv()

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

    account_sid = get_key("twilio_account_sid", "TWILIO_ACCOUNT_SID")
    auth_token  = get_key("twilio_auth_token",  "TWILIO_AUTH_TOKEN")
    from_number = get_key("twilio_from",         "TWILIO_FROM")

    if not account_sid or not auth_token or not from_number:
        raise RuntimeError("Twilio credentials not set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)")

    body = (
        f"ChainAgent: {sku['name']} has only {days:.1f} days of stock left. "
        f"Reorder drafted. Log in to approve."
    )

    url     = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    payload = urllib.parse.urlencode({"To": to_number, "From": from_number, "Body": body}).encode()
    creds   = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()
