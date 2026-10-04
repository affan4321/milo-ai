#!/usr/bin/env bash
# Synthesize a multi-voice conversation with macOS `say` plus ground truth for STT evaluation.
# Usage: ./scripts/make-say-conversation.sh <rounds> <outdir>   (each round = 10 utterances by 3 voices, ~55s)
set -euo pipefail
ROUNDS="${1:-12}"; OUT="${2:-.data/samples/say-long}"; mkdir -p "$OUT"; cd "$OUT"; rm -f u*.wav gap*.wav truth.tsv list.txt
LINES=(
"Samantha|Good morning everyone, thanks for joining. Let us review point NN on the agenda."
"Daniel|Engineering can finish the checkout work for point NN by the twentieth, if we drop the coupon feature."
"Karen|I am fine dropping coupons. Daniel, please confirm the date with the QA team by Friday."
"Daniel|I will message QA this afternoon and send the confirmed date to everyone."
"Samantha|Great. On the marketing side, Karen, can you draft the launch email for point NN?"
"Karen|Yes, I will share a draft on Monday for review."
"Samantha|Next, the support backlog. We currently have forty open tickets and we need one more hire."
"Karen|I will write the job description this week and post it on Thursday."
"Daniel|Sounds good. Let us also track the refund requests separately for point NN."
"Samantha|Agreed. Thanks everyone, let us move on."
)
: > truth.tsv; : > list.txt; T=0; i=0
for r in $(seq 1 "$ROUNDS"); do for l in "${LINES[@]}"; do
  i=$((i+1)); voice="${l%%|*}"; text="${l#*|}"; text="${text//NN/$((r*7+i%5))}"
  say -v "$voice" -o "u$i.aiff" "$text"; ffmpeg -y -loglevel error -i "u$i.aiff" -ar 16000 -ac 1 "u$i.wav"; rm -f "u$i.aiff"
  D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "u$i.wav"); printf "%s\t%.2f\t%s\t%s\n" "$i" "$T" "$voice" "$text" >> truth.tsv
  ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=16000:cl=mono" -t 0.8 "gap$i.wav"
  printf "file 'u%s.wav'\nfile 'gap%s.wav'\n" "$i" "$i" >> list.txt; T=$(python3 -c "print($T+$D+0.8)")
done; done
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c:a aac -b:a 48k conversation.m4a
rm -f u*.wav gap*.wav
echo "$OUT: $(wc -l < truth.tsv) utterances, $(ffprobe -v error -show_entries format=duration -of csv=p=0 conversation.m4a)s"
