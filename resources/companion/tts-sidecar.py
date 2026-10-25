"""Silero TTS sidecar for Orca's companion ("Джарвис").

Usage: tts-sidecar.py <v5_4_ru.pt path> <v3_1_ru.pt path> [<v5_6_ru.pt path>]
Any path may be the literal string "-" if that model was not provisioned; a request for
a voice no provisioned model covers then errors instead of crashing the sidecar.

Protocol on stdin: one JSON object per line.
  Synthesize: {"id": "...", "text": "...", "speaker": "aidar", "rate": 1.0}
  Cancel a queued request: {"type": "cancel", "id": "..."}
  Stop the sidecar: {"type": "shutdown"}

Protocol on stdout: one JSON header line per frame. For `type: "audio"` frames the
header is immediately followed by exactly `bytes` raw little-endian float32 PCM
samples with no separator before the next header — length-prefixed binary rather than
base64. An utterance can run to several hundred KB of PCM (48kHz mono float32), this
process stays warm across a whole conversation, and the caller streams per-sentence
while the brain is still writing the next one: base64's ~33% size overhead and the
extra encode/decode buffer copy would be paid on every sentence instead of never.
  Ready (both reachable models loaded on first use, sidecar process up): {"type": "ready"}
  Audio: {"type": "audio", "id", "seq", "sampleRate", "final", "bytes"} + raw PCM
  Done (utterance fully sent): {"type": "done", "id"}
  Error: {"type": "error", "id", "message"}

Silero has no built-in speech-rate control, so `rate` (0.5-2.0) is applied as a
sample-rate scale on the reported header: the panel plays the same PCM faster/slower,
trading pitch for a simple, dependency-free rate knob.

Model loading: these .pt files are `torch.package` archives (a pickled Python object
graph, not a plain TorchScript module) — this matches snakers4/silero-models' own
`silero_tts()`, which routes every v3/v4/v5 speaker through
`torch.package.PackageImporter(path).load_pickle("tts_models", "model")` rather than
`torch.jit.load`. Loading is lazy and cached per model family: `eugene` needs
v3_1_ru.pt (CC BY-NC-SA, no homograph/questions support, ~59MB), the other four
speakers need v5_4_ru.pt (homograph + auto-stress + questions, ~145MB) — a
conversation that only ever uses one family never pays to load the other.

When v5_6_ru.pt is provisioned it serves every voice instead: it moves `eugene` into the
v5 family, so the default voice gains homograph stress and `*word*` focus (v3_1 drops the
asterisks without any effect on the audio). v5_4/v3_1 stay the fallback — a v5_6 file that fails to load is logged to stderr
once and the legacy families take over for the rest of the process.
"""

import json
import os
import re
import sys
import threading

SAMPLE_RATE = 48000
# Silero's own docs warn past ~140 chars; the Node-side sentence chunker caps at 250,
# so this is a defensive hard cap against a caller that bypasses the chunker.
MAX_CHARS = 250
WARMUP_TEXT = "Проверка."

# v5_4_ru supports homograph/stress/question disambiguation flags v3_1_ru does not;
# passing them to v3 raises, so each model family gets its own kwarg set.
V5_SPEAKERS = {"aidar", "baya", "kseniya", "xenia"}
V5_TTS_KWARGS = {"put_accent": True, "put_yo": True, "put_stress_homo": True, "put_yo_homo": True}
V3_SPEAKERS = {"eugene"}
V3_TTS_KWARGS = {"put_accent": True, "put_yo": True}
V56_SPEAKERS = V5_SPEAKERS | V3_SPEAKERS
# v5_6's yo-homograph pass turns a bare "все" before a plural noun into "всё" ("всё тесты
# прошли") and then drops `*все*` focus because the word no longer matches. The brain is
# told to always write "ё", so a bare "все" is the plural and is pinned with a stress mark.
BARE_VSE = re.compile(r"(?<![\w+-])([Вв])се(?![\w+-])")

# Own stdout fd for the framed protocol; stray prints from imports/warnings must not
# corrupt the stream, so stdout is redirected to stderr for everything else.
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


def load_package_model(path: str):
    from torch import package

    importer = package.PackageImporter(path)
    return importer.load_pickle("tts_models", "model")


