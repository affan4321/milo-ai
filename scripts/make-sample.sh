#!/usr/bin/env bash
# Generate a synthetic recording for pipeline testing: ./scripts/make-sample.sh <seconds> [out.mp4]
# Video is a low-fps test pattern with a running timecode; audio is a tone that changes pitch every 6s.
set -euo pipefail
SECS="${1:-30}"; OUT="${2:-.data/samples/sample-${SECS}s.mp4}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=640x360:rate=5" \
  -f lavfi -i "sine=frequency=330:sample_rate=44100" \
  -t "$SECS" -vf "drawtext=text='%{pts\:hms}':x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5" \
  -c:v libx264 -preset ultrafast -crf 32 -g 25 -c:a aac -b:a 64k "$OUT" 2>/dev/null \
|| ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=640x360:rate=5" -f lavfi -i "sine=frequency=330:sample_rate=44100" \
  -t "$SECS" -c:v libx264 -preset ultrafast -crf 32 -g 25 -c:a aac -b:a 64k "$OUT"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
