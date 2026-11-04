#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  echo "usage: deploy-on-ec2.sh <immutable-image-uri> <aws-region>" >&2
  exit 2
fi

image_uri="$1"
aws_region="$2"
compose_file="/opt/osmosis/deploy/compose.production.yaml"
env_file="/opt/osmosis/deploy/production.env"
old_env_file="/run/osmosis-production.env.previous"
new_env_file="/opt/osmosis/deploy/production.env.next"
ssm_json="/run/osmosis-production-parameters.json"
install -d -m 0750 /opt/osmosis/deploy
trap 'rm -f "$ssm_json" "$new_env_file"; docker logout "$registry" >/dev/null 2>&1 || true' EXIT

registry="${image_uri%%/*}"
if [[ "$image_uri" != "$registry/osmosis:"* ]]; then
  echo "Image must be a tagged image from the osmosis ECR repository." >&2
  exit 2
fi

parameter_names=(
  /osmosis/prod/CLIENT_ORIGINS
  /osmosis/prod/LIVEKIT_URL
  /osmosis/prod/LIVEKIT_API_KEY
  /osmosis/prod/LIVEKIT_API_SECRET
  /osmosis/prod/RECONNECT_SECRET
  /osmosis/prod/METRICS_TOKEN
  /osmosis/prod/ENABLE_QUICK_PLAY
)

aws ecr get-login-password --region "$aws_region" \
  | docker login --username AWS --password-stdin "$registry" >/dev/null

aws ssm get-parameters \
  --names "${parameter_names[@]}" \
  --with-decryption \
  --region "$aws_region" \
  --output json > "$ssm_json"

# Convert SSM values into a mode-0600 Compose env file. Values are single
# quoted so Compose does not interpolate dollar signs in secrets.
python3 - "$ssm_json" "$new_env_file" "$image_uri" <<'PY'
import json
import os
import sys
import tempfile

source, destination, image = sys.argv[1:]
expected = {
    "CLIENT_ORIGINS",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "RECONNECT_SECRET",
    "METRICS_TOKEN",
    "ENABLE_QUICK_PLAY",
}

with open(source, encoding="utf-8") as handle:
    payload = json.load(handle)
values = {item["Name"].rsplit("/", 1)[-1]: item["Value"] for item in payload["Parameters"]}
missing = sorted(key for key in expected if not values.get(key))
if missing:
    raise SystemExit("Required production SSM parameters are missing: " + ", ".join(missing))
if set(values) & expected != expected:
    raise SystemExit("SSM parameter response was incomplete")
if values["ENABLE_QUICK_PLAY"] not in {"true", "false"}:
    raise SystemExit("ENABLE_QUICK_PLAY must be true or false")
if any("\n" in value or "\r" in value for value in values.values()):
    raise SystemExit("Production parameter values cannot contain line breaks")

def quote(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"

lines = ["GAME_SERVER_IMAGE=" + quote(image)]
lines.extend(key + "=" + quote(values[key]) for key in sorted(expected))
directory = os.path.dirname(destination)
fd, temporary = tempfile.mkstemp(prefix="production.env.", dir=directory, text=True)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    os.replace(temporary, destination)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
rm -f "$ssm_json"

if [[ -f "$env_file" ]]; then
  cp -p "$env_file" "$old_env_file"
else
  rm -f "$old_env_file"
fi
mv -f "$new_env_file" "$env_file"
chmod 0600 "$env_file"

restore_previous_environment() {
  if [[ -f "$old_env_file" ]]; then
    mv -f "$old_env_file" "$env_file"
    chmod 0600 "$env_file"
  else
    rm -f "$env_file"
  fi
}

compose=(docker compose --file "$compose_file" --env-file "$env_file")
if ! "${compose[@]}" config --quiet; then
  echo "Compose configuration validation failed." >&2
  restore_previous_environment
  exit 1
fi

if ! "${compose[@]}" pull game-server; then
  echo "Could not pull the selected image; keeping the prior deployment configuration." >&2
  restore_previous_environment
  exit 1
fi
if "${compose[@]}" up -d --no-build --wait --wait-timeout 180; then
  if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:2567/health >/dev/null; then
    printf '%s\n' "$image_uri" > /opt/osmosis/deploy/current-image
    chmod 0640 /opt/osmosis/deploy/current-image
    rm -f "$old_env_file"
    echo "Osmosis deployment healthy: $image_uri"
    exit 0
  fi
fi

echo "New image failed its local health check; attempting rollback." >&2
if [[ -f "$old_env_file" ]]; then
  restore_previous_environment
  if docker compose --file "$compose_file" --env-file "$env_file" \
      up -d --no-build --wait --wait-timeout 180; then
    echo "Previous Osmosis image was restored and is healthy." >&2
  else
    echo "Automatic rollback failed; inspect Docker and Caddy service logs through SSM." >&2
  fi
else
  echo "No prior deployment exists to roll back." >&2
fi
exit 1
