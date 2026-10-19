# gastos-viaje

Página web personal para registrar gastos de viaje con foto del ticket y, al cerrar el
viaje, descargar un ZIP (fotos renombradas + resumen.txt). Mismo enfoque que el repo
`cuaderno-gimnasio`: estática, GitHub Pages, datos solo en el navegador.

## Decisiones

- **Sin servidor.** Nada de backend por ahora (quizá en el futuro). Todo funciona en
  local en el navegador: `localStorage` para viajes, IndexedDB para fotos.
- **Sin dependencias ni librerías.** JS a mano; el ZIP lo escribe `crearZip` (sin
  compresión: las fotos ya son JPEG).
- **Importes en céntimos (int).** Nunca floats guardados. Formato español al mostrar.
- **Grupos fijos:** Comida, Transporte, Otros. Categorías y su grupo en `CATEGORIAS`
  (`logica.js`); para añadir una, añadirla ahí.
- **Nombre de foto en el ZIP:** `fecha_concepto_importeEUR[_n].ext`. No cambiarlo sin
  actualizar `pruebas.mjs`.
- **Resumen:** por día separado en Comida / Transporte / Otros, total del viaje,
  pagado por persona (si hay compañeros) y detalle con el nombre de cada foto.
- Viaje cerrado = solo lectura; se puede reabrir.
- Lógica pura en `logica.js` (probable con node); DOM y almacenamiento en `app.js`.

## Convenciones

- Código, comentarios y textos en castellano.
- `node --test pruebas.mjs` debe pasar antes de cada commit.
- Al cambiar JS o CSS, subir el `?v=` en `index.html`.
