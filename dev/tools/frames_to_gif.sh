#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/app/docs/readme"

make_gif() {
  local name="$1"
  local frames_dir="$OUT_DIR/screencast-$name"
  local out_gif="$OUT_DIR/readme-$name.gif"
  if [[ ! -d "$frames_dir" ]]; then
    echo "Missing frames: $frames_dir" >&2
    return 1
  fi
  # Use a palette for better quality.
  ffmpeg -y -framerate 12 -i "$frames_dir/%03d.png" \
    -vf "scale=1280:-1:flags=lanczos,palettegen" \
    "$OUT_DIR/.palette-$name.png"

  ffmpeg -y -framerate 12 -i "$frames_dir/%03d.png" -i "$OUT_DIR/.palette-$name.png" \
    -lavfi "scale=1280:-1:flags=lanczos [x]; [x][1:v] paletteuse" \
    "$out_gif"
}

make_gif dashboard
make_gif plot
make_gif gauge
make_gif terminal

echo "GIFs written to $OUT_DIR"
