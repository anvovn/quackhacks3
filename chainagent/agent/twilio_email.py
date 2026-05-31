import json
import os
import urllib.request
import urllib.error
from pathlib import Path

from dotenv import load_dotenv

from agent.config import get_key

load_dotenv()

DATA_DIR     = Path(__file__).resolve().parents[1] / "data"
EMAIL_CONFIG = DATA_DIR / "email-config.json"


def _load_config() -> dict:
    try:
        return json.loads(EMAIL_CONFIG.read_text())
    except Exception:
        return {"enabled": False, "email": ""}


def trigger_email(sku: dict, days: float) -> None:
    cfg = _load_config()
    if not cfg.get("enabled"):
        return

    to_email = cfg.get("email", "").strip()
    if not to_email:
        return

    api_key    = get_key("sendgrid_api_key", "SENDGRID_API_KEY")
    email_from = get_key("email_from", "EMAIL_FROM")
    if not api_key or not email_from:
        raise RuntimeError("SendGrid credentials not set (SENDGRID_API_KEY, EMAIL_FROM)")

    _send(
        to_email,
        subject=f"[ChainAgent] Action Required — {sku['name']} stockout in {days:.1f} days",
        body=(
            f"ChainAgent Alert\n\n"
            f"{sku['name']} has only {days:.1f} days of stock left. "
            f"A reorder has been drafted. Log in to review and approve."
        ),
    )


def _send(to_email: str, subject: str, body: str) -> None:
    api_key    = get_key("sendgrid_api_key", "SENDGRID_API_KEY")
    email_from = get_key("email_from", "EMAIL_FROM")

    payload = json.dumps({
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": email_from},
        "subject": subject,
        "content": [{"type": "text/plain", "value": body}],
    }).encode()

    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()
