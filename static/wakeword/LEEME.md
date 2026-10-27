# Modelos de palabra de activación (#144)

Para detectar la palabra en el navegador con ONNX Runtime Web (`src/lib/wakeword.ts`).

| Fichero | De dónde | Licencia |
| --- | --- | --- |
| `melspectrogram.onnx`, `embedding_model.onnx` | [openWakeWord v0.5.1](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1) (el extractor de características; el de *embeddings* es el `speech_embedding` de Google, Apache 2.0) | Apache 2.0 |
| `hola_casita.onnx` | [home-assistant-wakewords-collection](https://github.com/fwartner/home-assistant-wakewords-collection), `en/hola_casita` | MIT (la colección) |
| `alexa.onnx` | [openWakeWord v0.5.1](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1), `alexa_v0.1.onnx` (sha256 `6ff566a0…dbfae3e`), entrenado por openWakeWord | CC BY-NC-SA 4.0 (uso no comercial) |
| `hey_luna.onnx` | la misma colección, `en/Hey Luna` | MIT (la colección) |
| `jelly_cartoon.onnx` | entrenado para esta casa igual que `candy_candy`: «Jelly Cartoon» dicho a la inglesa y a la española («yeli cartún») | uso en casa |
| `jelly_cartoon_musica.onnx` | el mismo, entrenado con ~5 h de la música de casa de fondo y una capa de 128 (en vez de 32), para que la oiga con música sonando: a prueba en `/activacion` | uso en casa |
| `silero_vad.onnx` | [Silero VAD v6.2.3](https://github.com/snakers4/silero-vad/releases/tag/v6.2.3) (`src/silero_vad/data/silero_vad.onnx`): saber cuándo se ha terminado de hablar tras la palabra (`src/lib/vad.ts`) | MIT |
| `candy_candy.onnx` | entrenado para esta casa con el cuaderno oficial de openWakeWord, con voces de Piper en inglés y en español («kandi kandi», como se dice en España) | uso en casa |

Los modelos de palabra los entrenó la comunidad con openWakeWord y voces sintéticas en inglés. Para
uso en casa; los modelos preentrenados del propio openWakeWord son de uso no comercial
(CC BY-NC-SA 4.0).
