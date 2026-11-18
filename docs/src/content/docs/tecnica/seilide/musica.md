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
- **Escuchar**: cada pista entra en el reproductor con `src` = `/api/music/own/tracks/<id>`, que mira
  la familia y contesta un 302 a una URL prefirmada de 6 horas (con su `Content-Type`, por si el
  bucket dice `application/octet-stream`). El audio va del bucket al navegador; la dirección de la
  cola no caduca. Las portadas, igual en `/api/music/own/covers/<id>` (o desde el almacenamiento si
  es la incrustada). `MusicTrack.cover` y `MusicTrack.home` dan su portada y su álbum al reproductor.
- **Fuera por ahora**: listas, Modo DJ, sin conexión (#350, que ya salta las pistas con `src`),
  modo carretera, voz, Snapcast y transcodificar. La cola guardada tampoco las lleva (se salta lo que
  tiene `src`).
