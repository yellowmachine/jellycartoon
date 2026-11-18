---
title: 'Música'
---

La de casa (#253), con las mismas pantallas que jellycartoon: Álbumes (por álbum o por artista, con
su buscador), cada álbum, cada artista y Listas. Todo se pide a casa por el túnel: el catálogo, las
listas (que se cambian aquí como allí, en nombre de quien lo hace) y el Modo DJ, cuyo locutor
escribe y lee la casa con su clave y su Piper, y cuyas configuraciones guardadas son las de cada uno
allí. Las canciones, las portadas y lo que dice el locutor, directos de casa con un pase firmado
(`/api/v1/musica/<pase>/…`); por eso las páginas de Música se dibujan solo en el navegador: el pase
de cada uno no va en un HTML del servidor. Suena solo en el aparato; los altavoces de casa, por voz
(Hablar). El catálogo (escanear, portadas, títulos) se lleva en casa, en Gestión.

## Tu música (#534)

La música del propio bucket de la familia (S3, R2, Backblaze…), en su pestaña, con o sin casa. El
bucket se guarda sellado con la clave de la familia (`music_source.bucket`, `family-secret.ts`),
como el almacenamiento de ficheros (#480); puede ser el mismo con otra carpeta. Al guardarlo se
comprueba que se puede listar y leer, y si las claves pueden escribir (se prueba a escribir un
fichero vacío y se borra), para avisar de que bastan unas de solo lectura.

- **Índice** (`own-music.ts`, `own-music-read.ts`, `own-music-index.ts`): se listan las claves de la
  carpeta y de cada audio nuevo o cambiado (ETag y tamaño) se leen las etiquetas con
  `music-metadata` sobre `@tokenizer/range`: solo los rangos que pide, unas tres peticiones por
  fichero. La duración, de las cabeceras; la de un Ogg/Opus, de su última página. Sin etiquetas, el
  título sale del nombre («07 - Canción.mp3») y el disco de la carpeta. Los álbumes son
  (título, artista del álbum) en `own_album`; las pistas, en `own_track`, con RLS por familia. La
  portada, la imagen de la carpeta (`cover`, `folder`, `front`…, o la única que haya) por su clave,
  o la incrustada, guardada en el almacenamiento de la familia (área `musica`). Se lanza al guardar,
  con «Volver a buscar» y a medianoche (el reloj, sin esperarlo); una a la vez por familia
  (`scanning_since`, que caduca a los 30 minutos sin avanzar).
- **Portadas de MusicBrainz**: tras leer, los discos sin imagen en la carpeta ni dentro de sus
  canciones se buscan en MusicBrainz por título y artista (`musicbrainz.ts`, las mismas reglas de
  títulos que la casa, `comun/album-titles.ts`) y se baja su portada del Cover Art Archive, o la de
  otra edición; se guarda en el almacenamiento de la familia. Una cola para todo Seilide, una
  petición por segundo. Sin artista («Desconocido») no se busca: un título solo encuentra cualquier
  disco. El no encontrado queda en `no` y no se busca otra vez hasta «Buscar portadas otra vez».
- **Gestión** (`/musica/tu-musica/gestion`, quien administra): la fase (`leyendo`, `portadas`) con
  su progreso, las portadas por origen, los discos sin portada y los ficheros que fallaron
  (`music_source.failures`, los cien primeros).
- **Cambiar el nombre** de un disco (los mayores, en su página): `custom_title` y `custom_artist`
  en `own_album`, aparte de `title` y `artist`, que son los de las etiquetas y por los que se
  agrupan las pistas al leer; así una nueva lectura no lo deshace. Igual que las etiquetas, vuelve a
  null. Si su portada era de MusicBrainz o no se encontró, se borra y se busca otra vez con el nombre
  nuevo. Las portadas de MusicBrainz llevan la hora en su nombre, y la dirección de la portada su
  versión (`?v=`), para que el navegador no siga mostrando la vieja.
- **La pantalla**, la misma que Álbumes: `MusicLibrary.svelte` (buscador de artistas, álbumes y
  canciones con MiniSearch, vista por álbumes o artistas, mosaico de artistas), con su página de
  artista (`/musica/tu-musica/artista/<nombre>`). `MusicAlbum.cover`/`href` y
  `AlbumCover`/`AlbumGrid`/`TrackRows` aceptan su portada y su página.
- **Listas** (fase 2): `own_playlist` y `own_playlist_item` (posición; la pista borrada del bucket
  sale de sus listas por la clave ajena), de toda la familia, en `own-music-lists.ts`. Salen en la
  pestaña Listas, en «De Tu música»; sin casa, solo ellas. El «+» (`AddToPlaylist` con `endpoint`)
  añade por `/api/music/own/playlists`; su página (`/musica/tu-musica/listas/<id>`) reproduce,
  sube, baja, quita, renombra y borra. Una lista lleva solo canciones de una fuente.
- **Modo DJ** con una lista de Tu música: «🎙 Con DJ» en su página abre `DjDialog` sin biblioteca
  ni configuraciones guardadas (`library={false}`), con `playlist.own`; `dj.svelte.ts` pide entonces
  a `/api/music/own/dj` (`random`, `clip`) en vez de a la casa, y nunca a Snapcast. Seilide es el DJ
  (`own-music-dj.ts`): las canciones de la lista (`playlistBatch`, sin ALAC ni WMA), y la locución
  escrita con la clave y el modelo de voz de la familia y leída por Gemini TTS (las voces del DJ de
  la casa), a Ogg Opus con ffmpeg, guardada 12 h en el disco del contenedor y servida solo a su
  familia (`/api/music/own/dj/clips/<id>`). Sin clave, sin botón; si falla, esa vez sin locutor.
- **Escuchar**: cada pista entra en el reproductor con `src` = `/api/music/own/tracks/<id>`, que mira
  la familia y contesta un 302 a una URL prefirmada de 6 horas (con su `Content-Type`, por si el
  bucket dice `application/octet-stream`). El audio va del bucket al navegador; la dirección de la
  cola no caduca. Las portadas, igual en `/api/music/own/covers/<id>` (o desde el almacenamiento si
  es la incrustada). `MusicTrack.cover` y `MusicTrack.home` dan su portada y su álbum al reproductor.
- **Fuera por ahora**: sin conexión (#350, que ya salta las pistas con `src`),
  modo carretera, voz, Snapcast y transcodificar. La cola guardada tampoco las lleva (se salta lo que
  tiene `src`).
