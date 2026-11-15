"""
Transcreve a narração de uma variação com tempo por palavra, para o render cortar
as cenas exatamente nas palavras.

    pip install faster-whisper numpy
    python motor/sincronizar.py saida/<produto>/<lote>/<variação>

Lê <variação>/narracao.wav e escreve <variação>/palavras.json ([{"w","s","e"}, ...]).
O roteiro (roteiro.md) é passado como dica para a transcrição reconhecer nomes do produto.
"""
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel


def main(pasta: str, modelo: str = "small") -> None:
    dir_ = Path(pasta)
    audio = dir_ / "narracao.wav"
    if not audio.exists():
        sys.exit(f"Não achei {audio}")
    dica = ""
    roteiro = dir_ / "roteiro.md"
    if roteiro.exists():
        texto = roteiro.read_text(encoding="utf8")
        if "## Narração" in texto:
            dica = texto.split("## Narração", 1)[1].split("##", 1)[0].strip()[:400]
    with tempfile.TemporaryDirectory() as tmp:
        wav16 = Path(tmp) / "a16.wav"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(audio), "-ac", "1", "-ar", "16000", str(wav16)], check=True)
        with wave.open(str(wav16)) as wf:
            dados = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    m = WhisperModel(modelo, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(dados, language="pt", word_timestamps=True, beam_size=5, initial_prompt=dica or None)
    palavras = [{"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)} for s in segs for w in s.words]
    (dir_ / "palavras.json").write_text(json.dumps(palavras, ensure_ascii=False), encoding="utf8")
    print(f"{len(palavras)} palavras -> {dir_ / 'palavras.json'}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:])
