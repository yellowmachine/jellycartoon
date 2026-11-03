---
title: 'Radio'
---

Emisoras en directo de Reino Unido, Estados Unidos, Francia, Italia y España, para escuchar y
para acostumbrar el oído a otros idiomas. La lista está elegida a mano en `src/lib/radio.ts`
(primero las habladas de cada idioma) y no hace falta configurar nada.

- Cada emisora se guarda por su id en [Radio Browser](https://www.radio-browser.info), una base
  de datos comunitaria con [API pública](https://api.radio-browser.info). Al pulsar una se pide
  allí su stream actual: si la emisora lo cambia, sigue funcionando en cuanto la comunidad lo
  actualiza. El servidor de Radio Browser se elige por su registro DNS SRV, como pide.
- Suena en la misma barra que la música. Los streams MP3/AAC van tal cual; los HLS (BBC, Radio
  France, RTVE), con hls.js. Al reanudar tras una pausa se vuelve al directo.
- Con Snapcast, la página Radio tiene también «Sonar en: Este dispositivo / Snapcast»: el mpv de
  la música abre el stream (por eso `mpv-music` tiene red) y la barra de Snapcast muestra lo que la
  emisora dice que suena, si lo dice (su título ICY; WNYC, por ejemplo, sí; muchas, no).
- Se usa el enlace propio de cada emisora, que puede redirigir con un token nuevo cada vez (como el
  de RTVE); el ya resuelto, solo si el enlace es un fichero de lista (`.pls`, `.m3u`).
- Para añadir una emisora: buscar su `stationuuid` en radio-browser.info y añadirla a la lista.
