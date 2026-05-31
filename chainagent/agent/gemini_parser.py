import os
import json
from pathlib import Path
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
SUPPLEMENT_PATH = Path(__file__).resolve().parents[1] / "data" / "sku-supplement.json"


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def parse_supplier_pdf(pdf_path, sku_id):
    client = get_gemini_client()

    pdf_bytes = Path(pdf_path).read_bytes()

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            "Extract: lead_time_days (integer), moq (integer), unit_price (float). Return JSON only, no markdown backticks."
        ]
    )

    text = response.text
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    extracted = json.loads(text.strip())

    # update sku-supplement.json with new lead time
    try:
        supplement = json.loads(SUPPLEMENT_PATH.read_text())
    except Exception:
        supplement = {}

    if sku_id not in supplement:
        supplement[sku_id] = {}
    supplement[sku_id]["lead_time_days"] = extracted["lead_time_days"]

    SUPPLEMENT_PATH.write_text(json.dumps(supplement, indent=2))

    return extracted