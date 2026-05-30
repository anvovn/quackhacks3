import os

from dotenv import load_dotenv
from elevenlabs import stream
from elevenlabs.client import ElevenLabs

load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")


def trigger_voice(sku, days):
    if not ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    if not ELEVENLABS_VOICE_ID:
        raise RuntimeError("ELEVENLABS_VOICE_ID is not set")

    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    audio_stream = client.text_to_speech.stream(
        voice_id=ELEVENLABS_VOICE_ID,
        text=f"Alert: {sku['name']} has only {days:.1f} days of stock left. Reorder immediately.",
        model_id="eleven_flash_v2_5",
    )
    stream(audio_stream)
