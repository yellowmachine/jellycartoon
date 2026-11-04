---
title: 'Modo carretera y Viajes'
---

Para una tablet fija junto al volante, en horizontal y con la pantalla partida de Android: a un
lado el navegador (Google Maps u Organic Maps, que hacen la navegación y el tráfico), al otro
`/carretera` («Modo carretera» en Viajes y en Inicio). Solo sonido, y nunca vídeo:

- Lo que suena en grande, con botones enormes (anterior, pausa y siguiente; en un podcast, −15 y
  +30 s), y un micrófono gigante, como el de la cocina.
- Debajo, un botón grande por sección: las emisoras (las españolas primero), la música («Todo
  aleatorio», o un álbum desde el principio), las listas de música, los podcasts (los empezados, y
  lo último de cada uno) y la ruta. Cada sección ocupa la pantalla (o su mitad, con el mapa) con su
  lista, «← Inicio» y, arriba, lo que suena y un micrófono pequeño. Al poner algo se vuelve solo a
  Inicio.
- En un móvil en vertical no hay sitio para el mapa al lado: va en la sección Ruta. Una ruta en
  marcha sigue aunque se cambie de sección: la voz sigue dando las indicaciones, y en Inicio queda
  la siguiente maniobra, que lleva otra vez al mapa. Con la tablet en media
  pantalla, junto al navegador, no hay mapa ni GPS.
- La voz sabe que va en el coche: respuestas muy cortas, solo aquí (no en los altavoces de
  Snapcast), y sin vídeo, cocina ni recetas; aunque pidiera un capítulo, no se abre.
