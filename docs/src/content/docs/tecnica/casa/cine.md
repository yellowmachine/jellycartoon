---
title: 'Cine'
---

Una carpeta aparte de películas (mkv grandes) que solo se catalogan: nunca se convierten ni se
borran. Con `HOST_CINEMA_DIR="/ruta/a/las/peliculas"` en el `.env` se monta de solo lectura y
aparece la sección Cine; sin ella, no. En desarrollo se usa `CINEMA_DIR` con la ruta.

- «Escanear carpeta» busca vídeos en la carpeta y sus subcarpetas. Una subcarpeta con un único
  vídeo se cataloga con el nombre de la carpeta. Las copias de disco (`BDMV`, `VIDEO_TS`) se
  saltan y se avisa en el Registro.
- El título sale del nombre del fichero, quitando lo que añade MakeMKV (`_t00`, ` T01`,
  `Disc 1`); un año entre paréntesis al final, `Título (1964)`, se guarda aparte. Se puede editar.
- En segundo plano, de una en una, se saca la duración, las pistas de audio y subtítulos y una
  miniatura (con tone mapping si la película es HDR).

## Ficha de cada película

Al pulsar una película se abre su ficha. La primera vez se busca en
[Wikidata](https://www.wikidata.org) (director, reparto, año, género, país, enlace a IMDb) y
Wikipedia en español o, si no hay artículo, en inglés (sinopsis); queda guardada en la base de
datos. Las dos son gratuitas y sin clave.

- No hace falta abrirlas: después de cada escaneo se buscan en segundo plano, de una en una, las
  fichas de las películas catalogadas que no la tengan, nuevas o no. Las que queden por confirmar llevan «Elegir ficha» en la
  cuadrícula.
- El buscador de Cine busca por título (también el original), director y actor. En la ficha, cada
  persona, género y país lleva a Cine filtrado por ella.
- Para acertar se usa el título, el año del nombre del fichero y la duración. Si no está claro
  pregunta «¿Cuál de estas es?», y siempre se puede buscar a mano por otro título.
- Con una clave de OpenRouter (en Ajustes, o `OPENROUTER_API_KEY` en el `.env`), una IA identifica primero la película a partir del
  nombre del fichero (erratas, títulos españoles, restos de MakeMKV): da el título original, el año
  y el director, y con eso se busca en Wikidata. Los datos de la ficha nunca los inventa la IA;
  solo escribe la sinopsis si no hay artículo en Wikipedia, y lo indica.
- Cada petición a la IA (identificar, sinopsis, escenas, títulos de episodios, conversaciones)
  deja una línea en el Registro con la fuente `ia`: para qué era, los tokens y lo que costó según
  OpenRouter.
- Si OpenRouter dice que se acabó el crédito, la app deja de pedirle nada (falla al momento, sin
  salir a internet, también tras reiniciar) y a quien la administra le sale un banner arriba para
  recargarlo, con «Ya he recargado», que vuelve a dejar pasar las peticiones. Poner otra clave en
  Ajustes también. La voz contesta que se acabó el crédito, con Piper.

## Escenas

Casi todas las películas copiadas de un disco traen sus capítulos, puestos por el estudio en los
cambios de escena. Se leen al catalogar (las ya catalogadas, después del siguiente escaneo o
arranque) y la ficha los muestra como «Escenas»: un fotograma de cada una y «Ver desde aquí en el
salón», que empieza justo al principio de la escena.

Los discos los llaman «Chapter 01, 02…». Con la clave de OpenRouter, «Ponerles nombre con la IA»
manda un fotograma de cada escena y los artículos de Wikipedia al modelo de escenas y títulos (en Ajustes), que
les pone un nombre corto («Pongo y Perdita se conocen en el parque»). Tarda un minuto o dos, se
hace una vez por película y cuesta unos céntimos. Como cuentan el argumento, los nombres solo se
ven sin pedirlo si ya has visto la película.

## Vista de pájaro

En la ficha, «Ver» muestra la película de un vistazo en 10, 20 o 30 fotogramas (a elegir en el
desplegable) repartidos de principio a fin, saltando logos y créditos. Cada uno cae en un momento al
azar de su tramo de la película, pero el azar sale del id de la película, así que siempre se ven los
mismos. Se sacan del fichero al pedirlos, de tres en tres, y no
se guardan en el servidor (el navegador los recuerda un día). Al pulsar uno se ve en grande, se pasa
al anterior o al siguiente, y «Ver desde aquí en el salón» la empieza en ese momento.

## Preguntarle a la IA

Con la clave de OpenRouter, al final de cada ficha hay una conversación: «¿cómo se hizo?»,
«háblame de su estilo visual»… Desde el móvil se puede dictar con el micrófono del teclado.

- Cada pregunta lleva la ficha y los artículos completos de Wikipedia en español e inglés, y la IA
  se basa en ellos; si añade algo que no viene de ahí, lo dice. Sabe si ya la has visto (o por
  dónde vas) para no desvelarte el final.
- Las respuestas van apareciendo mientras se escriben y la conversación queda guardada por usuario
  y película. «Parar» corta la respuesta y guarda lo que llevaba; cerrar la página no la corta.
- En Ajustes se elige un modelo aparte para conversar (por defecto uno mejor que el de identificar:
  unos céntimos por pregunta) y si puede [buscar en la web](https://openrouter.ai/docs/guides/features/plugins/web-search),
  que añade enlaces a las fuentes y cuesta algo más.

## Ver en el salón

Las películas y los capítulos se ven con mpv en la pantalla del PC donde corre la app. Allí queda un mpv
esperando, sin ventana, como servicio de usuario de systemd; la app le manda la película por su
socket ([JSON IPC](https://mpv.io/manual/stable/#json-ipc)) y guarda por dónde vas cada 5
segundos. Hace falta una sesión gráfica iniciada (Wayland o X11) y mpv instalado. Se instala
desde este PC por SSH, con lo del mando (abajo, «Mando del salón»), usando las casas de
`scripts/casas.sh`:

```sh
scripts/pantalla.sh salon          # o padres=miguel@pc-padres, una que no está en la lista
```

Solo cambia lo que es distinto en el repositorio y enseña en qué. La ruta de `HOST_DATA_DIR` la
saca del contenedor de la app. Reinicia mpv solo si no hay nada puesto; si se está viendo algo,
lo avisa y no lo toca. Lo mismo a mano, en el PC de la pantalla, desde el repositorio y con la
ruta de `HOST_DATA_DIR`:

```sh
mkdir -p ~/.config/systemd/user
sed 's|@SOCKET@|/ruta/a/los/convertidos/mpv.sock|' deploy/jellycartoon-mpv.service \
  > ~/.config/systemd/user/jellycartoon-mpv.service
systemctl --user daemon-reload
systemctl --user enable --now jellycartoon-mpv
```

- El socket va en `HOST_DATA_DIR`, que ya está montado en el contenedor (`/data/mpv.sock`) y es
  del mismo usuario (`PUID`), así que no hace falta montar nada más.
- En el menú ⋯ de cada película: «Ver en el salón», o «Continuar desde…» y «Empezar desde el
  principio» si ya la empezaste. Se usan tus idiomas de audio y subtítulos. Al pasar del 92 % o
  llegar al final queda como vista.
- Con el ratón o el teclado se controla mpv como siempre; `q` lo cierra y el servicio lo deja
  esperando otra vez. Esc para, como «Parar» en el mando, en lugar de salir de pantalla completa:
  en un mando a distancia es «atrás».
- Capítulos: «Ver en el salón» en el menú ⋯ de cada capítulo convertido manda ese y, con
  «siguiente automático», los siguientes de la serie. En Hoy y en las listas, «Ver lo que queda
  en el salón» manda los que faltan por ver, y ▶︎ en cada uno empieza desde él. Van todos a la
  lista de reproducción de mpv, que pasa solo al siguiente; cada uno empieza por donde se dejó y
  al verlo se tacha en Hoy y en tus listas. Hace falta que `HOST_DATA_DIR` sea una ruta absoluta.
  Sin carpeta de películas, el salón se activa con `MPV_SOCKET=/data/mpv.sock` en el `.env`.
- Mando a distancia: la página Salón (pensada para el móvil) pausa, salta, cambia el volumen y
  las pistas de audio y subtítulos, pasa al capítulo anterior o siguiente, y para (cierra la ventana de mpv). Lo que hace mpv llega en directo con Server-Sent
  Events, también si se toca con el ratón. En todas las páginas hay una barra con lo que se está viendo.
- Cortinilla de Cine Club: con un vídeo en `HOST_DATA_DIR/cortinilla.mp4`, las películas que
  empiezan desde el principio van precedidas de él (no al continuar ni al saltar a una escena).
  Cada uno la quita en Ajustes, y el mando tiene «Saltar a la película». No se sube al repo:
  `data/` está en `.gitignore`.
- Si no se ve nada: `systemctl --user status jellycartoon-mpv` y el Registro de la app.
