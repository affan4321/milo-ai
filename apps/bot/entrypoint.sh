#!/usr/bin/env bash
# Starts the virtual display and a virtual audio sink, then runs the bot (run | login | once ...).
set -euo pipefail
export DISPLAY="${DISPLAY:-:99}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-bot}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb "$DISPLAY" -screen 0 "${BOT_VIDEO_SIZE:-1280x720}x24" -nolisten tcp &
for _ in $(seq 1 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done

# One null sink: Chrome plays the meeting into it, ffmpeg records its monitor. Nothing reaches real speakers or a microphone.
pulseaudio -D --exit-idle-time=-1 --log-target=stderr >/dev/null 2>&1 || true
for _ in $(seq 1 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done
pactl load-module module-null-sink sink_name=meet_sink sink_properties=device.description=meet_sink >/dev/null
pactl set-default-sink meet_sink

if [ "${1:-run}" = "login" ]; then
  : "${BOT_VNC_PASSWORD:?set BOT_VNC_PASSWORD to sign in through VNC}"
  x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -passwd "$BOT_VNC_PASSWORD" -quiet -bg
  echo "VNC ready on port 5900. Connect, sign in to the bot's Google account, then close the browser window."
fi
# Every container works on its OWN copy of the signed-in profile. A Chrome profile can only be open in one browser at a time, so
# sharing one directory between replicas would corrupt it. `login` writes the shared template (/profile); `run` copies it.
if [ "${1:-run}" != "login" ] && [ -d /profile ]; then
  WORK=/work/profile; rm -rf "$WORK"; mkdir -p "$WORK"
  (cd /profile && tar cf - --exclude=Cache --exclude='Code Cache' --exclude=GPUCache --exclude=CacheStorage --exclude='Service Worker' --exclude=SingletonLock --exclude=SingletonCookie --exclude=SingletonSocket . 2>/dev/null) | (cd "$WORK" && tar xf -) || true
  export BOT_PROFILE_DIR="$WORK"
fi
cd /app/apps/bot && exec ../../node_modules/.bin/tsx src/index.ts "$@"
