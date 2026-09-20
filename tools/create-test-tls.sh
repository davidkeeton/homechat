#!/usr/bin/env sh
set -eu
IP="${1:-192.168.98.43}"
OUT="${2:-/home/dkeeton/docker/appdata/homechat/tls}"
mkdir -p "$OUT"

openssl genrsa -out "$OUT/homechat-root-ca.key" 3072
openssl req -x509 -new -nodes -key "$OUT/homechat-root-ca.key" -sha256 -days 3650 \
  -subj "/CN=HomeChat Test Root CA" -out "$OUT/homechat-root-ca.crt"

openssl genrsa -out "$OUT/homechat.key" 2048
openssl req -new -key "$OUT/homechat.key" -subj "/CN=$IP" -out "$OUT/homechat.csr"
cat > "$OUT/homechat.ext" <<EXT
subjectAltName = IP:$IP
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
EXT
openssl x509 -req -in "$OUT/homechat.csr" -CA "$OUT/homechat-root-ca.crt" -CAkey "$OUT/homechat-root-ca.key" \
  -CAcreateserial -out "$OUT/homechat.crt" -days 825 -sha256 -extfile "$OUT/homechat.ext"
rm -f "$OUT/homechat.csr" "$OUT/homechat.ext" "$OUT/homechat-root-ca.srl"
chmod 600 "$OUT/homechat.key" "$OUT/homechat-root-ca.key"
printf '\nCreated HomeChat test TLS files in %s\n\n' "$OUT"
printf 'Install and trust this CA certificate on each test device:\n  %s/homechat-root-ca.crt\n\n' "$OUT"
printf 'Then enable TLS_CERT_FILE/TLS_KEY_FILE in docker-compose.yml and browse to:\n  https://%s:8092\n' "$IP"
