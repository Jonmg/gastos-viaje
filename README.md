# Gastos de viaje

App web mínima para apuntar los gastos de un viaje desde el móvil y, al cerrarlo,
descargar un ZIP con las fotos de los tickets renombradas y el resumen.

## Qué hace

- **Viajes**: nombre, destino, fechas, tu nombre y compañeros.
- **Gastos**: importe (acepta `12,50`), fecha, motivo, comentario, quién pagó,
  con quién, y una o varias fotos del ticket (o PDF). Desde el móvil, el botón de
  fotos abre la cámara o la galería.
- **Motivos**, agrupados para el resumen:
  - Comida: desayuno, comida, cena
  - Transporte: taxi/VTC, metro/bus, tren, avión, coche alquiler/combustible, parking/peaje
  - Otros: alojamiento, otros
- **Compañeros**: se añaden al crear el viaje o después. Cada gasto indica quién
  pagó y con quién fue; el resumen da el total pagado por persona.
- **Cierre**: un viaje cerrado no se puede modificar (se puede reabrir) y
  permite descargar `gastos_<viaje>.zip`:

```
2026-10-14-feria-milan/
  resumen.csv          detalle por gasto + totales Comida / Transporte / Otros (abre en Excel)
  resumen.txt          resumen legible por grupo, categoría y pagador
  fotos/
    01_2026-10-14_desayuno_8,40EUR.jpg
    02_2026-10-14_taxi_22,30EUR.jpg
    03_2026-10-15_cena_45,00EUR_1.jpg
    03_2026-10-15_cena_45,00EUR_2.jpg
```

El número inicial de cada foto coincide con la columna `Nº` del CSV.

## Uso

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python3 app.py            # http://<ip-del-equipo>:5001 desde el móvil, misma wifi
python3 pruebas.py        # batería offline
```

Variables opcionales: `GASTOS_DATOS` (carpeta de datos, por defecto `./datos`),
`GASTOS_PORT` (5001), `GASTOS_HOST` (0.0.0.0), `GASTOS_SECRET`.

## Datos

Sin base de datos: cada viaje es `datos/<slug>/viaje.json` + `datos/<slug>/fotos/`.
Los importes se guardan en céntimos. Copia de seguridad = copiar la carpeta `datos/`.

## Seguridad

Sin autenticación: solo para red local. No exponer a internet tal cual.
