---
title: 'Modo carretera y Viajes'
---

Están en Seilide (#253): [su documentación](/tecnica/seilide/carretera/) cuenta cómo funcionan. Casa le da la música,
el Whisper de la voz, sus manos (Snapcast, temporizadores, el tiempo) y el Telegram de cada uno, por
el túnel; `/carretera` y `/viajes` de casa llevan a los de Seilide, y compartir un sitio desde
Google Maps a JellyCartoon también.

## Bot de Telegram de la casa

Distinto del Telegram del modo carretera (la cuenta de cada uno): un **bot** de la casa (#243), con
[grammY](https://grammy.dev), que avisa en el grupo de Telegram de la familia diciendo quién hizo
qué. Se crea con @BotFather (`/newbot`) y su token se pone en Ajustes → Casa → Bot de Telegram
(cifrado); al añadirlo al grupo, la app lo detecta (si ya estaba, `/start` en el grupo) y se elige
ahí. Avisa, cada cosa activable: de lo que se apunta en la Agenda y de sus avisos, y de las
alarmas y temporizadores de la casa al sonar (los de una persona, no). La lista de la compra y la
nevera viven en Seilide (#253), que aún no avisa por Telegram. Pregunta a Telegram por lo nuevo él mismo (long polling):
no hay que abrir nada hacia fuera. Un token solo puede usarlo una instalación a la vez.

Por voz: «di en el grupo que ya está la comida» lo dice el bot en el grupo, diciendo de quién o
de dónde viene («📣 Desde el salón: …»), también desde los satélites. Y desde el móvil o la tablet
(no desde un satélite, que no sabe quién habla), con la cuenta propia conectada: «dile a Ana que
llego en diez minutos», «contesta a Ana que voy de camino» buscan el chat por cómo suena y
preguntan antes «¿Le mando a Ana: …?»; solo se envía con un «sí», en otra orden, que exige el
servidor, no la IA. Si Ana escribió hace poco, va como respuesta a su último mensaje.
