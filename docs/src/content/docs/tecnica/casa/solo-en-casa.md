---
title: 'Solo en casa'
---

La app **solo funciona conectado a la wifi (o la red) de casa: fuera de ella no se llega**, ni con
datos móviles. Quien la use debe saberlo. Fuera, lo de la familia está en Seilide.

Hace falta HTTPS igualmente: sin él, el navegador no deja usar el micrófono (las órdenes de voz) y
no guarda la sesión (sus cookies son `Secure`). Hay dos formas de tener un certificado:

|                     | A. Certificado propio                       | B. Dominio con la IP de casa (recomendada)  |
| ------------------- | ------------------------------------------- | ------------------------------------------- |
| Hace falta          | Nada más                                    | Un dominio (unos 10 € al año) en Cloudflare |
| En cada dispositivo | Instalar la raíz de Caddy, una vez          | Nada                                        |
| Teles, Chromecast…  | A menudo no se puede instalar               | Funciona                                    |
| Dirección           | Un nombre de la red de casa (`salon.local`) | El dominio (`jelly.tudominio.es`)           |

En las dos:

- **Una IP fija para el PC** en la red de casa: en el router, «reserva DHCP» (o «IP estática») para
  ese equipo. Si cambiara, el nombre dejaría de llevar a él.
- `docker compose -f compose.prod.yaml up -d` y, la primera vez,
  `docker compose -f compose.prod.yaml logs -f caddy` para ver que saca el certificado.

## A. Certificado propio de Caddy

Caddy crea su propia autoridad de certificación y firma con ella el certificado de la app (lo renueva
solo). Cada dispositivo tiene que fiarse de esa autoridad instalando su raíz, una sola vez: vale 10
años.

1. **Un nombre en la red de casa.** Con una IP no sirve: el navegador no dice a qué nombre va y
   Caddy no sabe qué certificado dar. Lo más sencillo es el nombre del PC con `.local`, que Linux
   anuncia solo por mDNS (Avahi, `sudo systemctl enable --now avahi-daemon`) y que entienden
   Windows, Mac, iPhone y los Android recientes: si el PC se llama `salon`, `salon.local`. Si el
   router deja poner nombres a los equipos de la red, también vale uno de ahí.
2. En el `.env`:
   ```sh
   ORIGIN="https://salon.local"
   TLS="internal"
   ```
   Sin `CF_API_TOKEN`.
3. Arranca, y saca la raíz de Caddy (la pública: **nunca** `root.key`):
   ```sh
   docker compose -f compose.prod.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt jellycartoon-raiz.crt
   ```
4. **En cada dispositivo**, instálala como autoridad de confianza (pásala por correo, una memoria o
   la red):
   - **Windows:** doble clic → «Instalar certificado» → «Equipo local» → «Colocar todos los
     certificados en el siguiente almacén» → «Entidades de certificación raíz de confianza».
   - **Mac:** doble clic (se abre Acceso a Llaveros, en «Sistema») → doble clic en «Caddy Local
     Authority» → «Confiar» → «Confiar siempre».
   - **Linux:** `sudo cp jellycartoon-raiz.crt /usr/local/share/ca-certificates/ && sudo
update-ca-certificates` (en Fedora o Arch, `sudo trust anchor jellycartoon-raiz.crt`).
     Firefox usa su propio almacén: Ajustes → Privacidad y seguridad → Certificados → Importar.
   - **iPhone y iPad:** abrir el fichero (desde Correo o Archivos) → Ajustes → «Perfil descargado» →
     Instalar. Y después, **imprescindible**: Ajustes → General → Información → Ajustes de
     confianza de certificados → activar «Caddy Local Authority».
   - **Android:** Ajustes → Seguridad (o «Cifrado y credenciales») → Instalar un certificado →
     «Certificado de CA», y aceptar el aviso. Chrome se fía de él; muchas apps, no.
   - **Teles y otros aparatos:** casi nunca dejan instalar una autoridad. Para la tele, mejor un PC
     conectado (como el del salón) o la opción B.
5. Abre `https://salon.local`: sin la raíz instalada, el navegador avisa de que la conexión no es
   segura. No hay que aceptar el aviso, sino instalar la raíz.

Si se borra el volumen de Caddy (`caddy_data`), crea otra autoridad y hay que volver a instalar la
raíz en todos los dispositivos.

## B. Un dominio que apunta a la IP de casa

El dominio apunta a la IP del PC **en la red de casa**. Desde
fuera esa dirección no lleva a ningún sitio (es una IP privada), y en casa da un certificado de
verdad de Let's Encrypt: no hay que instalar nada en ningún dispositivo.

1. En Cloudflare, un registro `A` del dominio (por ejemplo `jelly.tudominio.es`) → la IP del PC en
   casa (`192.168.1.50`, la de `ip -4 addr`), en modo **DNS only** (sin proxy).
2. El token de API de Cloudflare (`Zone.Zone:Read` y `Zone.DNS:Edit`, ver [Producción](/tecnica/casa/produccion/)).
3. En el `.env`:
   ```sh
   ORIGIN="https://jelly.tudominio.es"
   CF_API_TOKEN="..."
   ```
   (`TLS` no hace falta: `cloudflare` es lo que hay por defecto.)
4. Si en casa el nombre no lleva a ningún sitio: algunos routers (FRITZ!Box, por ejemplo) y algunos
   DNS con filtros bloquean los nombres públicos que dan una IP privada, por si fuera un ataque
   («DNS rebinding»). En el router se añade el dominio como excepción («protección DNS rebinding»);
   o se usa otro DNS. Para comprobarlo, `nslookup jelly.tudominio.es` en un equipo de casa tiene
   que dar la IP del PC.
