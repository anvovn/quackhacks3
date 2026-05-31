from dotenv import load_dotenv
from elevenlabs import stream
from elevenlabs.client import ElevenLabs

from agent.config import get_key

load_dotenv()


def trigger_voice(sku, days):
    api_key  = get_key("elevenlabs_api_key",  "ELEVENLABS_API_KEY")
    voice_id = get_key("elevenlabs_voice_id", "ELEVENLABS_VOICE_ID")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    if not voice_id:
        raise RuntimeError("ELEVENLABS_VOICE_ID is not set")

    client = ElevenLabs(api_key=api_key)
    audio_stream = client.text_to_speech.stream(
        voice_id=voice_id,
        text=f"Alert: {sku['name']} has only {days:.1f} days of stock left. Reorder immediately.",
        model_id="eleven_flash_v2_5",
    )
    stream(audio_stream)