- **Telegram** (#243), con la cuenta de cada uno conectada en jellycartoon (Ajustes → Para mí; la
  sesión no sale de casa, y Seilide le pide los mensajes por el túnel): un botón «Leer
  los mensajes en voz alta», y cada mensaje que llega se lee con la música más baja («Mensaje de
  Ana: llego en diez minutos»; las fotos, audios y demás, solo anunciados). Es la cuenta propia,
  no un bot (un bot solo ve lo que se le escribe a él), con la API de usuario de Telegram por
  [GramJS](https://gram.js.org): `api_id` y `api_hash` de my.telegram.org, el número, el código
  y, si la tiene, la contraseña. La sesión se guarda cifrada en la base de datos, y el servidor
  de casa escucha los mensajes; «Desconectar» la cierra también en Telegram. Por defecto solo
  los chats con una persona y sin marcarlos como leídos; los grupos y el marcarlos, en Ajustes.
- La pantalla no se apaga mientras está abierto (Wake Lock).
- En la misma línea que lo que suena: «←» para salir y un punto, rojo si se guarda el viaje y gris
  si no (tocándolo dice qué es; ámbar si algo falla). «Ocultar mapa» va sobre el mapa, y «Mapa» lo
  vuelve a poner.

Con la tablet entera en horizontal (la pantalla ancha, sin partir), a la izquierda va un mapa
propio ([MapLibre](https://maplibre.org)), con dónde estás por el GPS del navegador: la flecha
sigue la marcha y el mapa gira con ella; si se mueve con el dedo deja de seguirla hasta
«Recentrar». El mapa es claro; «☾ Oscuro» lo pasa a oscuro para la noche (se recuerda). En media pantalla no sale, ni se pide la posición. El mapa es de la propia app, sin
depender de nadie: España recortada de las descargas diarias de
[Protomaps](https://docs.protomaps.com) (OpenStreetMap), con las fuentes e iconos de su estilo, en
`/opt/nube/mapa` del VPS (`MAP_HOST_DIR`). Para ponerlo, o actualizar las calles de vez en cuando,
en el VPS y desde el repositorio (con Docker):

```sh
nube/scripts/mapa.sh /opt/nube                  # España, Baleares y Canarias
nube/scripts/mapa.sh /opt/nube --bbox=-4.06,39.84,-3.98,39.88   # solo una zona
```

Solo baja los trozos de esa zona, no el planeta, y cambia el mapa cuando está entero: el de antes
sigue funcionando mientras tanto. Sin ese fichero, el modo carretera va como siempre, sin mapa.

**Mapas sin cobertura** (#164): para usar una tablet como GPS en el coche, el mapa de una ruta
guardada (unos 5 km a cada lado; unos 20 MB por 65 km de ciudad) se guarda en ella. En Viajes, en
la tablet, «¿Guardar mapas en este dispositivo?» con un nombre; después, desde cualquier
dispositivo, «Bajar» en esa ruta: la tablet lo baja ella sola la próxima vez que se abra la app allí
(si se corta, sigue donde se quedó), y se ve en todos cómo va. El mapa del modo carretera mira primero
esos mapas y solo después pide al servidor. «Quitar» y «Olvidar» el dispositivo, igual: al abrir la
app allí. Si se actualiza el mapa de España o cambia la ruta, sale «mapa antiguo» para volver a
bajarlo. Se recortan en el servidor con `pmtiles`, que va en la imagen, y se guardan en el volumen
`recorridos`, cada familia en su carpeta: solo los baja esa familia. Para que Android no los borre
si falta espacio, mejor la app instalada en la pantalla de inicio.

**Música sin cobertura** (#350): en Música → Listas, «En el coche, sin cobertura»: «Llevar» una lista
en un dispositivo (los mismos que guardan mapas; si este aún no, se le pone nombre ahí mismo). Al
abrir la app allí baja de la casa, con el pase de la música, la copia Opus de cada canción y su
portada, y las guarda en el disco del navegador; cada vez que se abre la pone al día con la lista
(las nuevas se bajan, las quitadas se borran; una canción en dos listas, una vez). Hasta 2 GB por
dispositivo (unas 470 canciones): no se deja pedir una lista que no cabe por su duración, y si al
bajar no cabe, se para y lo dice. En el modo carretera, las listas que lleva suenan desde el disco,
haya o no cobertura; una canción que no tiene y no se puede tocar se salta a la siguiente que sí;
sin la casa, en Listas salen solo esas. Sin red no hay DJ, ni voz, ni listas nuevas.

Con el mapa, el destino se escribe en el propio mapa («¿A dónde vas?», arriba; solo parado y sin
ruta: en marcha se esconde, y se pide por voz, «llévame a…»). Al escribir, debajo, los últimos
destinos de ese dispositivo (el cole, los abuelos…; también sin escribir nada) y las sugerencias de
openrouteservice (su autocompletado, desde 3 letras): tocando una se traza la ruta. Con «Buscar», los
sitios que coinciden salen en la sección Ruta para elegir con el dedo, y se traza la ruta en coche desde donde estás, con [openrouteservice](https://openrouteservice.org): la línea en el mapa, la
distancia, el tiempo, la hora de llegada y la lista de pasos en español. Su clave (gratis) la
pone cada familia en Ajustes → Familia → «Rutas (openrouteservice)», y no sale del servidor. Su plan
gratuito permite unas 2.000 rutas y 1.000 búsquedas al día.

Lo que no encuentra, desde Google Maps: con la app instalada (Chrome → «Instalar» o «Añadir a
pantalla de inicio»), en Google Maps el sitio → Compartir → Seilide abre el modo carretera con
la ruta a ese sitio (desde JellyCartoon, también: lo manda aquí). Su enlace corto se sigue en el servidor (solo hacia direcciones de Google); si
no trae coordenadas, como pasa al compartir desde la app de Google Maps, se busca su nombre y su
dirección. Lo que no es de un mapa, compartido igual, va a Recetas, en Seilide.

El tiempo que queda y la hora de llegada van siempre a la vista, junto a la siguiente maniobra, y
la voz los dice («¿cuánto falta?»). Se calculan tramo a tramo, con lo que openrouteservice calcula
para cada uno (la autovía va más rápida que el pueblo), y, pasados unos 5 km, al ritmo de cada uno:
lo que se tarda conduciendo (no parado) frente a lo que calculaba, entre un 15 % más rápido y un 40 %
más lento. No sabe del tráfico que viene; del que ya se pasó, sí.

Con la ruta puesta, guía según avanzas: arriba del mapa, en grande, la próxima maniobra con su
flecha y a cuántos metros; en la lista, el paso que toca, resaltado; y lo que queda y la hora de
llegada, al día. Al elegir el destino se ve la ruta entera unos segundos y luego el mapa vuelve a
seguirte. Si te sales más de 50 m durante unas posiciones, recalcula desde donde estés (como mucho
una vez cada 20 s, por la cuota). Al llegar, «Has llegado», con «Terminar» al lado.

Y lo dice en voz alta, con la voz del dispositivo y la música más baja mientras habla: cada
maniobra con antelación («En 300 metros, gira a la izquierda por Calle Real», unos 20 s antes según
la velocidad) y al llegar a ella, y «Has llegado a tu destino»; «sigue todo recto», no. Los textos
de openrouteservice se pasan a tú y a cómo suenan («toma la segunda salida», no «tome la 2a»).
«Voz: no» en la ruta lo calla, y se recuerda en ese navegador. Por voz, en el modo carretera:
«llévame a…» traza la ruta, «¿dónde estoy?» dice la dirección y «quita la ruta» la quita. Si
se pide vídeo, contesta que en el coche no se pone.

Viajes (#81): con «Guardar mis viajes» en Ajustes → Para mí (apagado si no se activa), el modo
carretera guarda por dónde vas mientras está abierto, también a media pantalla: un punto cada
~25 m (sin los de mala precisión ni los saltos del GPS), mandados cada 30 s; sin cobertura
esperan, y al cerrar se mandan los que quedan. Más de 10 minutos sin moverse empieza otro viaje.
En `/viajes`, solo los de cada uno: los km, viajes y horas al volante del mes y de los últimos 12,
cada viaje con su distancia, tiempo, velocidad media y máxima y destino (si había ruta), su
recorrido en el mapa, y borrar uno o todos.

Fotos (#81): 📷 junto al micrófono del modo carretera, o «haz una foto» por voz, hace una foto con
la cámara trasera de la tablet (se abre al pedirla y se cierra al hacerla), con su hora y su
posición, en el viaje que se esté guardando. Se ve unos segundos en una esquina, para saber si ha
salido bien, con «Guardando…» y luego «✓ Foto guardada». Se reduce a 1920 px y se sube al momento; sin
cobertura, espera y se sube al volver. El JPEG va al almacén de ficheros de la familia (el rustfs de
la pila) y sus datos a Postgres. Solo las ve quien las hizo: en `/viajes`, sobre el recorrido de
cada viaje y en una galería, donde se borran (el fichero también).

Compartir el viaje (#81): «Compartir viaje», en la sección Ruta del modo carretera, da un enlace para mandar (por
WhatsApp, a un grupo…): quien lo abre ve el coche en el mapa, en directo, con el destino y la
llegada si hay ruta, y cuánto hace de la última posición. Nunca se activa solo; la tablet lo dice
mientras dura, y se acaba al darle a «Dejar de compartir», al llegar o al cerrar el modo carretera
(y si la tablet calla 15 minutos). Después, el enlace dice «Este viaje ya no se comparte».

Seilide, que ya está en internet, guarda en memoria (sin escribirla) la última posición y se la
enseña a quien tiene el enlace (`/s/…`, sin cuenta). Cada enlace es un token aleatorio de un solo
viaje; la vista previa de WhatsApp solo dice de quién es, no dónde. El mapa del enlace es de
[OpenFreeMap](https://openfreemap.org), libre y sin clave. (En jellycartoon, que no se ve desde
fuera, hacía falta un repetidor aparte en un VPS, `relay/`; ya no.)
