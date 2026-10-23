#!/usr/bin/env bash
# Creates the RSA key pair the web app signs in with and registers the public key on
# the HEALTHLINE_APP service user. The private key stays outside the repo.
set -euo pipefail

CONNECTION="${1:-HACKATHON_JMZWKV}"
KEY_DIR="$HOME/.snowflake/keys"
KEY="$KEY_DIR/healthline_app.p8"

mkdir -p "$KEY_DIR"
if [ ! -f "$KEY" ]; then
  openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -inform PEM -out "$KEY" -nocrypt
  chmod 600 "$KEY"
fi

PUB=$(openssl rsa -in "$KEY" -pubout 2>/dev/null | grep -v -- '-----' | tr -d '\n')
snow sql -c "$CONNECTION" -q "ALTER USER HEALTHLINE_APP SET RSA_PUBLIC_KEY='$PUB'" >/dev/null

echo "Private key: $KEY"
echo "Set SNOWFLAKE_PRIVATE_KEY_PATH=$KEY in web/.env.local"
