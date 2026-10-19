# Gastos de viaje

Página web para apuntar los gastos de un viaje desde el móvil. Sin servidor ni cuentas:
todo se guarda en el navegador del móvil donde se usa. Al cerrar el viaje se descarga
un ZIP con las fotos de los tickets renombradas y un resumen.

## Uso

1. Abre la página (GitHub Pages) y, si quieres, *Añadir a pantalla de inicio*.
2. **Empezar viaje**: nombre, destino, fechas, tu nombre y compañeros (opcional).
3. Por cada gasto: importe, motivo, fecha, comentario y foto del ticket (cámara o galería).
   Con compañeros, también quién pagó y con quién.
4. **Cerrar viaje y descargar ZIP**. Se puede volver a descargar o reabrir el viaje.
5. Cuando tengas el ZIP guardado fuera del móvil, *Borrar viaje y fotos* libera espacio.

Motivos y su grupo en el resumen:

| Grupo | Motivos |
|---|---|
| Comida | desayuno, comida, cena |
| Transporte | taxi, metro/bus, tren, avión, coche/gasolina, parking/peaje |
| Otros | alojamiento, otros |

## El ZIP

```
2026-10-14_feria-milan/
  resumen.txt                         por día: Comida / Transporte / Otros y total;
                                      total del viaje, quién pagó y detalle de cada gasto
  fotos/
    2026-10-14_taxi_22,30EUR.jpg      fecha_concepto_importe
    2026-10-15_cena_45,00EUR.jpg
    2026-10-15_cena_45,00EUR_2.jpg    segunda foto del mismo ticket
```

El ZIP se genera en el propio móvil (`crearZip` en `logica.js`, sin librerías).

## Estructura

```
index.html            carga estilos y scripts
app.js                pantallas, almacenamiento (localStorage + IndexedDB) y descarga
logica.js             lógica pura: importes, totales, nombres de foto, resumen, ZIP
estilos.css           misma línea visual que cuaderno-gimnasio
manifest.webmanifest  para instalarla como app
iconos/
pruebas.mjs           node --test pruebas.mjs
```

## Datos

- Viajes y gastos en `localStorage` (clave `gastos-viaje`). Importes en céntimos.
- Fotos en IndexedDB (`gastos-viaje-fotos`), reducidas a 1600 px en JPEG (~200–300 KB).
- Están **solo en ese navegador**: borrar los datos del navegador las borra.
  Por eso el ZIP al cerrar es la copia que vale.

Al cambiar `app.js`, `logica.js` o `estilos.css`, sube el `?v=` en `index.html` para que el
móvil no use la versión en caché.

## Estadísticas

Contador de uso con [GoatCounter](https://www.goatcounter.com), sin cookies.
Panel: https://jon-apps.goatcounter.com (la app sale en la ruta `/gastos-viaje/`).

- **Visitas**: aperturas de la página, de dónde llegan, país, navegador, sistema y pantalla.
- **Eventos**: `abierta-instalada` / `abierta-navegador`, `viaje-creado`, `gasto-anadido`,
  `gasto-editado`, `foto-camara` / `foto-galeria`, `viaje-cerrado`, `zip-descargado`,
  `zip-compartido`, `viaje-reabierto`, `viaje-borrado`.
- **Nunca se envía**: nombres de viaje o personas, importes, comentarios, fechas ni fotos.
  Solo el nombre fijo del evento.
- Si el script no carga (bloqueador, sin conexión), la app funciona igual.
- **Excluir tus visitas**: abre una vez la web con `#toggle-goatcounter` al final de la URL
  (https://jonmg.github.io/gastos-viaje/#toggle-goatcounter), en cada dispositivo.

## Publicar

GitHub Pages: Settings → Pages → *Deploy from a branch* → `main`, `/ (root)`.
También funciona abriéndola con cualquier servidor estático local
(`python3 -m http.server`).
