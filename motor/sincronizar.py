"""
Transcreve a narração de uma variação com tempo por palavra, para o render cortar
as cenas exatamente nas palavras.

    pip install faster-whisper numpy
    python motor/sincronizar.py saida/<produto>/<lote>/<variação>

Lê <variação>/narracao.wav e escreve <variação>/palavras.json ([{"w","s","e"}, ...]).
Do roteiro (roteiro.md) saem só os nomes próprios, como dica de vocabulário. Passar a narração
inteira como dica faz o Whisper tratá-la como "já dita" e pular trechos.
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
    esperadas = 0
    roteiro = dir_ / "roteiro.md"
    if roteiro.exists():
        texto = roteiro.read_text(encoding="utf8")
        if "## Narração" in texto:
            narracao = texto.split("## Narração", 1)[1].split("##", 1)[0].strip()
            esperadas = len(narracao.split())
            nomes = dict.fromkeys(w.strip(".,:;!?\"'") for w in narracao.split() if any(c.isupper() for c in w[1:]) or (w[:1].isupper() and len(w) > 3))
            dica = ", ".join(n for n in nomes if n) + "."
    with tempfile.TemporaryDirectory() as tmp:
        wav16 = Path(tmp) / "a16.wav"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(audio), "-ac", "1", "-ar", "16000", str(wav16)], check=True)
        with wave.open(str(wav16)) as wf:
            dados = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    m = WhisperModel(modelo, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(dados, language="pt", word_timestamps=True, beam_size=5, initial_prompt=dica or None, condition_on_previous_text=False, vad_filter=True)
    palavras = [{"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)} for s in segs for w in s.words]
    (dir_ / "palavras.json").write_text(json.dumps(palavras, ensure_ascii=False), encoding="utf8")
    print(f"{len(palavras)} palavras -> {dir_ / 'palavras.json'}")
    longas = [p for p in palavras if p["e"] - p["s"] > 2.5]
    if esperadas and len(palavras) < 0.8 * esperadas or longas:
        print(f"ATENÇÃO: o roteiro tem {esperadas} palavras e a transcrição {len(palavras)}"
              + (f"; {len(longas)} palavra(s) com mais de 2,5 s" if longas else "")
              + ". Confira palavras.json antes de renderizar.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:])
