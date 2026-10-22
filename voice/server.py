"""
Servizio voce di LocalAI: riconoscimento vocale (faster-whisper) e sintesi vocale (Piper) in locale.

LocalAI lo avvia da solo se trova voice/.venv (vedi src/voice.js); a mano: avvia-voce.bat.
Ascolta solo su 127.0.0.1: il browser passa sempre da LocalAI, che controlla l'accesso.

  GET  /health          modelli caricati, voci disponibili
  POST /stt?language=it corpo audio (WAV, ma va bene qualsiasi formato che PyAV legge) -> {"text", "language", "seconds", "ms"}
  POST /tts             {"text", "voice", "speed"} -> audio/wav
  POST /unload          libera la VRAM (Whisper sulla GPU), prima dei lavori pesanti di ComfyUI

La GPU è condivisa con Ollama e ComfyUI (16 GB): Whisper va sulla GPU solo se c'è posto, altrimenti sulla CPU.
"""

import io
import json
import os
import subprocess
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
VOICES_DIR = Path(os.environ.get("VOICE_VOICES_DIR", ROOT / "voci"))
MODELS_DIR = Path(os.environ.get("VOICE_MODELS_DIR", ROOT / "modelli"))
STT_MODEL = os.environ.get("VOICE_STT_MODEL", "large-v3-turbo")
# auto = GPU se c'è memoria libera e le librerie CUDA ci sono, altrimenti CPU
STT_DEVICE = os.environ.get("VOICE_STT_DEVICE", "auto")
# MB liberi sulla GPU per caricare Whisper lì (large-v3-turbo int8 ~1 GB, più margine per Ollama)
STT_GPU_FREE_MB = int(os.environ.get("VOICE_STT_GPU_FREE_MB", "2500"))
# dopo tanti secondi senza richieste Whisper lascia la GPU (sulla CPU resta: la RAM non manca)
STT_GPU_IDLE_S = int(os.environ.get("VOICE_STT_GPU_IDLE", "600"))
DEFAULT_VOICE = os.environ.get("VOICE_DEFAULT", "it_IT-paola-medium")
PORT = int(os.environ.get("VOICE_PORT", "8190"))

# Windows: cuBLAS e cuDNN per Whisper sulla GPU arrivano dai pacchetti pip nvidia-* (installa-voce.ps1 -Gpu)
if os.name == "nt":
    import site
    for sp in site.getsitepackages():
        for bin_dir in Path(sp).glob("nvidia/*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = f"{bin_dir};{os.environ['PATH']}"

lock = threading.Lock()
stt = {"model": None, "device": None, "used": 0.0}
voices = {}  # nome -> PiperVoice


def log(msg):
    print(f"[voce] {msg}", flush=True)


def gpu_free_mb():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5).stdout
        return int(out.split()[0])
    except Exception:
        return 0


def load_stt():
    """Carica Whisper (una volta): sulla GPU se c'è posto, altrimenti sulla CPU."""
    from faster_whisper import WhisperModel
    if stt["model"] is not None:
        return stt["model"]
    want = STT_DEVICE
    if want == "auto":
        want = "cuda" if gpu_free_mb() >= STT_GPU_FREE_MB else "cpu"
    if want == "cuda":
        try:
            t = time.time()
            stt["model"] = WhisperModel(STT_MODEL, device="cuda", compute_type="int8_float16", download_root=str(MODELS_DIR))
            stt["device"] = "cuda"
            log(f"Whisper {STT_MODEL} sulla GPU in {time.time() - t:.1f} s")
            return stt["model"]
        except Exception as e:
            # di solito mancano cuBLAS/cuDNN (installa-voce.ps1 -Gpu): si va sulla CPU
            log(f"Whisper sulla GPU non riuscito ({e}): uso la CPU")
    t = time.time()
    threads = max(4, (os.cpu_count() or 8) - 2)
    stt["model"] = WhisperModel(STT_MODEL, device="cpu", compute_type="int8", cpu_threads=threads, download_root=str(MODELS_DIR))
    stt["device"] = "cpu"
    log(f"Whisper {STT_MODEL} sulla CPU ({threads} thread) in {time.time() - t:.1f} s")
    return stt["model"]


def unload_gpu():
    if stt["device"] == "cuda":
        stt["model"] = None
        stt["device"] = None
        import gc
        gc.collect()
        log("Whisper scaricato dalla GPU")


