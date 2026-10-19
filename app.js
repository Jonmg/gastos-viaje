"use strict";
/* Gastos de viaje: todo en el navegador del móvil, sin servidor.
   Los viajes van en localStorage y las fotos de los tickets en IndexedDB (reducidas).
   Al cerrar el viaje se genera en el propio móvil un ZIP con las fotos renombradas y
   resumen.txt. La lógica pura (importes, nombres, resumen, ZIP) está en logica.js. */

const { CATEGORIAS, GRUPOS, categoria, parseImporte, euros, slug, fechaLarga,
  ordenados, nombresFotos, totales, resumenTexto, crearZip } = window.Logica;

const CLAVE = "gastos-viaje";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const claveFecha = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const HOY = claveFecha(new Date());
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- Almacenamiento ---------- */
const Datos = {
  viajes: [], ajustes: {},
  cargar() {
    try {
      const j = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (j) { this.viajes = j.viajes || []; this.ajustes = j.ajustes || {}; }
    } catch (e) {}
  },
  guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify({ viajes: this.viajes, ajustes: this.ajustes })); return true; }
    catch (e) { aviso("No se pudo guardar en este móvil. Revisa que el navegador no esté en modo privado.", true); return false; }
  },
  viaje(id) { return this.viajes.find(v => v.id === id); },
};

// Fotos en IndexedDB: cabe mucho más que en localStorage. Clave = id de la foto.
const Fotos = {
  url: {}, _db: null,
  abrir() {
    return this._db ??= new Promise((ok, mal) => {
      const r = indexedDB.open("gastos-viaje-fotos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("fotos");
      r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
    });
  },
  async op(modo, fn) {
    const db = await this.abrir();
    return new Promise((ok, mal) => {
      const t = db.transaction("fotos", modo); const q = fn(t.objectStore("fotos"));
      t.oncomplete = () => ok(q?.result); t.onerror = () => mal(t.error);
    });
  },
  async cargar() {
    const db = await this.abrir();
    await new Promise(ok => {
      const c = db.transaction("fotos").objectStore("fotos").openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return ok(); this.url[cur.key] = URL.createObjectURL(cur.value); cur.continue(); };
      c.onerror = () => ok();
    });
  },
  leer(id) { return this.op("readonly", st => st.get(id)); },
  async guardar(id, blob) { await this.op("readwrite", st => st.put(blob, id)); this.url[id] = URL.createObjectURL(blob); },
  async borrar(id) {
    await this.op("readwrite", st => st.delete(id));
    if (this.url[id]) URL.revokeObjectURL(this.url[id]);
    delete this.url[id];
  },
};

// Reduce la foto a 1600 px de lado mayor: el ticket se sigue leyendo y pesa ~200–300 KB.
function reducirFoto(file, max = 1600) {
  return new Promise((ok, mal) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b => b ? ok(b) : mal(new Error("No se pudo procesar la foto")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(u); mal(new Error("Ese archivo no parece una imagen")); };
    img.src = u;
  });
}
const extDe = tipo => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" }[tipo] || "jpg");

/* ---------- Estado de la pantalla ---------- */
let actual = null;        // id del viaje abierto en pantalla (null = lista)
let editando = null;      // id del gasto en edición (null = gasto nuevo)
let pendientes = [];      // fotos elegidas para el formulario: { blob, ext, url }
let quitarFotos = new Set();
let ultimoMotivo = "comida";

function aviso(texto, mal = false) {
  const el = $("#aviso"); if (!el) return;
  el.textContent = texto; el.className = `aviso-flot ${mal ? "mal" : ""}`; el.hidden = false;
  clearTimeout(aviso._t); aviso._t = setTimeout(() => { el.hidden = true; }, mal ? 6000 : 2800);
}

function irA(id) {
  actual = id; editando = null; limpiarPendientes();
  try { localStorage.setItem(CLAVE + "-actual", id || ""); } catch (e) {}
  pintar(); window.scrollTo(0, 0);
}
function limpiarPendientes() { pendientes.forEach(p => URL.revokeObjectURL(p.url)); pendientes = []; quitarFotos = new Set(); }

