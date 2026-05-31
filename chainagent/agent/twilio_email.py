import json
import os
import urllib.request
import urllib.error
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
EMAIL_FROM       = os.getenv("EMAIL_FROM")

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

    if not SENDGRID_API_KEY or not EMAIL_FROM:
        raise RuntimeError("SendGrid credentials not set (SENDGRID_API_KEY, EMAIL_FROM)")

    _send(
        to_email,
        subject=f"[ChainAgent] Action Required — {sku['name']} stockout in {days:.1f} days",
        body=(
            f"ChainAgent Alert\n\n"
            f"{sku['name']} has only {days:.1f} days of stock left "
            f"(lead time {sku['lead_time_days']} days). A reorder has been drafted. "
            f"Log in to review and approve."
        ),
    )


def _send(to_email: str, subject: str, body: str) -> None:
    payload = json.dumps({
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": EMAIL_FROM},
        "subject": subject,
        "content": [{"type": "text/plain", "value": body}],
    }).encode()

    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=payload,
        headers={
            "Authorization": f"Bearer {SENDGRID_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()
