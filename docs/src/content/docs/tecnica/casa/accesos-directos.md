---
title: 'Accesos directos de la tele'
---

Webs de fuera en la Vista TV (#327): NBA League Pass, Crunchyroll… Se añaden en Ajustes → Casa →
«Accesos directos de la tele», con nombre, dirección y etiquetas, y salen como recuadros bajo las
secciones. Cada una se abre en **su propia ventana**, a pantalla completa, y el **botón de
encendido del mando** va de ella a la Vista TV y vuelve (abajo). En la misma ventana de la Vista TV
no servía: las webs redirigen al entrar, y Atrás caía en una página intermedia que volvía a mandar
hacia delante. Las teclas del mando funcionan dentro, como en cualquier web, con la navegación
espacial de Chromium. La sesión de cada web se inicia una vez a mano (teclado y ratón) en el
Chromium de la tele y se queda en sus cookies; el vídeo protegido va con su Widevine. El icono de
cada recuadro sale de la propia web al guardarlo: el que declara para la pantalla de inicio de los
móviles (su manifiesto o `apple-touch-icon`, de 96 px o más; el favicon se vería borroso), solo PNG,
JPEG o WebP, guardado en `DATA_DIR/accesos`. Si la web no deja leerlo desde el servidor, el recuadro
sale con su nombre, y en Ajustes está «Volver a buscar el icono».

Con la etiqueta «infantil» los ven también los peques, y el tiempo que la ventana está abierta y
delante cuenta en su límite del día, como un canal en directo: no se abre fuera de su horario o sin
tiempo, y al acabarse la Vista TV cierra la ventana y dice por qué. En /infantil sale en «Ahora» y
en «Estos días». Mientras está abierta, la Vista TV tiene «Cerrar …» para quitarla del todo.
