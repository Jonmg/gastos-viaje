# gastos-viaje

App personal para registrar gastos de viaje con foto del ticket y exportar
un ZIP (fotos renombradas + resumen) al cerrar el viaje.

## Decisiones

- **Sin base de datos.** Un viaje = `datos/<slug>/viaje.json` + `fotos/`.
- **Importes en céntimos (int).** Nunca floats en el JSON. Formato español al mostrar.
- **Una sola dependencia: flask.** Sin frameworks de frontend; plantillas en
  `PLANTILLAS` dentro de `app.py`. Pensado para correr en una Raspberry Pi.
- **Grupos del resumen fijos:** Comida, Transporte, Otros. Las categorías y su
  grupo están en `CATEGORIAS`; para añadir una, añadirla ahí.
- **Nombre de foto exportada:** `NN_fecha_categoria_importeEUR[_k].ext`, con NN
  = fila del CSV (gastos ordenados por fecha y creación). No cambiarlo sin
  actualizar `pruebas.py`.
- Viaje cerrado = solo lectura; la descarga solo está disponible si está cerrado.

## Convenciones

- Código, comentarios y textos en castellano.
- `python3 pruebas.py` debe pasar antes de cada commit.
- Sin autenticación: solo red local.
