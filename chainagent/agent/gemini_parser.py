import os
import json
from pathlib import Path
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "skus.json"


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

    # update skus.json with new lead time
    with DATA_PATH.open() as f:
        skus = json.load(f)

    for sku in skus:
        if sku["id"] == sku_id:
            sku["lead_time_days"] = extracted["lead_time_days"]

    with DATA_PATH.open("w") as f:
        json.dump(skus, f, indent=2)

    return extracted