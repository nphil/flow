#!/usr/bin/env bash
# Starts an image that serves the Flow bundle on port 80 and checks that it really does: the
# index page with the app root, and the first script that page links to.
#
#   scripts/smoke-test-image.sh <image> [host-port]
set -euo pipefail

image=${1:?usage: smoke-test-image.sh <image> [host-port]}
port=${2:-8099}
name="flow-smoke-$$"
page=$(mktemp)

docker run --detach --rm --name "$name" --publish "$port:80" "$image" >/dev/null
trap 'docker logs "$name" 2>&1 | tail -n 20; docker stop "$name" >/dev/null; rm -f "$page"' EXIT

for _ in $(seq 1 30); do
  if curl -fsS --output "$page" "http://127.0.0.1:$port/" 2>/dev/null; then break; fi
  sleep 1
done

fail() {
  echo "::error::$image $1"
  exit 1
}

[ -s "$page" ] || fail "did not answer on port $port"
grep -q '<div id="root">' "$page" || fail "served a page without the Flow app root"
asset=$(grep -oE -m1 'assets/[^"]+\.js' "$page") || fail "serves an index.html that links no script"
curl -fsS --output /dev/null "http://127.0.0.1:$port/$asset" || fail "does not serve $asset"

echo "$image serves index.html and $asset"