/* ---------- Vistas ---------- */
function pintar() {
  const v = actual && Datos.viaje(actual);
  if (!v) { actual = null; return vistaLista(); }
  return v.estado === "cerrado" ? vistaCerrado(v) : vistaAbierto(v);
}

function cabecera(titulo, sub, total, volver = true) {
  return `<header class="hero"><div class="hero-in">
    <div class="hero-top">${volver ? `<button class="volver" data-acc="lista">‹ Viajes</button>` : `<span class="marca">Gastos de viaje</span>`}</div>
    <h1>${esc(titulo)}</h1>
    ${sub ? `<p class="hero-sub">${esc(sub)}</p>` : ""}
    ${total != null ? `<p class="hero-total num">${euros(total)}</p>` : ""}
  </div></header>`;
}

function vistaLista() {
  const abiertos = Datos.viajes.filter(v => v.estado !== "cerrado");
  const cerrados = Datos.viajes.filter(v => v.estado === "cerrado").sort((a, b) => (b.inicio || "").localeCompare(a.inicio || ""));
  const tarjeta = v => `<button class="viaje-fila" data-acc="abrir" data-id="${v.id}">
      <span><strong>${esc(v.nombre)}</strong><br><span class="muted small">${esc([v.destino, v.inicio].filter(Boolean).join(" · "))} · ${v.gastos.length} gasto${v.gastos.length === 1 ? "" : "s"}</span></span>
      <span class="num importe">${euros(totales(v).grupos.total)}</span></button>`;
  $("#app").innerHTML = cabecera("Mis viajes", "Apunta cada gasto con la foto del ticket. Al cerrar el viaje, descarga el ZIP.", null, false) + `
  <div class="wrap">
    ${abiertos.length ? `<section class="card"><h2>En curso</h2>${abiertos.map(tarjeta).join("")}</section>` : ""}
    <section class="card">
      <h2>Nuevo viaje</h2>
      <label class="campo">Nombre<input id="nv-nombre" class="texto" placeholder="Feria Milán"></label>
      <label class="campo">Destino<input id="nv-destino" class="texto" placeholder="Milán"></label>
      <div class="fila2">
        <label class="campo">Inicio<input id="nv-inicio" type="date" class="texto" value="${HOY}"></label>
        <label class="campo">Fin<input id="nv-fin" type="date" class="texto"></label>
      </div>
      <label class="campo">Tu nombre<input id="nv-viajero" class="texto" value="${esc(Datos.ajustes.viajero || "")}" placeholder="Jon"></label>
      <label class="campo">Compañeros <span class="muted small">(opcional, separados por comas)</span><input id="nv-companeros" class="texto" placeholder="Ana, Luis"></label>
      <button class="btn" data-acc="crear">Empezar viaje</button>
    </section>
    ${cerrados.length ? `<section class="card"><h2>Cerrados</h2>${cerrados.map(tarjeta).join("")}</section>` : ""}
    <p class="muted small pie">Los datos y las fotos se guardan solo en este navegador. Descarga el ZIP al cerrar cada viaje.</p>
  </div>`;
}

function personas(v) { return [v.viajero || "Yo", ...(v.companeros || [])]; }

