#!/usr/bin/env sh
set -eu
HOST_NAME="${1:-${HOMECHAT_HOST:-localhost}}"
OUT="${2:-${HOMECHAT_TLS_DIR:-./data/tls}}"
mkdir -p "$OUT"

if printf '%s' "$HOST_NAME" | grep -Eq '^[0-9a-fA-F:.]+$'; then
  SAN="IP:$HOST_NAME,DNS:localhost,IP:127.0.0.1"
else
  SAN="DNS:$HOST_NAME,DNS:localhost,IP:127.0.0.1"
fi

openssl genrsa -out "$OUT/homechat-root-ca.key" 3072
openssl req -x509 -new -nodes -key "$OUT/homechat-root-ca.key" -sha256 -days 3650   -subj "/CN=HomeChat Local Root CA" -out "$OUT/homechat-root-ca.crt"

openssl genrsa -out "$OUT/homechat.key" 2048
openssl req -new -key "$OUT/homechat.key" -subj "/CN=$HOST_NAME" -out "$OUT/homechat.csr"
cat > "$OUT/homechat.ext" <<EXT
subjectAltName = $SAN
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
EXT
openssl x509 -req -in "$OUT/homechat.csr" -CA "$OUT/homechat-root-ca.crt" -CAkey "$OUT/homechat-root-ca.key"   -CAcreateserial -out "$OUT/homechat.crt" -days 825 -sha256 -extfile "$OUT/homechat.ext"
rm -f "$OUT/homechat.csr" "$OUT/homechat.ext" "$OUT/homechat-root-ca.srl"
chmod 600 "$OUT/homechat.key" "$OUT/homechat-root-ca.key"
chmod 644 "$OUT/homechat.crt" "$OUT/homechat-root-ca.crt"
printf '
Created HomeChat TLS files in %s for %s
' "$OUT" "$HOST_NAME"
