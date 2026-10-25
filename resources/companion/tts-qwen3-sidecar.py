"""Qwen3-TTS (mlx-audio, Apple GPU) sidecar for Orca's companion ("Джарвис").

Usage: tts-qwen3-sidecar.py <model dir of Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit>

Same framed protocol as tts-sidecar.py (Silero), so CompanionTtsSidecarProcess drives
both unchanged:
  stdin, one JSON object per line:
    Synthesize: {"id", "text", "speaker": "ryan", "rate": 1.0, "instruct": "..." (optional)}
    Cancel: {"type": "cancel", "id"}    Stop: {"type": "shutdown"}
  stdout: {"type": "ready"}; per request one or more
    {"type": "audio", "id", "seq", "sampleRate", "final", "bytes"} + raw float32 LE PCM,
    then {"type": "done", "id"} or {"type": "error", "id", "message"}.

Differences from Silero: audio streams in ~0.5s chunks while a sentence is still being
generated (time to first audio 0.2-0.3s instead of the whole sentence), and `instruct`
carries the emotion/style prompt CustomVoice understands. stdin is read on its own
thread so a cancel lands between chunks of the sentence being generated, not only
for queued ones. `rate` scales the reported sample rate, exactly like the Silero sidecar.
"""

import json
import os
import queue
import sys
import threading

STREAMING_INTERVAL_S = 0.5
DEFAULT_SPEAKER = "ryan"
LANGUAGE = "Russian"
MAX_CHARS = 400
# 12.5 codec tokens per second of audio; Russian runs ~13 chars/s, so 2 tokens per char is
# a ~2x margin that still stops a runaway generation long before the 2048-token default.
MIN_MAX_TOKENS = 150
TOKENS_PER_CHAR = 2
WARMUP_TEXT = "Проверка связи."

_frames = os.fdopen(os.dup(1), "wb", buffering=0)
os.dup2(2, 1)
sys.stdout = sys.stderr
_frames_lock = threading.Lock()


def send_header(header: dict) -> None:
    line = (json.dumps(header, ensure_ascii=False) + "\n").encode("utf-8")
    with _frames_lock:
        _frames.write(line)


def send_audio(request_id, seq: int, pcm_bytes: bytes, sample_rate: int, final: bool) -> None:
    header = {
        "type": "audio",
        "id": request_id,
        "seq": seq,
        "sampleRate": sample_rate,
        "final": final,
        "bytes": len(pcm_bytes),
    }
    line = (json.dumps(header, ensure_ascii=False) + "\n").encode("utf-8")
    with _frames_lock:
        _frames.write(line)
        _frames.write(pcm_bytes)


class Requests:
    """stdin reader thread → work queue; cancel ids are visible to the generating thread."""

    def __init__(self):
        self.queue = queue.Queue()
        self.cancelled = set()
        self.lock = threading.Lock()

    def is_cancelled(self, request_id) -> bool:
        with self.lock:
            return request_id in self.cancelled

    def forget(self, request_id) -> None:
        with self.lock:
            self.cancelled.discard(request_id)

    def read_stdin(self) -> None:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            msg_type = msg.get("type")
            if msg_type == "shutdown":
                break
            if msg_type == "cancel":
                with self.lock:
                    self.cancelled.add(msg.get("id"))
                continue
            self.queue.put(msg)
        self.queue.put(None)


def generate_chunks(model, text: str, speaker: str, instruct):
    import numpy as np

    clipped = text[:MAX_CHARS]
    results = model.generate_custom_voice(
        text=clipped,
        speaker=speaker,
        language=LANGUAGE,
        instruct=instruct or None,
        max_tokens=max(MIN_MAX_TOKENS, len(clipped) * TOKENS_PER_CHAR),
        stream=True,
        streaming_interval=STREAMING_INTERVAL_S,
        verbose=False,
    )
    for result in results:
        audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        if audio.size:
            yield audio


def synthesize(model, requests: Requests, msg: dict) -> None:
    request_id = msg.get("id")
    speaker = str(msg.get("speaker") or DEFAULT_SPEAKER).lower()
    if speaker not in [s.lower() for s in model.get_supported_speakers()]:
        speaker = DEFAULT_SPEAKER
    rate = msg.get("rate", 1.0)
    sample_rate = int(getattr(model, "sample_rate", 24000))
    reported_rate = int(round(sample_rate * rate)) if rate and rate > 0 else sample_rate
    seq = 0
    # Each chunk goes out the moment it exists (`final` stays false: the end of a request
    # is unknown until the generator stops); `done` closes the request.
    for audio in generate_chunks(model, msg.get("text", ""), speaker, msg.get("instruct")):
        if requests.is_cancelled(request_id):
            requests.forget(request_id)
            return
        send_audio(request_id, seq, audio.tobytes(), reported_rate, False)
        seq += 1
    if seq == 0:
        raise RuntimeError("Qwen3-TTS produced no audio")
    send_header({"type": "done", "id": request_id})


def main() -> None:
    model_dir = sys.argv[1] if len(sys.argv) > 1 else ""
    if not model_dir or not os.path.isdir(model_dir):
        send_header({"type": "error", "id": None, "message": f"Qwen3-TTS model dir not found: {model_dir!r}"})
        sys.exit(1)

    from mlx_audio.tts.utils import load_model

    model = load_model(model_dir)
    try:
        for _ in generate_chunks(model, WARMUP_TEXT, DEFAULT_SPEAKER, None):
            pass
    except Exception as e:  # noqa: BLE001 - best-effort warm-up, the first real request still works
        print(f"Qwen3-TTS warm-up failed: {e}", file=sys.stderr)
    send_header({"type": "ready"})

    requests = Requests()
    threading.Thread(target=requests.read_stdin, daemon=True).start()
    while True:
        msg = requests.queue.get()
        if msg is None:
            break
        request_id = msg.get("id")
        if requests.is_cancelled(request_id):
            requests.forget(request_id)
            continue
        try:
            synthesize(model, requests, msg)
        except Exception as e:  # noqa: BLE001 - one bad request must not kill the sidecar
            send_header({"type": "error", "id": request_id, "message": str(e)})

    os._exit(0)


main()
