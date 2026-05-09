import io
import wave
import uuid
import numpy as np
import multiprocessing
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect
from worker import transcription_worker

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# These queues connect FastAPI to the worker process
input_queue = multiprocessing.Queue()
output_queue = multiprocessing.Queue()

# Current model size — default to base
current_model = "base"

# Worker process — starts when server starts
worker_process = None

HALLUCINATIONS = [
    "thank you", "thanks for watching", "thanks for listening",
    "you", "bye", "bye bye", "goodbye", "please subscribe",
    "like and subscribe", "see you next time", ".", "...", " "
]

def is_hallucination(text: str) -> bool:
    return text.strip().lower() in HALLUCINATIONS

def start_worker(model_size: str):
    """Start a fresh worker process with the given model"""
    global worker_process, input_queue, output_queue

    # Stop existing worker if running
    if worker_process and worker_process.is_alive():
        input_queue.put(None)  # signal shutdown
        worker_process.join(timeout=5)

    # Fresh queues for the new worker
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
    """Start the worker when FastAPI starts"""
    start_worker(current_model)

@app.get("/model")
async def get_model():
    """Get current model size"""
    return {"model": current_model}

@app.post("/model/{model_size}")
async def set_model(model_size: str):
    """Switch to a different model size"""
    global current_model
    valid_models = ["tiny", "base", "small", "medium"]
    if model_size not in valid_models:
        return {"error": f"Invalid model. Choose from: {valid_models}"}
    current_model = model_size
    start_worker(model_size)
    return {"model": current_model, "status": "loading"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")

    audio_buffer = []
    silence_counter = 0
    pending_jobs = {}

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
                    full_audio = np.concatenate(audio_buffer)

                    # Clear buffer immediately
                    audio_buffer = []
                    silence_counter = 0

                    # Check energy
                    avg_rms = np.sqrt(np.mean(full_audio.astype(np.float32) ** 2))
                    if avg_rms < 100:
                        print(f"⏭ Skipping — too quiet (avg RMS: {avg_rms:.1f})")
                        continue

                    # Send job to worker
                    job_id = str(uuid.uuid4())[:8]
                    pending_jobs[job_id] = True
                    input_queue.put({"id": job_id, "audio": full_audio})
                    print(f"📤 Sent job {job_id} to worker")

            # Check if worker has finished any jobs
            while not output_queue.empty():
                result = output_queue.get_nowait()
                transcript = result.get("transcript", "").strip()
                language = result.get("language", "unknown")
                print(f"📝 Got result: '{transcript}' (lang: {language})")

                if transcript and not is_hallucination(transcript):
                    await websocket.send_json({
                        "type": "transcript",
                        "text": transcript,
                        "language": language
                    })

        except WebSocketDisconnect:
            print("🔌 Client disconnected normally")
            audio_buffer = []
            break
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            audio_buffer = []
            break

    print("🔌 Client disconnected")