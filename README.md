# Gastos de viaje

Página web para apuntar los gastos de un viaje desde el móvil, con la foto de cada ticket,
y descargar al final un ZIP con las fotos renombradas y un resumen por día.

**Web:** https://jonmg.github.io/gastos-viaje/

Sin servidor, sin cuentas y sin librerías: es una página estática (GitHub Pages) y todo
se guarda en el navegador del móvil donde se usa. Mismo enfoque que
[`cuaderno-gimnasio`](https://github.com/Jonmg/cuaderno-gimnasio).

---

## Índice

1. [Uso](#uso)
2. [El ZIP que se descarga](#el-zip-que-se-descarga)
3. [Cómo funciona](#cómo-funciona)
4. [Estructura del repositorio](#estructura-del-repositorio)
5. [Modelo de datos](#modelo-de-datos)
6. [Lógica (`logica.js`)](#lógica-logicajs)
7. [Interfaz (`app.js`)](#interfaz-appjs)
8. [Estadísticas](#estadísticas)
9. [Desarrollo](#desarrollo)
10. [Limitaciones conocidas](#limitaciones-conocidas)

---

## Uso

1. Abre la web en el móvil y, mejor, **Añadir a pantalla de inicio**: se abre como una app
   y el navegador protege más sus datos (ver [limitaciones](#limitaciones-conocidas)).
2. **Empezar viaje**: nombre, destino, fechas, tu nombre y compañeros (opcional).
3. Por cada gasto:
   - **Importe** (acepta `12,50`, `12.5`, `1.234,56`).
   - **Motivo**, que decide en qué grupo del resumen cae:

     | Grupo | Motivos |
     |---|---|
     | Comida | desayuno, comida, cena |
     | Transporte | taxi, metro/bus, tren, avión, coche/gasolina, parking/peaje |
     | Otros | alojamiento, otros |

   - **Fecha** (por defecto hoy, ajustada a las fechas del viaje) y **comentario**.
   - **Foto del ticket**: botón *Foto* (abre la cámara) o *Galería* (una o varias).
   - Con compañeros: **quién pagó** y **con quién** fue el gasto.
4. Los gastos se ven agrupados por día, con el total de cada día y de cada grupo. Los que
   no tienen foto se marcan con `!`. Tocar un gasto lo abre para editarlo o borrarlo.
5. **Cerrar viaje y descargar ZIP**. El viaje queda en solo lectura; se puede volver a
   descargar, compartir (si el móvil lo permite) o reabrir.
6. Con el ZIP ya guardado fuera del móvil, **Borrar viaje y fotos** libera espacio.

## El ZIP que se descarga

`gastos_2026-10-14_feria-milan.zip`:

```
2026-10-14_feria-milan/
  resumen.txt
  fotos/
    2026-10-14_taxi_22,30EUR.jpg        fecha_concepto_importe
    2026-10-15_cena_45,00EUR.jpg
    2026-10-15_cena_45,00EUR_2.jpg      segunda foto del mismo ticket (o gasto gemelo)
    2026-10-15_metro_4,80EUR.jpg
```

`resumen.txt` (fragmento):

```
GASTOS DE VIAJE — Feria Milán
Destino: Milán
Fechas: 2026-10-14 a 2026-10-16
Viajeros: Jon, Ana

POR DÍA

miércoles 14/10/2026
  Comida             8,40 €
  Transporte        22,30 €
  Total día         30,70 €
...
TOTAL DEL VIAJE
  Comida            53,40 €
  Transporte        27,10 €
  Otros              0,00 €
  TOTAL             80,50 €

PAGADO POR                     (solo si pagó más de una persona)
  Jon               35,50 €
  Ana               45,00 €

DETALLE
  2026-10-14  Desayuno              8,40 € (pagó Jon)
      foto: sin foto
  2026-10-14  Taxi                 22,30 €  Aeropuerto - hotel (pagó Jon)
      foto: 2026-10-14_taxi_22,30EUR.jpg
```

El detalle enlaza cada gasto con el nombre de su foto, y deja a la vista los que no tienen.

---

## Cómo funciona

```
 ┌──────────────────────── navegador del móvil ────────────────────────┐
 │                                                                      │
 │  index.html ── carga ──► logica.js  (cálculos puros, sin DOM)        │
 │                     └──► app.js     (pantallas y almacenamiento)     │
 │                                                                      │
 │  formulario de gasto                                                 │
 │     │  foto ──► reducirFoto() 1600 px JPEG ──► IndexedDB             │
 │     │                                         "gastos-viaje-fotos"   │
 │     └ datos ─► viaje.gastos[] ───────────────► localStorage          │
 │                                                "gastos-viaje"        │
 │                                                                      │
 │  cerrar viaje ─► nombresFotos() + resumenTexto() + crearZip()        │
 │                  ──► Blob .zip ──► descarga / compartir              │
 └──────────────────────────────────────────────────────────────────────┘
          │ solo nombres de evento (sin datos)
          ▼
   GoatCounter (estadísticas de uso)
```

- **No hay servidor.** GitHub Pages solo sirve los ficheros estáticos. Nada de lo que se
  apunta sale del móvil (salvo el ZIP que tú descargas o compartes).
- **Dos almacenes** porque tienen límites distintos:
  - `localStorage` para los viajes y gastos (texto JSON pequeño, lectura síncrona y simple).
  - IndexedDB para las fotos (blobs; caben cientos de MB, en `localStorage` solo ~5 MB).
- **Las fotos se reducen al elegirlas**, antes de guardarlas: lado mayor a 1600 px en JPEG
  al 82 %. Un ticket sigue siendo legible y pasa de 3–5 MB a ~200–300 KB.
- **El ZIP se construye en el propio móvil** con un escritor de ZIP mínimo (unas 40 líneas,
  sin librerías). Va *sin compresión* porque las fotos ya son JPEG y comprimir otra vez
  no ahorra nada.
- **Al crear el primer viaje** se pide `navigator.storage.persist()` para que el navegador
  no borre las fotos si se queda sin espacio.

## Estructura del repositorio

```
index.html            esqueleto de la página: contenedor #app, aviso flotante y scripts
logica.js             lógica pura (sin DOM): categorías, importes, totales, nombres de
                      foto, resumen.txt y escritor de ZIP. Se prueba con node.
app.js                todo lo que toca el navegador: almacenamiento, fotos, pantallas,
                      acciones de los botones, descarga y estadísticas
estilos.css           estilos; móvil primero, modo oscuro automático
manifest.webmanifest  nombre, colores e iconos para instalarla en la pantalla de inicio
iconos/               icono-180 (iOS), icono-192 y icono-512 (Android)
pruebas.mjs           pruebas de logica.js: node --test pruebas.mjs
CLAUDE.md             decisiones de diseño y convenciones para quien toque el código
```

La separación importante es **`logica.js` frente a `app.js`**: todo lo que se puede calcular
sin navegador (y por tanto probar) va en `logica.js`; `app.js` solo lee el formulario,
guarda, pinta y llama a la lógica.

## Modelo de datos

### `localStorage["gastos-viaje"]`

```jsonc
{
  "ajustes": { "viajero": "Jon" },          // último nombre usado, para rellenar
  "viajes": [
    {
      "id": "lx3k9a2b7",                     // generado en el móvil
      "nombre": "Feria Milán",
      "destino": "Milán",
      "inicio": "2026-10-14",                // fechas como AAAA-MM-DD
      "fin": "2026-10-16",
      "viajero": "Jon",                      // tú
      "companeros": ["Ana"],
      "estado": "abierto",                   // "abierto" | "cerrado"
      "creado": 1792483200000,               // marcas de tiempo en ms
      "cerrado": 1792656000000,              // solo si está cerrado
      "descargado": 1792656000000,           // última descarga/compartido del ZIP
      "gastos": [
        {
          "id": "lx3kb1c9q",
          "fecha": "2026-10-15",
          "categoria": "cena",               // clave de CATEGORIAS
          "importe": 4500,                   // CÉNTIMOS, siempre entero
          "comentario": "Cena cliente",
          "pagadoPor": "Ana",
          "con": ["Jon"],
          "fotos": [{ "id": "lx3kb2d0r", "ext": "jpg" }],
          "creado": 1792569600000            // desempata el orden dentro del día
        }
      ]
    }
  ]
}
```

- `localStorage["gastos-viaje-actual"]`: id del viaje abierto en pantalla, para volver a él.
- **IndexedDB** `gastos-viaje-fotos`, almacén `fotos`: clave = `id` de la foto, valor = el
  `Blob` de la imagen. El gasto solo guarda la referencia `{ id, ext }`.

Los importes se guardan en céntimos para no arrastrar errores de coma flotante
(`0,1 + 0,2`). Se formatean a `1.234,56 €` solo al mostrarlos.

## Lógica (`logica.js`)

Funciona igual en el navegador (queda en `window.Logica`) y en node (`module.exports`).

| Función | Qué hace |
|---|---|
| `CATEGORIAS`, `GRUPOS` | Motivos con su etiqueta y grupo; el orden es el de los botones. Para añadir un motivo, se añade aquí. |
| `parseImporte(texto)` | `"1.234,56 €"` → `123456`. Acepta coma o punto decimal y como mucho 2 decimales; devuelve `null` si no vale (vacío, negativo, texto). |
| `euros(cent)` | `123456` → `"1.234,56 €"`. |
| `ordenados(viaje)` | Gastos por fecha y, dentro del día, por orden de creación. Es el orden del resumen y de las fotos. |
| `totales(viaje)` | Totales por día y grupo, del viaje y por persona que pagó. |
| `nombresFotos(viaje)` | Nombre de cada foto en el ZIP: `fecha_categoria_importeEUR.ext`. Si un nombre se repite, añade `_2`, `_3`… |
| `resumenTexto(viaje)` | Genera `resumen.txt` (ver [ejemplo](#el-zip-que-se-descarga)). |
| `crearZip(entradas)` | Escribe un `.zip` válido (cabeceras locales, directorio central, CRC-32, nombres UTF-8) sin compresión. |

## Interfaz (`app.js`)

- **Tres pantallas**, que se repintan enteras con plantillas de texto (`innerHTML`):
  - **Lista** de viajes: en curso, formulario de viaje nuevo y cerrados.
  - **Viaje abierto**: totales por grupo, formulario de gasto, gastos por día, compañeros
    y botón de cierre.
  - **Viaje cerrado**: totales, descargar/compartir, resumen, gastos (solo lectura),
    reabrir y borrar.
- **Un único manejador de clics**: cada botón lleva `data-acc="…"` y `accion()` decide qué
  hacer con un `switch`. Añadir un botón = añadir un `case`.
- **Edición**: tocar un gasto carga sus datos en el mismo formulario (`editando` = id).
  Las fotos nuevas esperan en `pendientes` y las quitadas en `quitarFotos` hasta pulsar
  *Guardar*; *Cancelar* las descarta.
- **`repintarForm()`** vuelve a pintar solo el formulario conservando lo escrito (por
  ejemplo al añadir o quitar una foto).
- **Fotos**: `reducirFoto()` con un `<canvas>`. Si el navegador no sabe abrir el formato
  (HEIC fuera de Safari), se guarda la foto original tal cual.
- **Descarga**: `generarZip()` lee los blobs de IndexedDB, monta el ZIP con `crearZip()` y
  lo descarga con un enlace temporal; *Compartir* usa `navigator.share` con el fichero.
- **Avisos**: mensajes breves abajo (`aviso()`); confirmaciones con `confirm()`/`prompt()`
  para cerrar y borrar.

## Estadísticas

Contador de uso con [GoatCounter](https://www.goatcounter.com), sin cookies.
Panel: https://jon-apps.goatcounter.com (cuenta común de mis apps; esta sale en `/gastos-viaje/`).

- **Visitas**: aperturas de la página, de dónde llegan, país, navegador, sistema y pantalla.
- **Eventos**: `abierta-instalada` / `abierta-navegador`, `viaje-creado`, `gasto-anadido`,
  `gasto-editado`, `foto-camara` / `foto-galeria`, `viaje-cerrado`, `zip-descargado`,
  `zip-compartido`, `viaje-reabierto`, `viaje-borrado`.
- **Nunca se envía**: nombres de viaje o personas, importes, comentarios, fechas ni fotos.
  Solo el nombre fijo del evento.
- **Cómo**: `evento(nombre, título)` en `app.js`. El script de GoatCounter carga en
  asíncrono: los eventos que ocurren antes se guardan en una cola y se envían al cargar.
  Si no carga (bloqueador, sin conexión), la app funciona igual.
- **Excluir tus visitas**: abre una vez https://jonmg.github.io/gastos-viaje/#toggle-goatcounter
  en cada dispositivo.

---

## Desarrollo

**Probar en local** (hace falta un servidor estático; abrir el fichero con `file://` no
funciona igual en todos los navegadores):

```bash
python3 -m http.server 8000      # y abrir http://localhost:8000
```

Desde el móvil en la misma wifi: `http://<ip-del-ordenador>:8000`. GoatCounter no cuenta
visitas desde `localhost`.

**Pruebas** (node 18 o superior, sin instalar nada):

```bash
node --test pruebas.mjs
```

Cubren importes, formato en euros, nombres de foto, totales por día, el texto del resumen
y que el ZIP generado se abre con una herramienta estándar (usa `python3` para comprobarlo).

**Reglas al cambiar código** (detalle en `CLAUDE.md`):

- Al cambiar `app.js`, `logica.js` o `estilos.css`, subir el `?v=` en `index.html`; si no,
  los móviles siguen usando la versión en caché.
- Cálculos nuevos en `logica.js`, con su prueba en `pruebas.mjs`.
- Importes siempre en céntimos enteros.
- Cambiar el formato de nombre de las fotos obliga a actualizar las pruebas.
- Código, comentarios y textos en castellano.

**Publicar**: GitHub Pages sirve la rama `main` desde la raíz (Settings → Pages →
*Deploy from a branch* → `main`, `/ (root)`). Cada push a `main` se publica en uno o dos minutos.

## Limitaciones conocidas

- **Los datos viven solo en ese navegador.** Borrar los datos del navegador, cambiar de
  móvil o usar modo privado los pierde. El ZIP al cerrar es la copia que vale.
- **Safari (iPhone)** puede borrar los datos de webs que no se visitan en ~7 días si *no*
  están añadidas a la pantalla de inicio. Instalada como app no pasa.
- **Sin sincronización**: un viaje apuntado en un móvil no se ve en otro.
- **Solo euros.**
- **HEIC** en navegadores que no lo abren se guarda sin reducir y con extensión `.heic`.

## Historia

La primera versión era una app Flask con los datos en ficheros JSON en el servidor. Se
cambió a página estática para no depender de un servidor: abrir, apuntar en local y
descargar el ZIP al acabar. Un servidor (por ejemplo, para sincronizar entre móviles)
queda como posible paso futuro.
