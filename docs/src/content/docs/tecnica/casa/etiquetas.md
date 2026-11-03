---
title: 'Etiquetas de los capítulos'
---

Un modelo de visión en [Ollama](https://ollama.com) mira un fotograma cada `LABEL_EVERY_SEC`
segundos (15 por defecto) del capítulo convertido y dice cuáles de las etiquetas de un **conjunto**
se ven en él. Los conjuntos (con nombre: «Animales», «Lugares»…) se hacen en Ajustes → Casa. Se pide
en una serie: «Seleccionar capítulos», elegirlos y «Etiquetar con» un conjunto. Van a una cola, de
uno en uno y en segundo plano, que se sigue en Gestión → Etiquetado: lo que se está haciendo, lo que
espera, lo fallido (para reintentarlo) y lo último hecho, con lo que vio. Luego la serie se filtra
por etiqueta, y en cada capítulo salen las suyas (al pasar por encima, el conjunto y en cuántos
fotogramas). Etiquetar otra vez con un conjunto sustituye solo lo de ese conjunto; borrar un
conjunto quita lo que vio con él. Estas etiquetas son aparte de las de la serie (las que se ponen a
mano, como «infantil»), y las cuentas infantiles no las ven.

En el `.env`, con Ollama en el mismo PC que la app en Docker. Ni `localhost` ni `127.0.0.1`:
dentro del contenedor son el propio contenedor. `host.docker.internal` es el PC (está en
`extra_hosts` de `compose.prod.yaml`), aunque cambie su IP:

```sh
OLLAMA_URL="http://host.docker.internal:11434"
LABEL_MODEL="qwen2.5vl:7b"   # el de por defecto; antes: ollama pull qwen2.5vl:7b
```

Ollama, por defecto, solo escucha en `127.0.0.1`, y el contenedor no llega. Con el servicio de
systemd de su instalador:

```sh
sudo systemctl edit ollama
```

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

```sh
sudo systemctl restart ollama
```

Ollama no tiene contraseña: así lo puede usar cualquiera de la red de casa. Si importa, en el cortafuegos se cierra el puerto 11434 menos para las redes de
Docker (`172.16.0.0/12`). Con ufw, que por defecto lo cierra todo, eso es abrirlo solo para ellas:
`sudo ufw allow from 172.16.0.0/12 to any port 11434 proto tcp`.

La respuesta usa las [salidas estructuradas](https://docs.ollama.com/capabilities/structured-outputs)
de Ollama: para cada etiqueta, un sí o un no. Pidiéndole en cambio cuáles de la lista se veían,
`qwen2.5vl:3b` elegía alguna aunque no estuviera (un perro en 4 fotogramas de 5 sin perros).

El de por defecto es `qwen2.5vl:7b` (unos 6 GB; cabe entero en una gráfica de 8 GB como la RX 7600 del
salón): unos 1,3 s por fotograma, un capítulo de 22 minutos en unos 2 minutos. El de 3B va el doble de
rápido, pero con algunas imágenes entra en bucle (un bosque de noche en Scooby-Doo) y Ollama lo corta.
Si el modelo no puede con un fotograma, se reintenta una vez cargándolo de nuevo y, si sigue sin
poder, ese fotograma queda fuera (un aviso en el Registro); el capítulo solo falla si quedan fuera
más de la cuarta parte.
