#!/usr/bin/env bash
# Self-signed certificate for testing on phones over https (location needs https).
# Nothing is installed into the system trust store; the phone shows a warning once.
set -e
mkdir -p certs
IP=$(node -e 'const n=require("os").networkInterfaces();console.log(Object.values(n).flat().find(i=>i.family==="IPv4"&&!i.internal&&i.address.startsWith("192.168"))?.address||"127.0.0.1")')
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=baraka-dev" \
  -keyout certs/key.pem -out certs/cert.pem -addext "subjectAltName=IP:$IP,IP:127.0.0.1,DNS:localhost" 2>/dev/null
echo "certificate for https://$IP:3000 written to certs/"