def transcribe(data, language):
    from faster_whisper import decode_audio
    audio = decode_audio(io.BytesIO(data), sampling_rate=16000)
    seconds = len(audio) / 16000
    t = time.time()
    with lock:
        model = load_stt()
        stt["used"] = time.time()
        # vad_filter toglie i silenzi (meno allucinazioni tipo «Grazie per la visione»);
        # beam_size 1: sulle frasi brevi è uguale e molto più veloce sulla CPU
        segments, info = model.transcribe(audio, language=language or None, beam_size=1, vad_filter=True,
                                          condition_on_previous_text=False)
        text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": info.language, "seconds": round(seconds, 2),
            "ms": int((time.time() - t) * 1000), "device": stt["device"]}


def voice_files():
    return sorted(p.stem for p in VOICES_DIR.glob("*.onnx") if Path(f"{p}.json").exists())


def get_voice(name):
    from piper import PiperVoice
    names = voice_files()
    if name not in names:
        name = DEFAULT_VOICE if DEFAULT_VOICE in names else (names[0] if names else None)
    if not name:
        raise RuntimeError(f"Nessuna voce in {VOICES_DIR}: lancia tools/installa-voce.ps1")
    if name not in voices:
        voices[name] = PiperVoice.load(str(VOICES_DIR / f"{name}.onnx"))
        log(f"voce {name} caricata")
    return voices[name]


def synthesize(text, name, speed):
    from piper import SynthesisConfig
    voice = get_voice(name)
    # length_scale > 1 è più lento: la velocità chiesta è l'inverso
    cfg = SynthesisConfig(length_scale=1 / max(0.5, min(2.0, float(speed or 1))))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text, wf, syn_config=cfg)
    return buf.getvalue()


def health():
    try:
        import faster_whisper  # noqa: F401
        stt_ok = True
    except ImportError:
        stt_ok = False
    try:
        import piper  # noqa: F401
        tts_ok = True
    except ImportError:
        tts_ok = False
    names = voice_files()
    return {
        "ok": stt_ok and tts_ok and bool(names),
        "stt": {"engine": "faster-whisper", "model": STT_MODEL, "loaded": stt["device"], "available": stt_ok},
        "tts": {"engine": "piper", "available": tts_ok, "default": DEFAULT_VOICE if DEFAULT_VOICE in names else (names[0] if names else None)},
        "voices": [{"id": n, "name": n.split("-")[1].capitalize() if "-" in n else n, "lang": n.split("-")[0]} for n in names],
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body, ctype="application/json"):
        data = json.dumps(body).encode() if ctype == "application/json" else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self.reply(200, health())
        self.reply(404, {"error": "non trovato"})

    def do_POST(self):
        url = urlparse(self.path)
        try:
            if url.path == "/stt":
                lang = (parse_qs(url.query).get("language") or ["it"])[0]
                data = self.body()
                if len(data) < 64:
                    return self.reply(400, {"error": "registrazione vuota"})
                return self.reply(200, transcribe(data, lang))
            if url.path == "/tts":
                req = json.loads(self.body() or b"{}")
                text = str(req.get("text") or "").strip()[:2000]
                if not text:
                    return self.reply(400, {"error": "testo vuoto"})
                t = time.time()
                wav = synthesize(text, str(req.get("voice") or ""), req.get("speed") or 1)
                log(f"sintesi di {len(text)} caratteri in {int((time.time() - t) * 1000)} ms")
                return self.reply(200, wav, "audio/wav")
            if url.path == "/unload":
                with lock:
                    unload_gpu()
                return self.reply(200, {"ok": True})
            self.reply(404, {"error": "non trovato"})
        except Exception as e:
            log(f"{url.path}: {e}")
            self.reply(500, {"error": str(e)})


def idle_watch():
    while True:
        time.sleep(30)
        if stt["device"] == "cuda" and time.time() - stt["used"] > STT_GPU_IDLE_S:
            with lock:
                unload_gpu()


if __name__ == "__main__":
    if "--port" in sys.argv:
        PORT = int(sys.argv[sys.argv.index("--port") + 1])
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=idle_watch, daemon=True).start()
    # Whisper e la voce predefinita si preparano subito, così la prima frase non aspetta il caricamento
    def warm():
        try:
            with lock:
                load_stt()
            get_voice(DEFAULT_VOICE)
        except Exception as e:
            log(f"preparazione: {e}")
    threading.Thread(target=warm, daemon=True).start()
    log(f"in ascolto su http://127.0.0.1:{PORT} (voci in {VOICES_DIR})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
