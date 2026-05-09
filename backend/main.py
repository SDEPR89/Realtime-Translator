import io
import os
import wave
import uuid
import time
import numpy as np
import multiprocessing
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.websockets import WebSocketDisconnect
from worker import transcription_worker
from database import init_db, create_assignment, save_note, get_notes, get_assignments
from audio_buffer import RollingAudioBuffer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
init_db()
audio_buffer = RollingAudioBuffer()
current_assignment_id = None
current_model = "base"
input_queue = multiprocessing.Queue()
output_queue = multiprocessing.Queue()
worker_process = None

HALLUCINATIONS = [
    "thank you", "thanks for watching", "thanks for listening",
    "you", "bye", "bye bye", "goodbye", "please subscribe",
    "like and subscribe", "see you next time", ".", "...", " "
]

def is_hallucination(text: str) -> bool:
    return text.strip().lower() in HALLUCINATIONS

def start_worker(model_size: str):
    global worker_process, input_queue, output_queue
    if worker_process and worker_process.is_alive():
        input_queue.put(None)
        worker_process.join(timeout=5)
    input_queue = multiprocessing.Queue()
    output_queue = multiprocessing.Queue()
    worker_process = multiprocessing.Process(
        target=transcription_worker,
        args=(model_size, input_queue, output_queue),
        daemon=True
    )
    worker_process.start()
    print(f"🚀 Started worker with model: {model_size}")

@app.on_event("startup")
async def startup():
    start_worker(current_model)

@app.get("/model")
async def get_model():
    return {"model": current_model}

@app.post("/model/{model_size}")
async def set_model(model_size: str):
    global current_model
    valid_models = ["tiny", "base", "small", "medium"]
    if model_size not in valid_models:
        return {"error": f"Invalid model. Choose from: {valid_models}"}
    current_model = model_size
    start_worker(model_size)
    return {"model": current_model, "status": "loading"}

@app.post("/assignment")
async def new_assignment(data: dict):
    global current_assignment_id
    pdf_path = data.get("pdf_path", "unknown")
    current_assignment_id = create_assignment(pdf_path)
    audio_buffer.recording_start = time.time()
    print(f"📚 New assignment: {current_assignment_id} — {pdf_path}")
    return {"assignment_id": current_assignment_id}

@app.post("/note")
async def add_note(data: dict):
    if not current_assignment_id:
        return {"error": "No active assignment"}
    audio_offset = audio_buffer.get_recording_offset()
    save_note(
        assignment_id=current_assignment_id,
        word=data["word"],
        pdf_page=data["pdf_page"],
        timestamp=data["timestamp"],
        audio_offset=audio_offset
    )
    print(f"📌 Saved note: {data['word']} at {audio_offset:.1f}s")
    return {"status": "saved", "audio_offset": audio_offset}

@app.get("/assignments")
async def list_assignments():
    return get_assignments()

@app.get("/notes/{assignment_id}")
async def list_notes(assignment_id: int):
    return get_notes(assignment_id)

@app.get("/audio/{offset_seconds}")
async def get_audio_clip(offset_seconds: float):
    audio_data = audio_buffer.get_audio_at_offset(offset_seconds)
    if not audio_data:
        return {"error": "No audio at this offset"}
    return Response(content=audio_data, media_type="audio/wav")

current_language = None 

@app.post("/language/{lang_code}")
async def set_language(lang_code: str):
    global current_language
    valid = ["auto", "ja", "en", "zh", "ko", "th"]
    if lang_code not in valid:
        return {"error": f"Invalid language. Choose from: {valid}"}
    current_language = None if lang_code == "auto" else lang_code
    print(f"🌐 Language set to: {lang_code}")
    return {"language": lang_code}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")

    speech_buffer = []
    silence_counter = 0
    pending_jobs = {}

    while True:
        try:
            data = await websocket.receive_bytes()
            audio_chunk = np.frombuffer(data, dtype=np.int16)

            # Feed into rolling audio buffer for rewind
            audio_buffer.add_audio(audio_chunk)

            rms = np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))

            if len(speech_buffer) % 50 == 0:
                print(f"📊 RMS: {rms:.1f} | buffer: {len(speech_buffer)} chunks")

            is_speech = rms > 50

            if is_speech:
                speech_buffer.append(audio_chunk)
                silence_counter = 0
            else:
                if len(speech_buffer) > 0:
                    silence_counter += 1
                else:
                    silence_counter = 0

                if silence_counter >= 50 and len(speech_buffer) >= 2:
                    full_audio = np.concatenate(speech_buffer)
                    speech_buffer = []
                    silence_counter = 0

                    avg_rms = np.sqrt(np.mean(full_audio.astype(np.float32) ** 2))
                    if avg_rms < 100:
                        print(f"⏭ Skipping — too quiet (avg RMS: {avg_rms:.1f})")
                        continue

                    job_id = str(uuid.uuid4())[:8]
                    pending_jobs[job_id] = True
                    input_queue.put({"id": job_id, "audio": full_audio,
    "language": current_language})
                    print(f"📤 Sent job {job_id} to worker")

            # Check if worker has results ready
            while not output_queue.empty():
                result = output_queue.get_nowait()
                transcript = result.get("transcript", "").strip()
                language = result.get("language", "unknown")
                print(f"📝 Got result: '{transcript}' (lang: {language})")

                if transcript and not is_hallucination(transcript):
                    await websocket.send_json({
                        "type": "transcript",
                        "text": transcript,
                        "translation": result.get("translation", ""),
                        "language": language
                    })

        except WebSocketDisconnect:
            print("🔌 Client disconnected normally")
            speech_buffer = []
            break
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            speech_buffer = []
            break

    print("🔌 Client disconnected")