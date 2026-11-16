"""
Transcreve vídeos de referência (anúncios coletados) para extrair o gancho e a fala inteira.

    python motor/transcrever.py saida.json video1.mp4 video2.mp4 ...

Escreve saida.json: {"<arquivo>": {"gancho": "fala dos 3 primeiros segundos", "texto": "fala inteira", "duracao": s}}.
Vídeo sem fala (só música e texto na tela) volta com texto vazio.
"""
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

GANCHO_S = 3.5


def tem_audio(video: Path) -> bool:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(video)], capture_output=True, text=True)
    return bool(r.stdout.strip())


def audio16(video: Path, tmp: Path) -> np.ndarray:
    wav = tmp / "a.wav"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    with wave.open(str(wav)) as wf:
        return np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def main(saida: str, *videos: str) -> None:
    m = WhisperModel("small", device="cpu", compute_type="int8")
    out = {}
    for v in videos:
        try:
            if not tem_audio(Path(v)):
                out[v] = {"gancho": "", "texto": "", "sem_audio": True}
                print(f"--  {Path(v).name}: sem faixa de áudio (só imagem e texto na tela)")
                continue
            with tempfile.TemporaryDirectory() as tmp:
                dados = audio16(Path(v), Path(tmp))
            segs, _ = m.transcribe(dados, language="pt", word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
            palavras = [w for s in segs for w in s.words]
            texto = " ".join(w.word.strip() for w in palavras)
            # O gancho é a primeira frase falada, até uns 3,5 s depois do início da fala.
            inicio = palavras[0].start if palavras else 0
            gancho = " ".join(w.word.strip() for w in palavras if w.start <= inicio + GANCHO_S)
            out[v] = {"gancho": gancho, "texto": texto, "duracao": round(len(dados) / 16000, 1)}
            print(f"ok  {Path(v).name}: {gancho[:70]}")
        except Exception as e:  # um vídeo ruim não derruba a coleta
            out[v] = {"gancho": "", "texto": "", "erro": str(e)}
            print(f"erro {Path(v).name}: {e}")
    Path(saida).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf8")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