function formularioGasto(v) {
  const g = editando ? v.gastos.find(x => x.id === editando) : null;
  const cat = g ? g.categoria : ultimoMotivo;
  const fechaDef = v.fin && HOY > v.fin ? v.fin : (v.inicio && HOY < v.inicio ? v.inicio : HOY);
  const ps = personas(v);
  const chips = Object.entries(CATEGORIAS).map(([k, [et, gr]]) =>
    `<label class="chip g-${gr.toLowerCase()}"><input type="radio" name="motivo" value="${k}" ${k === cat ? "checked" : ""}><span>${et}</span></label>`).join("");
  const fotosActuales = (g?.fotos || []).filter(f => !quitarFotos.has(f.id)).map(f =>
    `<span class="mini">${miniatura(f)}<button class="quitar" data-acc="quitar-foto" data-id="${f.id}" aria-label="Quitar foto">×</button></span>`).join("");
  const fotosNuevas = pendientes.map((p, i) =>
    `<span class="mini"><img src="${p.url}" alt="ticket"><button class="quitar" data-acc="quitar-pendiente" data-i="${i}" aria-label="Quitar foto">×</button></span>`).join("");
  return `<section class="card ${g ? "editando" : ""}" id="form-gasto">
    <h2>${g ? "Editar gasto" : "Nuevo gasto"}</h2>
    <div class="fila2">
      <label class="campo">Importe (€)<input id="g-importe" class="texto grande num" inputmode="decimal" placeholder="0,00" value="${g ? euros(g.importe, false) : ""}"></label>
      <label class="campo">Fecha<input id="g-fecha" type="date" class="texto" value="${g ? g.fecha : fechaDef}"></label>
    </div>
    <div class="campo">Motivo<div class="chips">${chips}</div></div>
    <label class="campo">Comentario<input id="g-comentario" class="texto" placeholder="Cena con cliente, taxi aeropuerto…" value="${esc(g?.comentario || "")}"></label>
    ${ps.length > 1 ? `
      <label class="campo">Pagado por<select id="g-pagado" class="texto">${ps.map(p => `<option ${p === (g?.pagadoPor || ps[0]) ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
      <div class="campo">Con<div class="chips">${ps.map(p => `<label class="chip"><input type="checkbox" name="con" value="${esc(p)}" ${g?.con?.includes(p) ? "checked" : ""}><span>${esc(p)}</span></label>`).join("")}</div></div>` : ""}
    <div class="campo">Ticket
      <div class="fotos">${fotosActuales}${fotosNuevas}
        <label class="btn sec peq foto-btn">📷 Foto<input type="file" accept="image/*" capture="environment" data-fotos hidden></label>
        <label class="btn sec peq foto-btn">Galería<input type="file" accept="image/*" multiple data-fotos hidden></label>
      </div>
    </div>
    <div class="fila">
      <button class="btn" data-acc="guardar-gasto">${g ? "Guardar cambios" : "Añadir gasto"}</button>
      ${g ? `<button class="btn sec" data-acc="cancelar">Cancelar</button><button class="btn peligro" data-acc="borrar-gasto">Borrar</button>` : ""}
    </div>
  </section>`;
}

function miniatura(f) {
  const u = Fotos.url[f.id];
  return u ? `<img src="${u}" alt="ticket" data-acc="ver-foto" data-id="${f.id}">` : `<span class="sin-foto">?</span>`;
}

function listaPorDia(v, editable) {
  const t = totales(v), porDia = {};
  for (const g of ordenados(v)) (porDia[g.fecha] ??= []).push(g);
  const dias = Object.keys(porDia).sort().reverse(); // lo más reciente arriba
  if (!dias.length) return `<p class="muted">Aún no hay gastos.</p>`;
  return dias.map(f => {
    const d = t.dias[f];
    return `<div class="dia">
      <div class="dia-cab"><strong>${fechaLarga(f)}</strong><span class="num">${euros(d.total)}</span></div>
      <div class="dia-grupos muted small">${GRUPOS.filter(gr => d[gr]).map(gr => `${gr} ${euros(d[gr])}`).join(" · ")}</div>
      ${porDia[f].map(g => `<div class="gasto ${editable ? "tocable" : ""}" ${editable ? `data-acc="editar" data-id="${g.id}"` : ""}>
        <span class="punto g-${categoria(g.categoria)[1].toLowerCase()}"></span>
        <span class="gasto-txt"><strong>${categoria(g.categoria)[0]}</strong>${g.comentario ? ` <span class="muted">${esc(g.comentario)}</span>` : ""}
          ${g.con?.length ? `<br><span class="muted small">pagó ${esc(g.pagadoPor)} · con ${esc(g.con.join(", "))}</span>` : ""}</span>
        <span class="gasto-fotos">${g.fotos.length ? g.fotos.slice(0, 2).map(miniatura).join("") : `<span class="sin-foto" title="Sin foto">!</span>`}</span>
        <span class="num importe">${euros(g.importe)}</span>
      </div>`).join("")}
    </div>`;
  }).join("");
}

function bloqueTotales(v) {
  const t = totales(v);
  return `<div class="totales">${GRUPOS.map(gr => `<div><span class="muted small">${gr}</span><span class="num">${euros(t.grupos[gr])}</span></div>`).join("")}</div>`;
}

function vistaAbierto(v) {
  const sub = [v.destino, [v.inicio, v.fin].filter(Boolean).join(" → ")].filter(Boolean).join(" · ");
  const sinFoto = v.gastos.filter(g => !g.fotos.length).length;
  $("#app").innerHTML = cabecera(v.nombre, sub, totales(v).grupos.total) + `
  <div class="wrap">
    ${bloqueTotales(v)}
    ${formularioGasto(v)}
    <section class="card"><h2>Gastos</h2>
      ${sinFoto ? `<p class="aviso small">${sinFoto} gasto${sinFoto === 1 ? "" : "s"} sin foto del ticket.</p>` : ""}
      ${listaPorDia(v, true)}
    </section>
    <section class="card"><h2>Compañeros</h2>
      <p class="small">${personas(v).map((p, i) => i === 0 ? `<strong>${esc(p)}</strong>` :
        `<span class="etiqueta">${esc(p)} <button class="enlace" data-acc="quitar-companero" data-nombre="${esc(p)}" aria-label="Quitar">×</button></span>`).join(" ")}</p>
      <div class="fila"><input id="nuevo-companero" class="texto" placeholder="Nombre"><button class="btn sec" data-acc="anadir-companero">Añadir</button></div>
    </section>
    <section class="card"><h2>Fin del viaje</h2>
      <p class="small muted">Al cerrar se descarga un ZIP con las fotos (nombre con fecha y concepto) y un resumen por día. Podrás volver a descargarlo o reabrir el viaje.</p>
      <button class="btn" data-acc="cerrar">Cerrar viaje y descargar ZIP</button>
    </section>
  </div>`;
}

function vistaCerrado(v) {
  const sub = `Cerrado · ${[v.destino, [v.inicio, v.fin].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")}`;
  const compartir = navigator.canShare?.({ files: [new File([""], "x.zip", { type: "application/zip" })] });
  $("#app").innerHTML = cabecera(v.nombre, sub, totales(v).grupos.total) + `
  <div class="wrap">
    ${bloqueTotales(v)}
    <section class="card"><h2>Descargar</h2>
      <div class="fila">
        <button class="btn" data-acc="descargar">Descargar ZIP</button>
        ${compartir ? `<button class="btn sec" data-acc="compartir">Compartir ZIP…</button>` : ""}
      </div>
      <details><summary class="small">Ver resumen</summary><pre class="resumen">${esc(resumenTexto(v))}</pre></details>
    </section>
    <section class="card"><h2>Gastos</h2>${listaPorDia(v, false)}</section>
    <section class="card"><h2>Opciones</h2>
      <div class="fila">
        <button class="btn sec" data-acc="reabrir">Reabrir viaje</button>
        <button class="btn peligro" data-acc="borrar-viaje">Borrar viaje y fotos</button>
      </div>
      <p class="small muted">Borra el viaje solo cuando tengas el ZIP guardado fuera del móvil.</p>
    </section>
  </div>`;
}

/* ---------- Acciones ---------- */
function leerFormulario(v) {
  const importe = parseImporte($("#g-importe").value);
  if (importe == null) { aviso("Pon un importe válido, por ejemplo 12,50.", true); $("#g-importe").focus(); return null; }
  const pagadoPor = $("#g-pagado")?.value || personas(v)[0];
  return {
    importe, pagadoPor,
    fecha: $("#g-fecha").value || HOY,
    categoria: document.querySelector('input[name="motivo"]:checked')?.value || "otros",
    comentario: $("#g-comentario").value.trim(),
    con: [...document.querySelectorAll('input[name="con"]:checked')].map(c => c.value).filter(p => p !== pagadoPor),
  };
}

async function guardarGasto(v) {
  const datos = leerFormulario(v); if (!datos) return;
  let g = editando && v.gastos.find(x => x.id === editando);
  if (!g) { g = { id: nuevoId(), creado: Date.now(), fotos: [] }; v.gastos.push(g); }
  Object.assign(g, datos);
  try {
    for (const id of quitarFotos) await Fotos.borrar(id);
    g.fotos = g.fotos.filter(f => !quitarFotos.has(f.id));
    for (const p of pendientes) {
      const id = nuevoId();
      await Fotos.guardar(id, p.blob);
      g.fotos.push({ id, ext: p.ext });
    }
  } catch (e) { aviso("No se pudo guardar la foto: " + (e.message || e), true); }
  ultimoMotivo = g.categoria;
  if (!Datos.guardar()) return;
  aviso(`${editando ? "Guardado" : "Añadido"}: ${categoria(g.categoria)[0]} ${euros(g.importe)}`);
  editando = null; limpiarPendientes(); pintar();
}

async function borrarGasto(v) {
  const g = v.gastos.find(x => x.id === editando);
  if (!g || !confirm(`¿Borrar ${categoria(g.categoria)[0]} de ${euros(g.importe)} y sus fotos?`)) return;
  for (const f of g.fotos) await Fotos.borrar(f.id).catch(() => {});
  v.gastos = v.gastos.filter(x => x !== g);
  Datos.guardar(); editando = null; limpiarPendientes(); pintar();
}

async function generarZip(v) {
  const enc = new TextEncoder(), raiz = `${v.inicio || HOY}_${slug(v.nombre)}`;
  const entradas = [{ nombre: `${raiz}/resumen.txt`, datos: enc.encode(resumenTexto(v).replace(/\n/g, "\r\n")) }];
  let faltan = 0;
  for (const x of nombresFotos(v)) {
    const blob = await Fotos.leer(x.foto.id);
    if (!blob) { faltan++; continue; }
    entradas.push({ nombre: `${raiz}/fotos/${x.nombre}`, datos: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (faltan) aviso(`Ojo: ${faltan} foto${faltan === 1 ? "" : "s"} no se encontraron en este navegador.`, true);
  return new File([crearZip(entradas)], `gastos_${raiz}.zip`, { type: "application/zip" });
}

async function descargar(v) {
  const f = await generarZip(v);
  const url = URL.createObjectURL(f), a = document.createElement("a");
  a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  v.descargado = Date.now(); Datos.guardar();
}

async function accion(b) {
  const acc = b.dataset.acc, v = actual && Datos.viaje(actual);
  switch (acc) {
    case "lista": return irA(null);
    case "abrir": return irA(b.dataset.id);
    case "crear": {
      const nombre = $("#nv-nombre").value.trim();
      if (!nombre) { aviso("Ponle un nombre al viaje.", true); return; }
      const viajero = $("#nv-viajero").value.trim() || "Yo";
      Datos.ajustes.viajero = viajero;
      const nv = {
        id: nuevoId(), nombre, destino: $("#nv-destino").value.trim(),
        inicio: $("#nv-inicio").value || HOY, fin: $("#nv-fin").value || "",
        viajero, companeros: $("#nv-companeros").value.split(",").map(s => s.trim()).filter(s => s && s !== viajero),
        estado: "abierto", creado: Date.now(), gastos: [],
      };
      Datos.viajes.push(nv); Datos.guardar();
      navigator.storage?.persist?.(); // que el navegador no borre las fotos por falta de espacio
      return irA(nv.id);
    }
    case "guardar-gasto": return guardarGasto(v);
    case "editar": editando = b.dataset.id; limpiarPendientes(); pintar(); $("#form-gasto").scrollIntoView({ behavior: "smooth" }); return;
    case "cancelar": editando = null; limpiarPendientes(); return pintar();
    case "borrar-gasto": return borrarGasto(v);
    case "quitar-foto": quitarFotos.add(b.dataset.id); return repintarForm(v);
    case "quitar-pendiente": { const [p] = pendientes.splice(Number(b.dataset.i), 1); URL.revokeObjectURL(p.url); return repintarForm(v); }
    case "ver-foto": if (Fotos.url[b.dataset.id]) window.open(Fotos.url[b.dataset.id], "_blank"); return;
    case "anadir-companero": {
      const n = $("#nuevo-companero").value.trim();
      if (n && !personas(v).includes(n)) { v.companeros = [...(v.companeros || []), n]; Datos.guardar(); }
      return pintar();
    }
    case "quitar-companero": {
      const n = b.dataset.nombre;
      if (v.gastos.some(g => g.pagadoPor === n)) { aviso(`${n} pagó algún gasto: cámbialo antes de quitarlo.`, true); return; }
      v.companeros = v.companeros.filter(c => c !== n);
      v.gastos.forEach(g => { g.con = (g.con || []).filter(c => c !== n); });
      Datos.guardar(); return pintar();
    }
    case "cerrar": {
      if (!v.gastos.length) { aviso("No hay gastos que cerrar.", true); return; }
      const sinFoto = v.gastos.filter(g => !g.fotos.length).length;
      if (!confirm(`¿Cerrar «${v.nombre}»?${sinFoto ? `\n\n${sinFoto} gasto(s) no tienen foto.` : ""}\n\nSe descargará el ZIP. Podrás reabrirlo si hace falta.`)) return;
      v.estado = "cerrado"; v.cerrado = Date.now(); Datos.guardar(); editando = null; limpiarPendientes();
      pintar(); return descargar(v);
    }
    case "descargar": return descargar(v);
    case "compartir": {
      const f = await generarZip(v);
      try { await navigator.share({ files: [f], title: f.name }); v.descargado = Date.now(); Datos.guardar(); }
      catch (e) { if (e.name !== "AbortError") aviso("No se pudo compartir; usa Descargar.", true); }
      return;
    }
    case "reabrir": v.estado = "abierto"; delete v.cerrado; Datos.guardar(); return pintar();
    case "borrar-viaje": {
      if (!v.descargado && !confirm("Aún no has descargado el ZIP de este viaje. ¿Seguro?")) return;
      if (prompt(`Se borrarán gastos y fotos de este móvil. Escribe BORRAR para confirmar.`)?.trim().toUpperCase() !== "BORRAR") return;
      for (const g of v.gastos) for (const f of g.fotos) await Fotos.borrar(f.id).catch(() => {});
      Datos.viajes = Datos.viajes.filter(x => x !== v); Datos.guardar();
      return irA(null);
    }
  }
}

// Repinta el formulario sin perder lo que ya se ha escrito.
function repintarForm(v) {
  const vals = { imp: $("#g-importe").value, fecha: $("#g-fecha").value, com: $("#g-comentario").value,
    mot: document.querySelector('input[name="motivo"]:checked')?.value, pag: $("#g-pagado")?.value,
    con: [...document.querySelectorAll('input[name="con"]:checked')].map(c => c.value) };
  $("#form-gasto").outerHTML = formularioGasto(v);
  $("#g-importe").value = vals.imp; $("#g-fecha").value = vals.fecha; $("#g-comentario").value = vals.com;
  if (vals.mot) document.querySelector(`input[name="motivo"][value="${vals.mot}"]`).checked = true;
  if ($("#g-pagado")) $("#g-pagado").value = vals.pag;
  document.querySelectorAll('input[name="con"]').forEach(c => { c.checked = vals.con.includes(c.value); });
}

async function anadirFotos(input) {
  const v = Datos.viaje(actual);
  for (const file of input.files) {
    let blob = file, ext = extDe(file.type);
    try { blob = await reducirFoto(file); ext = "jpg"; }
    catch (e) { if (!file.type.startsWith("image/")) { aviso(`${file.name}: no es una imagen.`, true); continue; } } // p. ej. HEIC fuera de Safari: se guarda tal cual
    pendientes.push({ blob, ext, url: URL.createObjectURL(blob) });
  }
  input.value = "";
  repintarForm(v);
}

/* ---------- Arranque ---------- */
document.addEventListener("click", ev => {
  let b = ev.target.closest("[data-acc]"); if (!b) return;
  // En la lista de un viaje abierto, tocar la miniatura abre la edición del gasto.
  if (b.dataset.acc === "ver-foto") b = b.closest(".gasto[data-acc]") || b;
  ev.preventDefault(); accion(b);
});
document.addEventListener("change", ev => { if (ev.target.matches("[data-fotos]")) anadirFotos(ev.target); });
document.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && ev.target.id === "g-importe") { ev.preventDefault(); $("#g-comentario").focus(); }
  if (ev.key === "Enter" && ev.target.id === "nuevo-companero") { ev.preventDefault(); accion({ dataset: { acc: "anadir-companero" } }); }
});

window.addEventListener("DOMContentLoaded", async () => {
  Datos.cargar();
  try { actual = localStorage.getItem(CLAVE + "-actual") || null; } catch (e) {}
  pintar();
  try { await Fotos.cargar(); pintar(); } catch (e) { aviso("Este navegador no permite guardar fotos (¿modo privado?).", true); }
});
