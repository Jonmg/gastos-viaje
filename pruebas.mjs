// Pruebas de logica.js, sin navegador ni dependencias: node --test pruebas.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const L = createRequire(import.meta.url)("./logica.js");

const viaje = () => ({
  nombre: "Feria Milán", destino: "Milán", inicio: "2026-10-14", fin: "2026-10-16",
  viajero: "Jon", companeros: ["Ana"],
  gastos: [
    { id: "a", fecha: "2026-10-15", categoria: "cena", importe: 4500, comentario: "Cliente", pagadoPor: "Ana", con: ["Jon"], creado: 3, fotos: [{ id: "f1", ext: "jpg" }, { id: "f2", ext: "jpg" }] },
    { id: "b", fecha: "2026-10-14", categoria: "taxi", importe: 2230, comentario: "", pagadoPor: "Jon", con: [], creado: 2, fotos: [{ id: "f3", ext: "jpg" }] },
    { id: "c", fecha: "2026-10-14", categoria: "desayuno", importe: 840, comentario: "", pagadoPor: "Jon", con: [], creado: 1, fotos: [] },
    { id: "d", fecha: "2026-10-14", categoria: "taxi", importe: 2230, comentario: "vuelta", pagadoPor: "Jon", con: [], creado: 4, fotos: [{ id: "f4", ext: "png" }] },
    { id: "e", fecha: "2026-10-16", categoria: "alojamiento", importe: 123456, comentario: "Hotel", pagadoPor: "Jon", con: [], creado: 5, fotos: [{ id: "f5", ext: "jpg" }] },
  ],
});

test("parseImporte", () => {
  assert.equal(L.parseImporte("12,50"), 1250);
  assert.equal(L.parseImporte("12.5"), 1250);
  assert.equal(L.parseImporte("1.234,56 €"), 123456);
  assert.equal(L.parseImporte(" 7 "), 700);
  for (const malo of ["", "abc", "-3", "1,2,3", "0,123"]) assert.equal(L.parseImporte(malo), null, malo);
});

test("euros", () => {
  assert.equal(L.euros(123456), "1.234,56 €");
  assert.equal(L.euros(5, false), "0,05");
  assert.equal(L.euros(100000000), "1.000.000,00 €");
});

test("nombres de foto: fecha, concepto, importe y sin repetir", () => {
  assert.deepEqual(L.nombresFotos(viaje()).map(x => x.nombre), [
    "2026-10-14_taxi_22,30EUR.jpg",
    "2026-10-14_taxi_22,30EUR_2.png",
    "2026-10-15_cena_45,00EUR.jpg",
    "2026-10-15_cena_45,00EUR_2.jpg",
    "2026-10-16_alojamiento_1234,56EUR.jpg",
  ]);
});

test("totales por día y grupo", () => {
  const t = L.totales(viaje());
  assert.deepEqual(t.dias["2026-10-14"], { Comida: 840, Transporte: 4460, Otros: 0, total: 5300 });
  assert.deepEqual(t.dias["2026-10-15"], { Comida: 4500, Transporte: 0, Otros: 0, total: 4500 });
  assert.equal(t.grupos.total, 5300 + 4500 + 123456);
  assert.deepEqual(t.porPersona, { Ana: 4500, Jon: 5300 + 123456 });
});

test("resumen de texto", () => {
  const r = L.resumenTexto(viaje());
  assert.match(r, /miércoles 14\/10\/2026/);
  assert.match(r, /Transporte\s+44,60 €/);
  assert.match(r, /Total día\s+53,00 €/);
  assert.match(r, /TOTAL\s+1\.332,56 €/);
  assert.match(r, /PAGADO POR/);
  assert.match(r, /Desayuno.*8,40 €[\s\S]*foto: sin foto/);
  assert.match(r, /foto: 2026-10-15_cena_45,00EUR\.jpg, 2026-10-15_cena_45,00EUR_2\.jpg/);
});

test("el ZIP se abre con una herramienta estándar", () => {
  const enc = new TextEncoder();
  const zip = L.crearZip([
    { nombre: "viaje/resumen.txt", datos: enc.encode("año 2026: 12,50 €\n") },
    { nombre: "viaje/fotos/2026-10-14_taxi_22,30EUR.jpg", datos: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) },
  ], new Date(2026, 9, 19, 10, 30));
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  writeFileSync(join(dir, "p.zip"), zip);
  const py = `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print("|".join(z.namelist())); print(z.read("viaje/resumen.txt").decode()); print(z.infolist()[0].date_time)`;
  const out = execFileSync("python3", ["-I", "-c", py, join(dir, "p.zip")]).toString();
  assert.match(out, /viaje\/resumen\.txt\|viaje\/fotos\/2026-10-14_taxi_22,30EUR\.jpg/);
  assert.match(out, /año 2026: 12,50 €/);
  assert.match(out, /\(2026, 10, 19, 10, 30, 0\)/);
});

test("crc32 conocido", () => {
  assert.equal(L.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
});
