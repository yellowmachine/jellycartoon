---
title: 'Privacidad de Gastos'
---

Lo que sale hacia la IA de OpenRouter (con la clave de la familia, Ajustes → IA), y lo que no:

- **Tickets**: la foto del ticket va al modelo de visión. Sin clave no se leen.
- **Facturas (luz, agua, gas)**: de un PDF se manda **su texto**, no el PDF. Antes se quitan el DNI o
  NIE, el IBAN, el CUPS, los números de contrato y los teléfonos. **El nombre del titular y la
  dirección sí van en el texto**: no tienen una forma fija por la que reconocerlos, y a la IA solo se
  le pide que no los devuelva (no se guardan). Una factura escaneada o en foto va como imagen, entera.
- **Lo que se guarda**: la foto del ticket o el PDF de la factura, en el rustfs de Seilide (sin
  puertos publicados), bajo la carpeta de la familia, y lo leído en la base de datos. Los ficheros
  solo los da la app, a las personas de esa familia.
