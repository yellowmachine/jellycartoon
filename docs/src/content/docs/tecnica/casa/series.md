---
title: 'Ficha de cada serie'
---

La primera vez que se abre una serie se busca en [Wikidata](https://www.wikidata.org) (años,
temporadas, número de episodios) y Wikipedia (resumen), como las películas: si no está claro
pregunta «¿Cuál de estas series es?», y siempre se puede buscar a mano por otro título. Con la clave
de OpenRouter, la IA identifica antes la serie a partir de la carpeta y de algunos nombres de
fichero. La ficha guarda también dónde están listados sus episodios: el anexo de episodios de
Wikipedia en español y en inglés si lo hay, o si no el artículo de la serie.

Con la ficha y la clave, «Poner títulos y numeración con la IA» manda al modelo de escenas y títulos esas páginas de episodios y los ficheros en el orden de sus nombres, en lotes de 25:
cada uno con su ruta, su duración y tres fotogramas (a los 8 y 20 segundos, donde los dibujos
clásicos enseñan el cartel con el título, y la miniatura). Sirve sobre todo para las copias de disco
(`Disc 2_t06.mkv`) y lo bajado de YouTube sin número. La IA propone para cada fichero temporada,
número y título, o dice que no es un episodio (openings, extras, otra cosa). Nada cambia hasta que
lo revisas: se aplica lo que marques, y el resto se descarta.

- «Parar» corta la tanda, también la petición en curso; lo que ya propusieron los lotes terminados
  queda para revisarlo.
- Si se añaden capítulos después (otra temporada), solo se le mandan los que no tienen título de
  la IA; los demás van como texto, para que siga la numeración. «Rehacer todos» los manda todos.
- El título de la IA va aparte: el que pongas a mano sigue mandando, y si lo borras vuelve el de la
  IA.
- La temporada y el número aplicados ya no los cambia el escaneo, como al organizar temporadas. Lo
  que no es un episodio va al final de la temporada 0.
- La lista de episodios va entera en cada lote: cada uno son unos céntimos y menos de un minuto, y
  una serie de cientos de episodios (Shin Chan) puede costar un par de euros.
- Un fichero con varios episodios seguidos se queda en uno, con los títulos unidos por « / ».
