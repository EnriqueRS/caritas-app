#!/bin/bash
# Empaqueta la app webOS (.ipk). Necesita el CLI de webOS instalado: npm i -g @webos-tools/cli
set -e
cd "$(dirname "$0")"

SERVER_URL="${SERVER_URL:-http://$(hostname -I | awk '{print $1}'):3010}"
sed -i.bak "s|location.href = '[^']*'|location.href = '$SERVER_URL/'|" app/index.html
rm -f app/index.html.bak
echo "App apuntando a $SERVER_URL"

mkdir -p dist
ares-package app -o dist
echo "IPK generado en webos/dist/ — instalar con:"
echo "  ares-install dist/*.ipk && ares-launch com.home.caritas"
