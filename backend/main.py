import os
import io
import wave
import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
from fastapi import FastAPI, WebSocket
from starlette.websockets import WebSocketDisconnect

load_dotenv()
client = Groq(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

                        if transcript:
                            await websocket.send_json({
                                "type": "transcript",
                                "text": transcript
                            })

                    except Exception as e:
                        print(f"❌ Whisper error: {e}")

                    audio_buffer = []
                    silence_counter = 0

        except WebSocketDisconnect:
            print("🔌 Client disconnected normally")
            break
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            break

    print("🔌 Client disconnected")