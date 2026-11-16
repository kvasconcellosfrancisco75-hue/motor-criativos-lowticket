#!/usr/bin/env bash
# Prepara uma narração bruta (gravação própria ou voz gerada) para o criativo:
# corta o silêncio do começo e do fim, encurta pausas longas e normaliza o volume.
#
#   bash motor/preparar-audio.sh entrada.(wav|m4a|mp3) saida/<produto>/<lote>/<variação>/narracao.wav [pausa_max_s]
#
# pausa_max_s: pausas acima de 0,25 s são reduzidas a este valor (padrão 0,15 s). O limite de silêncio é
# -50 dB para não confundir o fim de uma palavra dita mais baixo com pausa (isso corta a pronúncia).
set -euo pipefail
IN="$1"; OUT="$2"; PAUSA="${3:-0.15}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -hide_banner -loglevel error -y -i "$IN" -ac 1 -ar 44100 -af "\
silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,\
silenceremove=stop_periods=-1:stop_duration=0.25:stop_threshold=-50dB:stop_silence=${PAUSA},\
loudnorm=I=-15:TP=-1.5:LRA=11" "$OUT"
echo "ok: $OUT ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s)"
