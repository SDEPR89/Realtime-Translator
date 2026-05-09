import os
import wave
import time
import numpy as np
from collections import deque

BUFFER_DIR = "audio_buffer"
CHUNK_DURATION = 5        # seconds per chunk file
MAX_CHUNKS = 6            # 6 × 5s = 30 seconds max
SAMPLE_RATE = 16000

class RollingAudioBuffer:
    def __init__(self):
        # Create buffer directory
        os.makedirs(BUFFER_DIR, exist_ok=True)
        self.chunks = deque(maxlen=MAX_CHUNKS)
        self.current_chunk = []
        self.current_chunk_start = time.time()
        self.recording_start = time.time()

    def add_audio(self, audio_data: np.ndarray):
        """Add audio chunk to the buffer"""
        self.current_chunk.append(audio_data)

        # Check if current chunk is full (5 seconds)
        elapsed = time.time() - self.current_chunk_start
        if elapsed >= CHUNK_DURATION:
            self._save_chunk()

    def _save_chunk(self):
        """Save current chunk to disk and add to queue"""
        if not self.current_chunk:
            return

        # Create filename with timestamp
        chunk_time = self.current_chunk_start - self.recording_start
        filename = f"{BUFFER_DIR}/chunk_{chunk_time:.1f}.wav"

        # Write WAV file
        full_audio = np.concatenate(self.current_chunk)
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(full_audio.tobytes())

        # Add to queue — old chunks auto-removed by deque maxlen
        if len(self.chunks) >= MAX_CHUNKS:
            # Delete oldest chunk file from disk
            old_file = self.chunks[0]
            if os.path.exists(old_file):
                os.remove(old_file)

        self.chunks.append(filename)

        # Reset current chunk
        self.current_chunk = []
        self.current_chunk_start = time.time()
        print(f"💾 Saved audio chunk: {filename}")

    def get_audio_at_offset(self, offset_seconds: float) -> bytes | None:
        """
        Get 5 seconds of audio starting at offset_seconds
        from the beginning of the recording
        """
        target_chunk = None

        for chunk_file in self.chunks:
            # Extract time from filename
            try:
                chunk_time = float(
                    chunk_file.split("chunk_")[1].replace(".wav", "")
                )
                if chunk_time <= offset_seconds < chunk_time + CHUNK_DURATION:
                    target_chunk = chunk_file
                    break
            except:
                continue

        if not target_chunk or not os.path.exists(target_chunk):
            print(f"⚠️ No audio found at offset {offset_seconds}s")
            return None

        # Read and return the chunk
        with open(target_chunk, "rb") as f:
            return f.read()

    def get_recording_offset(self) -> float:
        """Get current seconds since recording started"""
        return time.time() - self.recording_start

    def clear(self):
        """Clear all buffer files"""
        for chunk_file in self.chunks:
            if os.path.exists(chunk_file):
                os.remove(chunk_file)
        self.chunks.clear()
        self.current_chunk = []