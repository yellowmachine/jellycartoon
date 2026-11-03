---
title: 'Música'
---

Una carpeta de música ripeada de CD, en FLAC con sus etiquetas, que se escucha en el navegador.
Con `HOST_MUSIC_DIR="/ruta/a/la/musica"` en el `.env` se monta de solo lectura y aparece la
sección Música; en desarrollo se usa `MUSIC_DIR`.

- «Escanear carpeta» busca los FLAC de la carpeta y sus subcarpetas, y en segundo plano lee sus
  etiquetas. Solo se catalogan los que tienen etiqueta de álbum: las descargas de YouTube (que no
  la tienen, y cuyo nombre acaba con el id del vídeo, `[ix5Ntnavdgg]`) se dejan fuera solas.
- Cada carpeta es un álbum, y cada CD de un disco doble, uno aparte. El título sale de la etiqueta
  ALBUM; el artista, de ALBUMARTIST, o del artista de todas las pistas, o «Varios artistas».
- Las portadas se buscan en [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) (por el
  id del disco si el ripeador escribió `CDTOC`, como fre:ac; si no, por título y artista) y se
  descargan del [Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive/API) a
  `DATA_DIR/album-cover`. MusicBrainz admite una petición por segundo: la primera vez tarda.
- Si no la encuentra, casi siempre es por el nombre: «… CD1», «Lauper, Cyndi», «AC, DC». En el
  álbum, «Buscar carátula» le pide a la IA (con la clave de OpenRouter de Ajustes; sin ella, con
  el nombre tal cual) qué disco es, por su carpeta, su título, su artista y sus canciones, lo busca
  así en MusicBrainz y propone hasta 4 carátulas de las ediciones que la tienen. La elegida se
  guarda como las demás, una copia, con su id de MusicBrainz (`album.cover_source`), y también en
  los otros discos del mismo álbum sin portada («Sus 50 mejores canciones CD 1» y «CD 3»).
- El buscador ([MiniSearch](https://lucaong.github.io/minisearch/)) busca en el navegador, mientras
  escribes, en artistas, álbumes y canciones, sin importar tildes ni pequeñas erratas.
- Los FLAC se mandan tal cual: los navegadores actuales los reproducen. La barra de abajo sigue
  sonando al cambiar de página, y se controla también desde la pantalla de bloqueo del móvil y los
  botones de los auriculares ([Media Session](https://developer.mozilla.org/docs/Web/API/Media_Session_API)).
- Entre canción y canción hay un pequeño silencio (el navegador no hace «gapless»).
- «+ Añadir a la cola» en un álbum lo pone detrás de lo que suena, sin cortarlo. El botón de la
  cola (☰ con ▶︎) en la barra de abajo la abre: lo que suena, lo que viene y, en gris, lo que ya
  sonó; tocar una canción salta a ella y ✕ la quita. En el navegador, no en Snapcast todavía.
  Debajo, «Guardar la cola como lista nueva»: con un nombre, una lista con sus canciones tal como
  está la cola (también lo que ya sonó; sin las palabras del DJ). En la casa y en Seilide.
- Listas: en la pestaña «Listas» de Música se crean, renombran y borran listas de canciones,
  compartidas por toda la casa. El «+» de cada canción (en los álbumes y en el buscador) la añade a
  una lista, o a una nueva; una canción puede estar más de una vez. Dentro de la lista se ordena
  con ▲▼ y se quita con ✕, y suena aquí o en Snapcast como un álbum.
