import os
import numpy as np
from faster_whisper import WhisperModel
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

def translate_text(text: str, from_lang: str) -> str:
    """Translate text to English using Groq LLaMA"""
    if from_lang == "en":
        return text
    if not text.strip():
        return ""
    try:
        result = groq_client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{
                "role": "user",
                "content": f"Translate this text to English. Reply with only the translation, nothing else: {text}"
            }],
            max_tokens=200
        )
        translation = result.choices[0].message.content.strip()
        print(f"🌐 Translation: {translation}")
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

            print(f"🔄 Transcribing job {job_id} (lang: {language or 'auto'})...")

            # Convert int16 to float32 for faster-whisper
            audio_float = audio_data.astype(np.float32) / 32768.0

            # Transcribe
            segments, info = model.transcribe(
                audio_float,
                beam_size=5,
                language=language,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500)
            )

            transcript = " ".join([seg.text for seg in segments]).strip()
            detected_lang = info.language

            print(f"📝 Transcript ({detected_lang}): {transcript}")

            # Translate to English
            translation = ""
            if transcript:
                translation = translate_text(transcript, detected_lang)

            output_queue.put({
                "id": job_id,
                "transcript": transcript,
                "translation": translation,
                "language": detected_lang
            })

        except Exception as e:
            print(f"❌ Worker error: {e}")
            output_queue.put({
                "id": job.get("id", "unknown") if isinstance(job, dict) else "unknown",
                "transcript": "",
                "translation": "",
                "error": str(e)
            })