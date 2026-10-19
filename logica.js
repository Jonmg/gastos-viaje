"use strict";
/* Lógica pura de gastos-viaje: importes, nombres de foto, resumen y ZIP.
   Sin DOM ni almacenamiento, para poder probarla con node (pruebas.mjs).
   En el navegador queda en window.Logica. */
(function (raiz) {

  // clave -> [etiqueta, grupo]. El orden es el de los botones de motivo.
  const CATEGORIAS = {
    desayuno: ["Desayuno", "Comida"],
    comida: ["Comida", "Comida"],
    cena: ["Cena", "Comida"],
    taxi: ["Taxi", "Transporte"],
    metro: ["Metro / bus", "Transporte"],
    tren: ["Tren", "Transporte"],
    avion: ["Avión", "Transporte"],
    coche: ["Coche / gasolina", "Transporte"],
    parking: ["Parking / peaje", "Transporte"],
    alojamiento: ["Alojamiento", "Otros"],
    otros: ["Otros", "Otros"],
  };
  const GRUPOS = ["Comida", "Transporte", "Otros"];
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  const categoria = clave => CATEGORIAS[clave] || CATEGORIAS.otros;

  // "12,50" / "12.5" / "1.234,56 €" -> 1250 / 1250 / 123456 céntimos. null si no vale.
  function parseImporte(texto) {
    let t = String(texto ?? "").replace(/[€\s]/g, "");
    if (!t) return null;
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(Number(t) * 100);
  }

  // 123456 -> "1.234,56 €"
  function euros(cent, simbolo = true) {
    const neg = cent < 0, a = Math.abs(cent);
    const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const s = `${neg ? "-" : ""}${ent},${String(a % 100).padStart(2, "0")}`;
    return simbolo ? `${s} €` : s;
  }

  const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "viaje";

  function fechaLarga(clave) {
    const [y, m, d] = clave.split("-").map(Number);
    const f = new Date(y, m - 1, d);
    return `${DIAS[f.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  const ordenados = viaje => [...viaje.gastos].sort((a, b) =>
    a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creado - b.creado);

  /* Nombre de cada foto en el ZIP: fecha_concepto_importe, p. ej.
     2026-10-15_cena_45,00EUR.jpg. Si se repite (dos fotos del mismo ticket o dos
     cenas iguales), _2, _3… Devuelve [{ gasto, foto, nombre }] en orden. */
  function nombresFotos(viaje) {
    const usados = new Set(), salida = [];
    for (const g of ordenados(viaje)) {
      for (const f of g.fotos || []) {
        const base = `${g.fecha}_${g.categoria}_${euros(g.importe, false).replace(/\./g, "")}EUR`;
        let nombre = base, n = 2;
        while (usados.has(nombre)) nombre = `${base}_${n++}`;
        usados.add(nombre);
        salida.push({ gasto: g, foto: f, nombre: `${nombre}.${f.ext || "jpg"}` });
      }
    }
    return salida;
  }

  // Totales por día y grupo: { dias: {fecha: {Comida, Transporte, Otros, total}}, grupos, total }
  function totales(viaje) {
    const vacio = () => ({ Comida: 0, Transporte: 0, Otros: 0, total: 0 });
    const r = { dias: {}, grupos: vacio(), porPersona: {} };
    for (const g of ordenados(viaje)) {
      const grupo = categoria(g.categoria)[1];
      const d = (r.dias[g.fecha] ??= vacio());
      d[grupo] += g.importe; d.total += g.importe;
      r.grupos[grupo] += g.importe; r.grupos.total += g.importe;
      if (g.pagadoPor) r.porPersona[g.pagadoPor] = (r.porPersona[g.pagadoPor] || 0) + g.importe;
    }
    return r;
  }

  function resumenTexto(viaje) {
    const t = totales(viaje), fotos = new Map();
    for (const x of nombresFotos(viaje)) (fotos.get(x.gasto) || fotos.set(x.gasto, []).get(x.gasto)).push(x.nombre);
    const col = (txt, cent) => `  ${txt.padEnd(12)}${euros(cent).padStart(13)}`;
    const L = [
      `GASTOS DE VIAJE — ${viaje.nombre}`,
      viaje.destino ? `Destino: ${viaje.destino}` : null,
      `Fechas: ${viaje.inicio || "?"} a ${viaje.fin || "?"}`,
      viaje.companeros?.length ? `Viajeros: ${[viaje.viajero || "Yo", ...viaje.companeros].join(", ")}` : null,
      "",
    ].filter(x => x !== null);

    L.push("POR DÍA");
    for (const [fecha, d] of Object.entries(t.dias)) {
      L.push("", fechaLarga(fecha));
      for (const gr of GRUPOS) if (d[gr]) L.push(col(gr, d[gr]));
      L.push(col("Total día", d.total));
    }
    L.push("", "TOTAL DEL VIAJE");
    for (const gr of GRUPOS) L.push(col(gr, t.grupos[gr]));
    L.push(col("TOTAL", t.grupos.total));
    const variosPagan = Object.keys(t.porPersona).length > 1;
    if (variosPagan) {
      L.push("", "PAGADO POR");
      for (const [p, v] of Object.entries(t.porPersona)) L.push(col(p, v));
    }

    L.push("", "DETALLE");
    for (const g of ordenados(viaje)) {
      const extra = [variosPagan ? `pagó ${g.pagadoPor}` : "",
        g.con?.length ? `con ${g.con.join(", ")}` : ""].filter(Boolean).join(", ");
      L.push(`  ${g.fecha}  ${categoria(g.categoria)[0].padEnd(16)}${euros(g.importe).padStart(12)}` +
        (g.comentario ? `  ${g.comentario}` : "") + (extra ? ` (${extra})` : ""));
      L.push(`      foto: ${(fotos.get(g) || []).join(", ") || "sin foto"}`);
    }
    return L.join("\n") + "\n";
  }

  /* ---------- ZIP mínimo (sin compresión) ----------
     Las fotos ya son JPEG: comprimir otra vez no gana nada. Así no hace falta librería. */
  const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(datos) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // entradas: [{ nombre, datos: Uint8Array }] -> Uint8Array con el .zip
  function crearZip(entradas, fecha = new Date()) {
    const enc = new TextEncoder();
    const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
    const dia = ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
    const locales = [], centrales = [];
    let desplaz = 0;
    for (const e of entradas) {
      const nombre = enc.encode(e.nombre), datos = e.datos, crc = crc32(datos);
      const cab = new DataView(new ArrayBuffer(30));
      cab.setUint32(0, 0x04034b50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 0x0800, true); // UTF-8
      cab.setUint16(8, 0, true); cab.setUint16(10, hora, true); cab.setUint16(12, dia, true);
      cab.setUint32(14, crc, true); cab.setUint32(18, datos.length, true); cab.setUint32(22, datos.length, true);
      cab.setUint16(26, nombre.length, true); cab.setUint16(28, 0, true);
      locales.push(new Uint8Array(cab.buffer), nombre, datos);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, hora, true); cen.setUint16(14, dia, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
      cen.setUint16(28, nombre.length, true); cen.setUint32(42, desplaz, true);
      centrales.push(new Uint8Array(cen.buffer), nombre);
      desplaz += 30 + nombre.length + datos.length;
    }
    const tamCentral = centrales.reduce((s, b) => s + b.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, entradas.length, true); fin.setUint16(10, entradas.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplaz, true);
    const partes = [...locales, ...centrales, new Uint8Array(fin.buffer)];
    const salida = new Uint8Array(partes.reduce((s, b) => s + b.length, 0));
    let p = 0;
    for (const b of partes) { salida.set(b, p); p += b.length; }
    return salida;
  }

  const Logica = { CATEGORIAS, GRUPOS, categoria, parseImporte, euros, slug, fechaLarga,
    ordenados, nombresFotos, totales, resumenTexto, crc32, crearZip };
  if (typeof module !== "undefined" && module.exports) module.exports = Logica;
  else raiz.Logica = Logica;
})(typeof window !== "undefined" ? window : globalThis);
