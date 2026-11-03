---
title: 'Más voces, para la voz de la casa'
---

La casa dice sus avisos por Snapcast con la «Voz de la casa», que se elige en Ajustes → Casa entre
las voces en español instaladas con Piper (se pueden escuchar antes). Para tener donde elegir, de
hombre y de mujer, se instalan más en el PC con Piper, en su misma carpeta de datos (unos 400 MB
estas):

```sh
~/piper/bin/python -m piper.download_voices --data-dir ~/piper/voices es_ES-sharvard-medium es_ES-carlfm-x_low es_ES-mls_9972-low es_ES-mls_10246-low es_AR-daniela-high es_MX-claude-high
```

Piper las ve sin reiniciarlo. `es_ES-sharvard-medium` trae dos hablantes, uno de hombre (`M`) y otro
de mujer (`F`), y en Ajustes salen por separado. Todas las voces están en
[piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/es). El DJ no cambia: sigue con
`PIPER_VOICE_ES`.

Debajo de la voz, «Expresividad» (de 50 a 150 %) cambia cuánto varían la entonación y el ritmo de
Piper (sus `noise_scale` y `noise_w_scale`; 100 % es como lo hace él, y muy alta puede sonar rara),
y «Velocidad» (de 70 a 130 %) lo rápido que lee (`length_scale`); por defecto, 120 % y 95 %, algo
más viva y pausada que la suya. «Volumen de la voz» la sube hasta
12 dB (con un limitador, sin que distorsione),
y «Música mientras habla» dice cuánto baja la música de Snapcast mientras suena (de −6 a −30 dB;
−12 por defecto, como en el móvil). Valen para todo lo que dice la casa por Snapcast. El móvil y
la tablet usan la voz del propio aparato. «Dicho con: Voz IA» hace que lo diga Kore (Gemini, por
OpenRouter), más viva que Piper: cada aviso tarda unos 2–3 s más (medido) y cuesta algo; si Gemini
falla o tarda más de 10 s, lo dice Piper. En el Registro queda lo que tardó cada uno («Voz IA: …
ms»).

Los temporizadores de la casa (#241) los lleva el servidor, y se ven y se paran en la Agenda, en
«Alarmas y temporizadores». Al cumplirse suenan en toda la casa por Snapcast: dos «din-don» y su
nombre dicho, y cinco segundos de silencio, hasta que alguien lo para («Parar» en la Agenda); si
nadie lo para, se calla a los tres minutos. Las alarmas son de Seilide, que avisa a la casa cuando
tienen que sonar aquí. Los satélites de voz son de Seilide (#329): los suyos suenan en ellos.
