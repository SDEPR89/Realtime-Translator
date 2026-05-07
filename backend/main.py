import os
import io
import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import OpenAI
import scipy.io.wavfile as wav

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

# Allow the React frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")

    # This buffer collects audio chunks until silence is detected
    audio_buffer = []
    silence_counter = 0
    SILENCE_THRESHOLD = 500   # chunks of silence before we send to Whisper
    MIN_BUFFER_SIZE = 5       # minimum chunks before we try transcribing

    while True:
        try:
            data = await websocket.receive_bytes()

            # Convert raw bytes back to int16 numpy array
            audio_chunk = np.frombuffer(data, dtype=np.int16)

            # VAD — check if this chunk has speech or silence
            # RMS = Root Mean Square — measures the "loudness" of the chunk
            rms = np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))
            is_speech = rms > 300  # adjust this threshold if needed

            if is_speech:
                audio_buffer.append(audio_chunk)
                silence_counter = 0
            else:
                silence_counter += 1

                # Silence detected after speech — time to transcribe
                if silence_counter >= SILENCE_THRESHOLD and len(audio_buffer) >= MIN_BUFFER_SIZE:
                    print(f"Silence detected, transcribing {len(audio_buffer)} chunks...")

                    # Combine all chunks into one audio array
                    full_audio = np.concatenate(audio_buffer)

                    # Convert to WAV format in memory (no file saved to disk)
                    wav_buffer = io.BytesIO()
                    wav.write(wav_buffer, 16000, full_audio)
                    wav_buffer.seek(0)
                    wav_buffer.name = "audio.wav"

                    # Send to Whisper API
                    try:
                        result = client.audio.transcriptions.create(
                            model="whisper-1",
                            file=wav_buffer,
                            response_format="text"
                        )

                        transcript = result.strip()
                        print(f"Transcript: {transcript}")

                        if transcript:
                            # Send the text back to the browser
                            await websocket.send_json({
                                "type": "transcript",
                                "text": transcript
                            })

                    except Exception as e:
                        print(f"Whisper error: {e}")

                    # Clear the buffer and reset
                    audio_buffer = []
                    silence_counter = 0

        except Exception as e:
            print(f"Connection error: {e}")
            break

    print("Client disconnected")