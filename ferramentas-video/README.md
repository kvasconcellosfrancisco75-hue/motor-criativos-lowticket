# Ferramentas de vídeo (testadas em 22/11/2026)

| Ferramenta | Versão | Onde | Como usar |
|---|---|---|---|
| Remotion | 4.0.543 | raiz do projeto (`node_modules`) | `npx remotion render <entrada> <composição> saida.mp4 --public-dir=<pasta>` |
| HyperFrames | 0.9.79 | `ferramentas-video/node_modules` | `ferramentas-video/node_modules/.bin/hyperframes init|check|render` (telemetria desligada) |
| ffmpeg / ffprobe | 6.1.1 | sistema (`/usr/bin`) | `ffmpeg ...` |
| Whisper (faster-whisper) | 1.2.1, modelo `small` | `ferramentas-video/.venv` | `. .venv/bin/activate && python` (usa `av==15.1.0`; versões mais novas quebram) |
| yt-dlp | 2026.10.26 | `ferramentas-video/.venv` | `. .venv/bin/activate && yt-dlp <url>` |

Instalar de novo: `npm install` e `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`.

Testes em `testes/`: `ffmpeg_teste.mp4`, `hyperframes_teste.mp4`, `remotion_teste.png`.
