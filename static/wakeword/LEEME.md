# Modelos de palabra de activación (#144)

Para detectar la palabra en el navegador con ONNX Runtime Web (`packages/comun/src/wakeword.ts`).

| Fichero | De dónde | Licencia |
| --- | --- | --- |
| `melspectrogram.onnx`, `embedding_model.onnx` | [openWakeWord v0.5.1](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1) (el extractor de características; el de *embeddings* es el `speech_embedding` de Google, Apache 2.0) | Apache 2.0 |
| `hola_casita.onnx` | [home-assistant-wakewords-collection](https://github.com/fwartner/home-assistant-wakewords-collection), `en/hola_casita` | MIT (la colección) |
| `alexa.onnx` | [openWakeWord v0.5.1](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1), `alexa_v0.1.onnx` (sha256 `6ff566a0…dbfae3e`), entrenado por openWakeWord | CC BY-NC-SA 4.0 (uso no comercial) |
| `hey_luna.onnx` | la misma colección, `en/Hey Luna` | MIT (la colección) |
| `jelly_cartoon.onnx` | entrenado para esta casa igual que `candy_candy`: «Jelly Cartoon» dicho a la inglesa y a la española («yeli cartún») | uso en casa |
| `jelly_cartoon_musica.onnx` | el mismo, entrenado con ~5 h de la música de casa de fondo y una capa de 128 (en vez de 32), para que la oiga con música sonando: a prueba en `/activacion` | uso en casa |
| `okapi.onnx`                                  | entrenado para esta casa (2026-11-02) como `jelly_cartoon_musica`, en `../wakeup` (`config/okapi.yaml`): «okapi», igual en inglés y en español, con voces de Piper en los dos, y la música y los dibujos de casa de fondo | uso en casa                        |
| `ocarina.onnx` | entrenado para esta casa (2026-11-03) en `../wakeup` (`config/ocarina_v2.yaml`): «ocarina», o-ca-RI-na, real en inglés y en español, con 100.000 ejemplos (voces de Piper en los dos, la música y los dibujos de casa de fondo); en `scripts/comparar.py`, 94 % sin música y 83 % con música suave (Okapi, 80 % y 62 %), sin falsas alarmas | uso en casa |
| `silero_vad.onnx` | [Silero VAD v6.2.3](https://github.com/snakers4/silero-vad/releases/tag/v6.2.3) (`src/silero_vad/data/silero_vad.onnx`): saber cuándo se ha terminado de hablar tras la palabra (`packages/comun/src/vad.ts`) | MIT |
| `candy_candy.onnx` | entrenado para esta casa con el cuaderno oficial de openWakeWord, con voces de Piper en inglés y en español («kandi kandi», como se dice en España) | uso en casa |

Los modelos de palabra los entrenó la comunidad con openWakeWord y voces sintéticas en inglés. Para
uso en casa; los modelos preentrenados del propio openWakeWord son de uso no comercial
(CC BY-NC-SA 4.0).
