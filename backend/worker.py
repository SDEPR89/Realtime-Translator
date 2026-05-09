import io
import wave
import numpy as np
from faster_whisper import WhisperModel

def transcription_worker(model_size: str, input_queue, output_queue):
    """
    This function runs in a separate process.
    It loads the Whisper model once, then waits for audio jobs.
    """
    print(f"🤖 Worker started — loading '{model_size}' model...")

    # Load the model once — this takes a few seconds
    # device="cpu" works on all Macs
    # compute_type="int8" makes it faster with minimal quality loss
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"✅ Model '{model_size}' loaded and ready")

    while True:
        try:
            # Wait for audio data from the main process
            job = input_queue.get()

            # None is our signal to shut down
            if job is None:
                print("🛑 Worker shutting down")
                break

            audio_data = job["audio"]
            job_id = job["id"]

            print(f"🔄 Worker transcribing job {job_id}...")

            # Whisper expects a numpy float32 array
            audio_float = audio_data.astype(np.float32) / 32768.0

            # Transcribe
            segments, info = model.transcribe(
                audio_float,
                beam_size=5,
                language=None,  # auto-detect language
                vad_filter=True,  # built-in VAD filter
                vad_parameters=dict(min_silence_duration_ms=500)
            )

            # Collect all segments into one transcript
            transcript = " ".join([seg.text for seg in segments]).strip()

            print(f"📝 Worker result: {transcript}")

            # Send result back to main process
            output_queue.put({
                "id": job_id,
                "transcript": transcript,
                "language": info.language
            })

        except Exception as e:
            print(f"❌ Worker error: {e}")
            output_queue.put({
                "id": job.get("id", "unknown"),
                "transcript": "",
                "error": str(e)
            })