import os
import io
import wave
import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Whisper hallucination phrases to filter out
HALLUCINATIONS = [
    "thank you", "thanks for watching", "thanks for listening",
    "you", "bye", "bye bye", "goodbye", "please subscribe",
    "like and subscribe", "see you next time", ".",  "...", " "
]

def is_hallucination(text: str) -> bool:
    return text.strip().lower() in HALLUCINATIONS

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")

    audio_buffer = []
    silence_counter = 0

    while True:
        try:
            data = await websocket.receive_bytes()
            audio_chunk = np.frombuffer(data, dtype=np.int16)

            rms = np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))

            if len(audio_buffer) % 50 == 0:
                print(f"📊 RMS: {rms:.1f} | buffer: {len(audio_buffer)} chunks")

            is_speech = rms > 50

            if is_speech:
                audio_buffer.append(audio_chunk)
                silence_counter = 0
            else:
                if len(audio_buffer) > 0:
                    silence_counter += 1
                else:
                    silence_counter = 0

                if silence_counter >= 50 and len(audio_buffer) >= 2:
                    print(f"🚀 Sending to Whisper — {len(audio_buffer)} chunks")

                    full_audio = np.concatenate(audio_buffer)

                    # Fix Bug 2 — clear buffer BEFORE the API call
                    # so leftover audio doesn't get sent on reconnect
                    audio_buffer = []
                    silence_counter = 0

                    # Check average energy of the full clip
                    # If it's too quiet overall, skip — it's probably silence/noise
                    avg_rms = np.sqrt(np.mean(full_audio.astype(np.float32) ** 2))
                    if avg_rms < 100:
                        print(f"⏭ Skipping — audio too quiet (avg RMS: {avg_rms:.1f})")
                        continue

                    wav_buffer = io.BytesIO()
                    with wave.open(wav_buffer, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(16000)
                        wf.writeframes(full_audio.tobytes())

                    wav_buffer.seek(0)
                    wav_buffer.name = "audio.wav"

                    try:
                        result = client.audio.transcriptions.create(
                            model="whisper-large-v3-turbo",
                            file=wav_buffer,
                            response_format="text"
                        )
                        transcript = result.strip()
                        print(f"📝 Transcript: {transcript}")

                        # Fix Bug 1 — filter hallucinations
                        if transcript and not is_hallucination(transcript):
                            await websocket.send_json({
                                "type": "transcript",
                                "text": transcript
                            })
                        elif is_hallucination(transcript):
                            print(f"🚫 Filtered hallucination: '{transcript}'")

                    except Exception as e:
                        print(f"❌ Whisper error: {e}")

        except WebSocketDisconnect:
            print("🔌 Client disconnected normally")
            # Fix Bug 2 — clear buffer on disconnect
            audio_buffer = []
            silence_counter = 0
            break
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            audio_buffer = []
            break

    print("🔌 Client disconnected")