class ModelRegistry:
    """Lazily loads and caches the v5_6 / v5 / v3 model families by path, keyed once per process."""

    def __init__(self, v5_path: str, v3_path: str, v56_path: str = "-"):
        self.v5_path = v5_path if v5_path and v5_path != "-" else None
        self.v3_path = v3_path if v3_path and v3_path != "-" else None
        self.v56_path = v56_path if v56_path and v56_path != "-" else None
        self._v5_model = None
        self._v3_model = None
        self._v56_model = None

    def _resolve_v56(self):
        if self._v56_model is None and self.v56_path:
            try:
                self._v56_model = load_package_model(self.v56_path)
            except Exception as e:  # noqa: BLE001 - any load failure means "use the legacy families"
                print(f"v5_6_ru.pt failed to load, falling back to v5_4/v3_1: {e}", file=sys.stderr)
                self.v56_path = None
        return self._v56_model

    def is_v56(self, model) -> bool:
        return model is not None and model is self._v56_model

    def resolve(self, speaker: str):
        if speaker in V56_SPEAKERS and self._resolve_v56() is not None:
            return self._v56_model, V5_TTS_KWARGS
        if speaker in V5_SPEAKERS:
            if not self.v5_path:
                raise RuntimeError(f"voice '{speaker}' needs v5_4_ru.pt, which was not provisioned")
            if self._v5_model is None:
                self._v5_model = load_package_model(self.v5_path)
            return self._v5_model, V5_TTS_KWARGS
        if speaker in V3_SPEAKERS:
            if not self.v3_path:
                raise RuntimeError(f"voice '{speaker}' needs v3_1_ru.pt, which was not provisioned")
            if self._v3_model is None:
                self._v3_model = load_package_model(self.v3_path)
            return self._v3_model, V3_TTS_KWARGS
        raise RuntimeError(f"unknown voice '{speaker}'")

    def warm_up(self) -> None:
        for speaker in ("aidar", "eugene"):
            try:
                model, kwargs = self.resolve(speaker)
                model.apply_tts(text=WARMUP_TEXT, speaker=speaker, sample_rate=SAMPLE_RATE, **kwargs)
            except Exception:  # noqa: BLE001 - best-effort warm-up only, first real request still works
                pass


def synthesize(registry: ModelRegistry, request_id, text: str, speaker: str, rate: float) -> None:
    model, kwargs = registry.resolve(speaker)
    clipped = text[:MAX_CHARS]
    if registry.is_v56(model):
        clipped = BARE_VSE.sub(r"\1с+е", clipped)
    audio = model.apply_tts(text=clipped, speaker=speaker, sample_rate=SAMPLE_RATE, **kwargs)
    pcm_bytes = audio.numpy().astype("float32").tobytes()
    reported_rate = int(round(SAMPLE_RATE * rate)) if rate and rate > 0 else SAMPLE_RATE
    send_audio(request_id, 0, pcm_bytes, reported_rate, True)
    send_header({"type": "done", "id": request_id})


def main() -> None:
    v5_path = sys.argv[1] if len(sys.argv) > 1 else "-"
    v3_path = sys.argv[2] if len(sys.argv) > 2 else "-"
    v56_path = sys.argv[3] if len(sys.argv) > 3 else "-"
    registry = ModelRegistry(v5_path, v3_path, v56_path)
    if not registry.v5_path and not registry.v3_path and not registry.v56_path:
        send_header({"type": "error", "id": None, "message": "no model provisioned (every path is '-')"})
        sys.exit(1)

    import torch

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    registry.warm_up()
    send_header({"type": "ready"})

    cancelled_ids = set()
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
            cancelled_ids.add(msg.get("id"))
            continue
        request_id = msg.get("id")
        if request_id in cancelled_ids:
            cancelled_ids.discard(request_id)
            continue
        try:
            synthesize(registry, request_id, msg.get("text", ""), msg.get("speaker", "aidar"), msg.get("rate", 1.0))
        except Exception as e:  # noqa: BLE001 - one bad request must not kill the sidecar
            send_error_message = str(e)
            send_header({"type": "error", "id": request_id, "message": send_error_message})

    os._exit(0)


main()
