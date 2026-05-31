import json
import os
from pathlib import Path

DATA_DIR  = Path(__file__).resolve().parents[1] / "data"
KEYS_PATH = DATA_DIR / "api-keys.json"


def _load_keys() -> dict:
    try:
        return json.loads(KEYS_PATH.read_text())
    except Exception:
        return {}


def get_key(name: str, env_var: str | None = None) -> str:
    """Return config value: JSON file → env var → empty string."""
    saved = _load_keys()
    if saved.get(name):
        return saved[name]
    return os.getenv(env_var or name.upper(), "")
