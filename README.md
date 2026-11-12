# Caritas 🚦

El marcador nocturno de la familia: cada noche se valora a Martín y Ángel con un semáforo de caritas — verde, amarillo o rojo — en cada apartado del día. Se usa desde el móvil y desde la tele del salón (LG webOS), y todo lo que se marca aparece al instante en todas las pantallas.

## Qué hace

- **Esta noche**: una tarjeta por peque con el semáforo de cada apartado (Comida, Comportamiento, Histerias, Orden de habitación…), notas por hueco, **extras verdes o rojos para imprevistos** y foto de cada peque.
- **Bombillas de la semana**: siete luces bajo cada nombre (lunes a domingo). Cada día se colorea por sus puntos frente a los que había en juego: verde desde el 85%, amarillo desde el 40% y rojo por debajo (los extras suman). La semana se lee de un vistazo.
- **Premios**: los puntos de la semana (verde 2, amarillo 1, rojo 0, configurables) desbloquean premios escalonados: *Pizza el sábado* a 8, *Croissants el sábado* a 12, *Más tiempo dibujos* a 15, *Más tiempo consola* a 20. Al llegar, el billete se sella.
- **Histórico**: calendario del mes con los dos niños lado a lado; cada día se abre para consultar o corregir.
- **Gráficas**: puntos por semana y reparto de caritas por apartado de los últimos 30 días.
- **Detalles**: confeti al marcar una verde, sacudida con la roja, PIN opcional para poder marcar, fotos de perfil, tiempo real por WebSocket con respaldo de refresco.

## Arrancar

```bash
docker compose up -d --build
```

Web en `http://<IP-de-esta-máquina>:3010`. En el móvil, "Añadir a pantalla de inicio".

Los datos viven en `./data/` (SQLite + fotos). Esa carpeta **no se sube al repositorio**: contiene el PIN y fotos de los peques.

## La app en la tele (webOS)

La `.ipk` es un envoltorio ("hosted app") que redirige a la web del servidor: actualizar la interfaz no requiere reinstalar, solo refrescar la app en la tele.

Una sola vez:

```bash
npm i -g @webos-tools/cli      # CLI de webOS
cd webos
SERVER_URL=http://<IP>:3010 ./build.sh
ares-setup-device --add tv --info "host=<IP-DE-LA-TELE>;user=prisoner;port=9922;passphrase=<CÓDIGO-DEVELOPER-MODE>"
ares-novacom --device tv --getkey   # pide el mismo passphrase
ares-install --device tv dist/*.ipk
ares-launch --device tv com.home.caritas
```

Con la tele en reposo `ares-install` fallará por timeout: enciéndela y reintenta. Para actualizar la interfaz basta `docker compose up -d --build` y cerrar/abrir la app en la tele.

## Estructura

```
server/   API + WebSocket + SQLite (Express, Socket.IO, better-sqlite3)
web/      la web única (móvil y tele), sin frameworks ni dependencias de cliente
webos/    envoltorio .ipk para webOS (appinfo, icono, build.sh)
scripts/  generador de iconos (PNG sin dependencias)
data/     base de datos y fotos (privado, fuera de git)
```

Compatibilidad: el navegador de webOS es viejo (Chromium 53+), así que la web evita sintaxis moderna y las fuentes se sirven en local.
