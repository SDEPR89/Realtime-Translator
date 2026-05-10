import os
import numpy as np
from faster_whisper import WhisperModel
from groq import Groq
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

language_names = {
    "en": "English",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "th": "Thai",
    "fr": "French",
    "es": "Spanish",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "vi": "Vietnamese",
    "id": "Indonesian",
}

def translate_text(text: str, from_lang: str, to_lang: str = "en") -> str:
    if from_lang == to_lang:
        return text
    if not text.strip():
        return ""
    target_name = language_names.get(to_lang, "English")
    try:
        result = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": f"You are a translator. Always translate the user's text into {target_name}. Reply with only the {target_name} translation, nothing else. Never reply in any other language."
                },
                {
                    "role": "user",
                    "content": f"Translate to {target_name}: {text}"
                }
            ],
            max_tokens=200
        )
        translation = result.choices[0].message.content.strip()
        print(f"🌐 Translation ({to_lang}): {translation}")
        return translation
    except Exception as e:
        print(f"⚠️ Translation failed: {e}")
        return ""

def transcription_worker(model_size: str, input_queue, output_queue):
    print(f"🤖 Worker started — loading '{model_size}' model...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    print(f"✅ Model '{model_size}' loaded and ready")

    while True:
        try:
            job = input_queue.get()

            if job is None:
                print("🛑 Worker shutting down")
                break

            audio_data = job["audio"]
            job_id = job["id"]
            language = job.get("language", None)
            to_lang = job.get("to_lang", "en")

            print(f"🔄 Transcribing job {job_id} (lang: {language or 'auto'} → {to_lang})...")

            audio_float = audio_data.astype(np.float32) / 32768.0

            segments, info = model.transcribe(
                audio_float,
                beam_size=4,
                language=language,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400)
            )

            transcript = " ".join([seg.text for seg in segments]).strip()
            detected_lang = info.language
            print(f"📝 Transcript ({detected_lang}): {transcript}")

            translation = ""
            if transcript:
                translation = translate_text(transcript, detected_lang, to_lang)

            output_queue.put({
                "id": job_id,
                "transcript": transcript,
                "translation": translation,
                "language": detected_lang,
                "to_lang": to_lang
            })

        except Exception as e:
            print(f"❌ Worker error: {e}")
            output_queue.put({
                "id": job.get("id", "unknown") if isinstance(job, dict) else "unknown",
                "transcript": "",
                "translation": "",
                "error": str(e)
            })