#!/usr/bin/env bash
# Generates offline filler audio pack via ElevenLabs (TTS + SFX).
# Run from repo root: bash scripts/generate-filler-audio.sh
# Requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.

set -euo pipefail

if [ -f .env ]; then
  set -a; source .env; set +a
fi

: "${ELEVENLABS_API_KEY:?ELEVENLABS_API_KEY missing in .env}"
: "${ELEVENLABS_VOICE_ID:?ELEVENLABS_VOICE_ID missing in .env}"

OUT_DIR="assets/sounds/filler"
mkdir -p "$OUT_DIR"

TTS_SETTINGS='{"stability":0.4,"similarity_boost":0.75,"style":0.5,"use_speaker_boost":true}'
TTS_MODEL="eleven_multilingual_v2"

tts() {
  local name="$1" text="$2"
  local path="$OUT_DIR/$name.mp3"
  local body
  body=$(jq -n --arg t "$text" --arg m "$TTS_MODEL" --argjson s "$TTS_SETTINGS" \
    '{text:$t,model_id:$m,voice_settings:$s}')
  local code
  code=$(curl -sS -w "%{http_code}" -o "$path" \
    -X POST "https://api.elevenlabs.io/v1/text-to-speech/$ELEVENLABS_VOICE_ID?output_format=mp3_44100_128" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  if [ "$code" != "200" ]; then
    echo "FAIL tts $name HTTP $code"; cat "$path"; echo; rm -f "$path"; return 1
  fi
  printf "  ok  %-24s %6s bytes\n" "$name" "$(wc -c < "$path")"
}

sfx() {
  local name="$1" prompt="$2" duration="$3"
  local path="$OUT_DIR/$name.mp3"
  local body
  body=$(jq -n --arg t "$prompt" --argjson d "$duration" \
    '{text:$t, duration_seconds:$d, prompt_influence:0.7}')
  local code
  code=$(curl -sS -w "%{http_code}" -o "$path" \
    -X POST "https://api.elevenlabs.io/v1/sound-generation" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  if [ "$code" != "200" ]; then
    echo "FAIL sfx $name HTTP $code"; cat "$path"; echo; rm -f "$path"; return 1
  fi
  printf "  ok  %-24s %6s bytes\n" "$name" "$(wc -c < "$path")"
}

echo "== Voice (Riley, $ELEVENLABS_VOICE_ID) =="
tts cold-start-1   "Give me a second. Brain's still booting."
tts cold-start-2   "Eyes on. Mouth almost. Hold."
tts cold-start-3   "Warming up the sarcasm generator."

tts network-lost-1 "Signal's dead. You driving through a Faraday cage or what."
tts network-lost-2 "Lost connection. Awkward. I had a good one lined up too."
tts network-lost-3 "Great. No bars. Now we're just two idiots in a metal box."

tts reconnecting-1 "Trying to reconnect. Don't touch anything."
tts reconnecting-2 "Hold. Reaching for the cloud."

tts brain-down-1   "Brain's out. Cloud's down. I'm basically a toaster right now."
tts brain-down-2   "Give it a minute. Or restart me. I don't care which."

tts api-missing-1  "No brain today. Config's broken. Yell at whoever set this up."

tts idle-1         "Still here. Still judging."
tts idle-2         "Still watching. Still taking notes."
tts idle-3         "Quiet in here. Too quiet. Say something stupid."
tts idle-4         "Forty minutes staring at your dashboard. Living the dream."

echo "== SFX =="
sfx sfx-boot-chirp       "short sci-fi computer boot chirp, bright synthetic pulse, single note, clean digital" 1
sfx sfx-glitch-crackle   "digital signal glitch with harsh crackle and broken transmission artifacts, short and sharp" 2
sfx sfx-reconnect-ping   "soft single sonar ping, subtle digital chime, clean decay, no reverb tail" 2

echo
echo "Done. Files in $OUT_DIR/"
ls -la "$OUT_DIR/"
