"""Gastos de viaje: registrar gastos con foto del ticket y exportar al cerrar.

Sin base de datos: cada viaje es una carpeta en datos/<slug>/ con un
viaje.json y las fotos originales en fotos/.
"""

import csv
import io
import json
import os
import re
import shutil
import tempfile
import unicodedata
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path

from flask import (Flask, abort, flash, redirect, render_template, request,
                   send_file, send_from_directory, url_for)
from jinja2 import DictLoader
from werkzeug.utils import secure_filename

RAIZ = Path(__file__).resolve().parent
DATOS = Path(os.environ.get("GASTOS_DATOS", RAIZ / "datos"))

# clave -> (etiqueta, grupo del resumen). El orden es el de los desplegables.
CATEGORIAS = {
    "desayuno": ("Desayuno", "Comida"),
    "comida": ("Comida", "Comida"),
    "cena": ("Cena", "Comida"),
    "taxi": ("Taxi / VTC", "Transporte"),
    "metro": ("Metro / bus", "Transporte"),
    "tren": ("Tren", "Transporte"),
    "avion": ("Avión", "Transporte"),
    "coche": ("Coche alquiler / combustible", "Transporte"),
    "parking": ("Parking / peaje", "Transporte"),
    "alojamiento": ("Alojamiento", "Otros"),
    "otros": ("Otros", "Otros"),
}
GRUPOS = ("Comida", "Transporte", "Otros")

EXTENSIONES_FOTO = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif", ".pdf"}
RE_SLUG = re.compile(r"^[a-z0-9-]{1,80}$")
RE_ID = re.compile(r"^[a-f0-9]{8,32}$")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("GASTOS_SECRET", "solo-red-local")
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024  # varias fotos de móvil


# ---------------------------------------------------------------- utilidades

def slugify(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto[:60] or "viaje"


def parse_importe(texto):
    """'12,50' / '12.50' / '1.234,56' -> céntimos (int). ValueError si no vale."""
    t = (texto or "").strip().replace("€", "").replace(" ", "")
    if not t:
        raise ValueError("importe vacío")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    valor = round(float(t) * 100)
    if valor < 0:
        raise ValueError("importe negativo")
    return valor


def euros(cent, simbolo=True):
    """Céntimos -> '1.234,56 €' (formato español)."""
    s = f"{cent / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} €" if simbolo else s


def parse_fecha(texto, defecto=None):
    try:
        return date.fromisoformat((texto or "").strip()).isoformat()
    except ValueError:
        return defecto


app.jinja_env.filters["euros"] = euros


# ------------------------------------------------------------- persistencia

def ruta_viaje(slug):
    if not RE_SLUG.match(slug or ""):
        abort(404)
    return DATOS / slug


def cargar(slug):
    fichero = ruta_viaje(slug) / "viaje.json"
    if not fichero.exists():
        abort(404)
    return json.loads(fichero.read_text(encoding="utf-8"))


def guardar(viaje):
    carpeta = ruta_viaje(viaje["slug"])
    carpeta.mkdir(parents=True, exist_ok=True)
    tmp = carpeta / "viaje.json.tmp"
    tmp.write_text(json.dumps(viaje, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, carpeta / "viaje.json")


def listar_viajes():
    if not DATOS.exists():
        return []
    viajes = []
    for f in DATOS.glob("*/viaje.json"):
        try:
            viajes.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    # abiertos primero, luego por fecha de inicio más reciente
    viajes.sort(key=lambda v: v.get("inicio") or "", reverse=True)
    viajes.sort(key=lambda v: v.get("estado") == "cerrado")
    return viajes


def slug_libre(base):
    slug, n = base, 2
    while (DATOS / slug).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


def gastos_ordenados(viaje):
    return sorted(viaje["gastos"], key=lambda g: (g["fecha"], g["creado"]))


def buscar_gasto(viaje, gasto_id):
    for g in viaje["gastos"]:
        if g["id"] == gasto_id:
            return g
    abort(404)


def guardar_fotos(viaje, gasto, ficheros):
    carpeta = ruta_viaje(viaje["slug"]) / "fotos"
    carpeta.mkdir(parents=True, exist_ok=True)
    for f in ficheros:
        if not f or not f.filename:
            continue
        ext = Path(secure_filename(f.filename)).suffix.lower()
        if ext not in EXTENSIONES_FOTO:
            flash(f"Ignorado {f.filename}: formato no admitido.")
            continue
        nombre = f"{gasto['id']}_{uuid.uuid4().hex[:6]}{ext}"
        f.save(carpeta / nombre)
        gasto["fotos"].append(nombre)


def borrar_fotos(viaje, nombres):
    carpeta = ruta_viaje(viaje["slug"]) / "fotos"
    for n in nombres:
        try:
            (carpeta / Path(n).name).unlink()
        except FileNotFoundError:
            pass


# ------------------------------------------------------------------ resumen

def resumen(viaje):
    """Totales por grupo, por categoría y por quién pagó."""
    por_grupo = {g: 0 for g in GRUPOS}
    por_categoria = {}
    por_persona = {}
    for g in viaje["gastos"]:
        etiqueta, grupo = CATEGORIAS.get(g["categoria"], CATEGORIAS["otros"])
        por_grupo[grupo] += g["importe"]
        por_categoria[etiqueta] = por_categoria.get(etiqueta, 0) + g["importe"]
        por_persona[g["pagado_por"]] = por_persona.get(g["pagado_por"], 0) + g["importe"]
    return {
        "total": sum(por_grupo.values()),
        "por_grupo": por_grupo,
        "por_categoria": por_categoria,
        "por_persona": por_persona,
        "n_gastos": len(viaje["gastos"]),
        "n_fotos": sum(len(g["fotos"]) for g in viaje["gastos"]),
    }


def nombre_foto(n, gasto, k, total, ext):
    """01_2026-10-15_cena_24,50EUR[_2].jpg — el número casa con la fila del resumen."""
    base = f"{n:02d}_{gasto['fecha']}_{gasto['categoria']}_{euros(gasto['importe'], False)}EUR"
    if total > 1:
        base += f"_{k}"
    return base.replace(".", "") + ext  # sin separador de miles para no liar extensiones


def generar_csv(viaje):
    """CSV con ; y BOM para que Excel en castellano lo abra bien."""
    salida = io.StringIO()
    w = csv.writer(salida, delimiter=";")
    w.writerow(["Nº", "Fecha", "Categoría", "Grupo", "Importe (€)", "Pagado por",
                "Con", "Comentario", "Fotos"])
    for n, g in enumerate(gastos_ordenados(viaje), 1):
        etiqueta, grupo = CATEGORIAS.get(g["categoria"], CATEGORIAS["otros"])
        fotos = [nombre_foto(n, g, k, len(g["fotos"]), Path(f).suffix)
                 for k, f in enumerate(g["fotos"], 1)]
        w.writerow([n, g["fecha"], etiqueta, grupo, euros(g["importe"], False),
                    g["pagado_por"], ", ".join(g.get("con", [])), g["comentario"],
                    " | ".join(fotos)])
    r = resumen(viaje)
    w.writerow([])
    for grupo in GRUPOS:
        w.writerow(["", "", f"Total {grupo}", "", euros(r["por_grupo"][grupo], False)])
    w.writerow(["", "", "TOTAL", "", euros(r["total"], False)])
    return "﻿" + salida.getvalue()


def generar_txt(viaje):
    r = resumen(viaje)
    lineas = [
        f"RESUMEN DE GASTOS — {viaje['nombre']}",
        f"Destino: {viaje.get('destino') or '-'}",
        f"Fechas: {viaje.get('inicio') or '?'} a {viaje.get('fin') or '?'}",
        f"Viajeros: {', '.join([viaje['viajero']] + viaje['companeros'])}",
        "",
        "POR GRUPO",
    ]
    lineas += [f"  {g:<12} {euros(r['por_grupo'][g]):>14}" for g in GRUPOS]
    lineas += [f"  {'TOTAL':<12} {euros(r['total']):>14}", "", "POR CATEGORÍA"]
    lineas += [f"  {c:<30} {euros(v):>14}" for c, v in r["por_categoria"].items()]
    lineas += ["", "PAGADO POR"]
    lineas += [f"  {p:<30} {euros(v):>14}" for p, v in r["por_persona"].items()]
    lineas += ["", f"{r['n_gastos']} gastos, {r['n_fotos']} fotos. Detalle en resumen.csv."]
    return "\n".join(lineas) + "\n"


def generar_zip(viaje):
    """Fichero temporal con resumen.csv, resumen.txt y fotos/ renombradas."""
    carpeta_fotos = ruta_viaje(viaje["slug"]) / "fotos"
    raiz = viaje["slug"]
    tmp = tempfile.TemporaryFile()
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{raiz}/resumen.csv", generar_csv(viaje))
        z.writestr(f"{raiz}/resumen.txt", generar_txt(viaje))
        for n, g in enumerate(gastos_ordenados(viaje), 1):
            for k, f in enumerate(g["fotos"], 1):
                origen = carpeta_fotos / f
                if origen.exists():
                    destino = nombre_foto(n, g, k, len(g["fotos"]), Path(f).suffix.lower())
                    # las fotos ya vienen comprimidas: no recomprimir en la Pi
                    z.write(origen, f"{raiz}/fotos/{destino}", zipfile.ZIP_STORED)
    tmp.seek(0)
    return tmp


# -------------------------------------------------------------------- rutas

def personas(viaje):
    return [viaje["viajero"]] + viaje["companeros"]


def exigir_abierto(viaje):
    if viaje["estado"] == "cerrado":
        flash("El viaje está cerrado. Reábrelo para modificarlo.")
        return redirect(url_for("ver_viaje", slug=viaje["slug"]))
    return None


@app.route("/")
def inicio():
    viajes = listar_viajes()
    totales = {v["slug"]: sum(g["importe"] for g in v["gastos"]) for v in viajes}
    return render_template("inicio.html", viajes=viajes, totales=totales,
                           hoy=date.today().isoformat())


@app.post("/viaje/nuevo")
def nuevo_viaje():
    nombre = request.form.get("nombre", "").strip()
    if not nombre:
        flash("El viaje necesita un nombre.")
        return redirect(url_for("inicio"))
    companeros = [c.strip() for c in request.form.get("companeros", "").split(",") if c.strip()]
    inicio_ = parse_fecha(request.form.get("inicio"), date.today().isoformat())
    viaje = {
        "slug": slug_libre(slugify(f"{inicio_}-{nombre}")),
        "nombre": nombre,
        "destino": request.form.get("destino", "").strip(),
        "inicio": inicio_,
        "fin": parse_fecha(request.form.get("fin")),
        "viajero": request.form.get("viajero", "").strip() or "Yo",
        "companeros": companeros,
        "estado": "abierto",
        "creado": datetime.now().isoformat(timespec="seconds"),
        "cerrado_en": None,
        "gastos": [],
    }
    guardar(viaje)
    return redirect(url_for("ver_viaje", slug=viaje["slug"]))


@app.route("/viaje/<slug>")
def ver_viaje(slug):
    viaje = cargar(slug)
    hoy = date.today().isoformat()
    fecha_defecto = hoy
    if viaje.get("fin") and hoy > viaje["fin"]:
        fecha_defecto = viaje["fin"]
    return render_template("viaje.html", viaje=viaje, gastos=gastos_ordenados(viaje),
                           r=resumen(viaje), categorias=CATEGORIAS, grupos=GRUPOS,
                           personas=personas(viaje), fecha_defecto=fecha_defecto)


@app.post("/viaje/<slug>/companero")
def anadir_companero(slug):
    viaje = cargar(slug)
    if (r := exigir_abierto(viaje)):
        return r
    nombre = request.form.get("nombre", "").strip()
    if nombre and nombre not in personas(viaje):
        viaje["companeros"].append(nombre)
        guardar(viaje)
    return redirect(url_for("ver_viaje", slug=slug))


@app.post("/viaje/<slug>/companero/quitar")
def quitar_companero(slug):
    viaje = cargar(slug)
    if (r := exigir_abierto(viaje)):
        return r
    nombre = request.form.get("nombre", "")
    if any(g["pagado_por"] == nombre for g in viaje["gastos"]):
        flash(f"{nombre} figura como pagador de algún gasto; cámbialo antes de quitarlo.")
    elif nombre in viaje["companeros"]:
        viaje["companeros"].remove(nombre)
        for g in viaje["gastos"]:
            g["con"] = [c for c in g.get("con", []) if c != nombre]
        guardar(viaje)
    return redirect(url_for("ver_viaje", slug=slug))


def datos_gasto(viaje, form, gasto):
    """Rellena gasto desde el formulario. Devuelve mensaje de error o None."""
    try:
        gasto["importe"] = parse_importe(form.get("importe"))
    except ValueError:
        return "Importe no válido. Usa por ejemplo 12,50."
    categoria = form.get("categoria", "otros")
    gasto["categoria"] = categoria if categoria in CATEGORIAS else "otros"
    gasto["fecha"] = parse_fecha(form.get("fecha"), date.today().isoformat())
    gasto["comentario"] = form.get("comentario", "").strip()
    pagado = form.get("pagado_por", viaje["viajero"])
    gasto["pagado_por"] = pagado if pagado in personas(viaje) else viaje["viajero"]
    gasto["con"] = [c for c in form.getlist("con") if c in personas(viaje)
                    and c != gasto["pagado_por"]]
    return None


@app.post("/viaje/<slug>/gasto")
def anadir_gasto(slug):
    viaje = cargar(slug)
    if (r := exigir_abierto(viaje)):
        return r
    gasto = {"id": uuid.uuid4().hex[:12], "fotos": [],
             "creado": datetime.now().isoformat(timespec="seconds")}
    if (error := datos_gasto(viaje, request.form, gasto)):
        flash(error)
        return redirect(url_for("ver_viaje", slug=slug))
    guardar_fotos(viaje, gasto, request.files.getlist("fotos"))
    viaje["gastos"].append(gasto)
    guardar(viaje)
    flash(f"Gasto añadido: {CATEGORIAS[gasto['categoria']][0]} {euros(gasto['importe'])}.")
    return redirect(url_for("ver_viaje", slug=slug))


@app.route("/viaje/<slug>/gasto/<gasto_id>", methods=["GET", "POST"])
def editar_gasto(slug, gasto_id):
    viaje = cargar(slug)
    if not RE_ID.match(gasto_id):
        abort(404)
    gasto = buscar_gasto(viaje, gasto_id)
    if request.method == "POST":
        if (r := exigir_abierto(viaje)):
            return r
        if (error := datos_gasto(viaje, request.form, gasto)):
            flash(error)
            return redirect(url_for("editar_gasto", slug=slug, gasto_id=gasto_id))
        quitar = [f for f in request.form.getlist("quitar_foto") if f in gasto["fotos"]]
        borrar_fotos(viaje, quitar)
        gasto["fotos"] = [f for f in gasto["fotos"] if f not in quitar]
        guardar_fotos(viaje, gasto, request.files.getlist("fotos"))
        guardar(viaje)
        return redirect(url_for("ver_viaje", slug=slug))
    return render_template("gasto.html", viaje=viaje, g=gasto, categorias=CATEGORIAS,
                           personas=personas(viaje))


@app.post("/viaje/<slug>/gasto/<gasto_id>/borrar")
def borrar_gasto(slug, gasto_id):
    viaje = cargar(slug)
    if (r := exigir_abierto(viaje)):
        return r
    gasto = buscar_gasto(viaje, gasto_id)
    borrar_fotos(viaje, gasto["fotos"])
    viaje["gastos"].remove(gasto)
    guardar(viaje)
    return redirect(url_for("ver_viaje", slug=slug))


@app.route("/viaje/<slug>/foto/<nombre>")
def foto(slug, nombre):
    return send_from_directory(ruta_viaje(slug) / "fotos", secure_filename(nombre))


@app.post("/viaje/<slug>/estado")
def cambiar_estado(slug):
    viaje = cargar(slug)
    if request.form.get("accion") == "cerrar":
        viaje["estado"] = "cerrado"
        viaje["cerrado_en"] = datetime.now().isoformat(timespec="seconds")
    else:
        viaje["estado"] = "abierto"
        viaje["cerrado_en"] = None
    guardar(viaje)
    return redirect(url_for("ver_viaje", slug=slug))


@app.route("/viaje/<slug>/descargar")
def descargar(slug):
    viaje = cargar(slug)
    if viaje["estado"] != "cerrado":
        flash("Cierra el viaje antes de descargar el resumen.")
        return redirect(url_for("ver_viaje", slug=slug))
    return send_file(generar_zip(viaje), mimetype="application/zip",
                     as_attachment=True, download_name=f"gastos_{slug}.zip")


@app.post("/viaje/<slug>/borrar")
def borrar_viaje(slug):
    viaje = cargar(slug)
    if request.form.get("confirmar") != viaje["nombre"]:
        flash("Para borrar el viaje escribe su nombre exacto.")
        return redirect(url_for("ver_viaje", slug=slug))
    shutil.rmtree(ruta_viaje(slug))
    flash(f"Viaje «{viaje['nombre']}» borrado.")
    return redirect(url_for("inicio"))


@app.errorhandler(413)
def demasiado_grande(_):
    flash("Las fotos superan el tamaño máximo (60 MB por envío). Súbelas en varias veces.")
    return redirect(request.referrer or url_for("inicio"))


# --------------------------------------------------------------- plantillas

PLANTILLAS = {
    "base.html": """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{% block titulo %}Gastos de viaje{% endblock %}</title>
<style>
 :root { --borde:#d0d5dd; --suave:#f4f6f8; --acento:#1d4ed8; --peligro:#b42318; }
 * { box-sizing:border-box; }
 body { font-family:system-ui,sans-serif; margin:0 auto; max-width:820px; padding:12px 16px 40px;
        color:#1f2328; background:#fff; line-height:1.4; }
 h1 { font-size:1.4rem; margin:.4rem 0; } h2 { font-size:1.1rem; margin:1.4rem 0 .5rem; }
 a { color:var(--acento); }
 .caja { border:1px solid var(--borde); border-radius:8px; padding:12px; margin:10px 0; background:#fff; }
 .suave { background:var(--suave); }
 label { display:block; font-size:.85rem; color:#555; margin-top:8px; }
 input, select, textarea { width:100%; padding:9px; font-size:1rem; border:1px solid var(--borde);
        border-radius:6px; background:#fff; }
 textarea { min-height:60px; }
 .fila { display:flex; gap:10px; flex-wrap:wrap; } .fila > * { flex:1 1 140px; min-width:0; }
 button, .boton { display:inline-block; padding:9px 14px; font-size:1rem; border-radius:6px;
        border:1px solid var(--acento); background:var(--acento); color:#fff; cursor:pointer;
        text-decoration:none; margin-top:10px; }
 .secundario { background:#fff; color:var(--acento); }
 .peligro { background:#fff; color:var(--peligro); border-color:var(--peligro); }
 .mini { padding:3px 8px; font-size:.85rem; margin:0; }
 .check { display:inline-flex; align-items:center; gap:4px; margin:4px 12px 0 0; color:#1f2328; font-size:1rem; }
 .check input { width:auto; }
 table { width:100%; border-collapse:collapse; } td, th { padding:5px 4px; text-align:left;
        border-bottom:1px solid var(--suave); } .num { text-align:right; white-space:nowrap; }
 .gasto { display:flex; gap:10px; align-items:flex-start; }
 .gasto .info { flex:1; } .gasto .imp { font-weight:600; white-space:nowrap; }
 .miniaturas img { width:56px; height:56px; object-fit:cover; border-radius:4px; border:1px solid var(--borde); }
 .etiqueta { font-size:.75rem; padding:1px 7px; border-radius:10px; background:var(--suave); }
 .abierto { background:#dcfae6; } .cerrado { background:#e4e7ec; }
 .aviso { background:#fffaeb; border:1px solid #fedf89; padding:8px 12px; border-radius:6px; margin:8px 0; }
 .gris { color:#667085; font-size:.9rem; }
 details summary { cursor:pointer; color:var(--acento); }
 form.en-linea { display:inline; }
</style></head><body>
<p><a href="{{ url_for('inicio') }}">← Viajes</a></p>
{% for m in get_flashed_messages() %}<div class="aviso">{{ m }}</div>{% endfor %}
{% block cuerpo %}{% endblock %}
</body></html>""",

    "inicio.html": """{% extends "base.html" %}{% block cuerpo %}
<h1>Gastos de viaje</h1>
<details class="caja suave" {% if not viajes %}open{% endif %}>
 <summary><strong>+ Nuevo viaje</strong></summary>
 <form method="post" action="{{ url_for('nuevo_viaje') }}">
  <label>Nombre del viaje</label><input name="nombre" required placeholder="Feria Milán 2026">
  <label>Destino</label><input name="destino" placeholder="Milán">
  <div class="fila">
   <div><label>Inicio</label><input type="date" name="inicio" value="{{ hoy }}"></div>
   <div><label>Fin</label><input type="date" name="fin"></div>
  </div>
  <label>Tu nombre</label><input name="viajero" placeholder="Yo">
  <label>Compañeros (separados por comas)</label><input name="companeros" placeholder="Ana, Luis">
  <button>Crear viaje</button>
 </form>
</details>
{% for v in viajes %}
 <div class="caja">
  <a href="{{ url_for('ver_viaje', slug=v.slug) }}"><strong>{{ v.nombre }}</strong></a>
  <span class="etiqueta {{ v.estado }}">{{ v.estado }}</span>
  <div class="gris">{{ v.destino }} · {{ v.inicio }}{% if v.fin %} → {{ v.fin }}{% endif %}
   · {{ v.gastos|length }} gastos · <strong>{{ totales[v.slug]|euros }}</strong></div>
 </div>
{% else %}<p class="gris">Aún no hay viajes.</p>{% endfor %}
{% endblock %}""",

    "viaje.html": """{% extends "base.html" %}{% block titulo %}{{ viaje.nombre }}{% endblock %}
{% block cuerpo %}
{% set abierto = viaje.estado == 'abierto' %}
<h1>{{ viaje.nombre }} <span class="etiqueta {{ viaje.estado }}">{{ viaje.estado }}</span></h1>
<div class="gris">{{ viaje.destino }} · {{ viaje.inicio }}{% if viaje.fin %} → {{ viaje.fin }}{% endif %}</div>

<div class="caja suave">
 <strong>Viajeros:</strong> {{ viaje.viajero }}
 {% for c in viaje.companeros %}· {{ c }}
  {% if abierto %}<form class="en-linea" method="post" action="{{ url_for('quitar_companero', slug=viaje.slug) }}">
   <input type="hidden" name="nombre" value="{{ c }}"><button class="mini peligro" title="Quitar">×</button></form>{% endif %}
 {% endfor %}
 {% if abierto %}
 <form method="post" action="{{ url_for('anadir_companero', slug=viaje.slug) }}" class="fila" style="align-items:end">
  <div><label>Añadir compañero</label><input name="nombre" required></div>
  <div style="flex:0 0 auto"><button class="secundario">Añadir</button></div>
 </form>
 {% endif %}
</div>

{% if abierto %}
<h2>Nuevo gasto</h2>
<form class="caja" method="post" action="{{ url_for('anadir_gasto', slug=viaje.slug) }}" enctype="multipart/form-data">
 {% with g=None %}{% include "_campos_gasto.html" %}{% endwith %}
 <label>Fotos del ticket</label>
 <input type="file" name="fotos" accept="image/*,application/pdf" multiple>
 <button>Guardar gasto</button>
</form>
{% endif %}

<h2>Resumen</h2>
<div class="caja">
 <table>
  {% for gr in grupos %}<tr><td>{{ gr }}</td><td class="num">{{ r.por_grupo[gr]|euros }}</td></tr>{% endfor %}
  <tr><th>Total</th><th class="num">{{ r.total|euros }}</th></tr>
 </table>
 {% if r.por_persona|length > 1 %}
 <p class="gris" style="margin-bottom:0">Pagado por:
  {% for p, v in r.por_persona.items() %}{{ p }} {{ v|euros }}{% if not loop.last %} · {% endif %}{% endfor %}</p>
 {% endif %}
</div>

<h2>Gastos ({{ r.n_gastos }})</h2>
{% for g in gastos %}
 <div class="caja gasto">
  <div class="info">
   <strong>{{ loop.index }}. {{ categorias[g.categoria][0] }}</strong>
   <span class="gris">{{ g.fecha }} · pagó {{ g.pagado_por }}{% if g.con %} · con {{ g.con|join(', ') }}{% endif %}</span>
   {% if g.comentario %}<div>{{ g.comentario }}</div>{% endif %}
   <div class="miniaturas">
    {% for f in g.fotos %}<a href="{{ url_for('foto', slug=viaje.slug, nombre=f) }}" target="_blank">
     {% if f.endswith('.pdf') %}<span class="etiqueta">PDF</span>{% else %}
     <img src="{{ url_for('foto', slug=viaje.slug, nombre=f) }}" alt="ticket" loading="lazy">{% endif %}</a>{% endfor %}
    {% if not g.fotos %}<span class="gris">sin foto</span>{% endif %}
   </div>
  </div>
  <div style="text-align:right">
   <div class="imp">{{ g.importe|euros }}</div>
   {% if abierto %}<a href="{{ url_for('editar_gasto', slug=viaje.slug, gasto_id=g.id) }}">editar</a>{% endif %}
  </div>
 </div>
{% else %}<p class="gris">Sin gastos todavía.</p>{% endfor %}

<h2>Cierre</h2>
<div class="caja suave">
 {% if abierto %}
  <p>Al cerrar el viaje podrás descargar un ZIP con las fotos renombradas y el resumen.</p>
  <form method="post" action="{{ url_for('cambiar_estado', slug=viaje.slug) }}">
   <input type="hidden" name="accion" value="cerrar"><button>Cerrar viaje</button></form>
 {% else %}
  <p>Cerrado el {{ viaje.cerrado_en[:10] }}.</p>
  <a class="boton" href="{{ url_for('descargar', slug=viaje.slug) }}">Descargar ZIP (fotos + resumen)</a>
  <form method="post" action="{{ url_for('cambiar_estado', slug=viaje.slug) }}">
   <input type="hidden" name="accion" value="abrir"><button class="secundario">Reabrir viaje</button></form>
 {% endif %}
 <details style="margin-top:14px"><summary>Borrar viaje</summary>
  <form method="post" action="{{ url_for('borrar_viaje', slug=viaje.slug) }}">
   <label>Escribe «{{ viaje.nombre }}» para confirmar. Se borran gastos y fotos.</label>
   <input name="confirmar" autocomplete="off"><button class="peligro">Borrar definitivamente</button>
  </form></details>
</div>
{% endblock %}""",

    "_campos_gasto.html": """
 <div class="fila">
  <div><label>Importe (€)</label><input name="importe" inputmode="decimal" required placeholder="12,50"
       value="{{ (g.importe|euros(false)) if g else '' }}"></div>
  <div><label>Fecha</label><input type="date" name="fecha" value="{{ g.fecha if g else fecha_defecto }}"></div>
 </div>
 <label>Motivo</label>
 <select name="categoria">
  {% for clave, (etiqueta, grupo) in categorias.items() %}
   <option value="{{ clave }}" {% if g and g.categoria == clave %}selected{% endif %}>{{ grupo }} — {{ etiqueta }}</option>
  {% endfor %}
 </select>
 <label>Comentario</label><textarea name="comentario" placeholder="Cena con cliente X">{{ g.comentario if g else '' }}</textarea>
 {% if personas|length > 1 %}
 <label>Pagado por</label>
 <select name="pagado_por">{% for p in personas %}
  <option {% if g and g.pagado_por == p %}selected{% endif %}>{{ p }}</option>{% endfor %}</select>
 <label>Con (compañeros incluidos en el gasto)</label>
 <div>{% for p in personas %}<label class="check"><input type="checkbox" name="con" value="{{ p }}"
   {% if g and p in g.con %}checked{% endif %}> {{ p }}</label>{% endfor %}</div>
 {% endif %}
""",

    "gasto.html": """{% extends "base.html" %}{% block cuerpo %}
<p><a href="{{ url_for('ver_viaje', slug=viaje.slug) }}">← {{ viaje.nombre }}</a></p>
<h1>Editar gasto</h1>
<form class="caja" method="post" enctype="multipart/form-data">
 {% include "_campos_gasto.html" %}
 {% if g.fotos %}<label>Fotos actuales (marca para quitar)</label>
  <div class="miniaturas">{% for f in g.fotos %}<label class="check">
   <input type="checkbox" name="quitar_foto" value="{{ f }}">
   {% if f.endswith('.pdf') %}<span class="etiqueta">PDF</span>{% else %}
   <img src="{{ url_for('foto', slug=viaje.slug, nombre=f) }}" alt="ticket">{% endif %}</label>{% endfor %}</div>
 {% endif %}
 <label>Añadir fotos</label><input type="file" name="fotos" accept="image/*,application/pdf" multiple>
 <button>Guardar cambios</button>
</form>
<form method="post" action="{{ url_for('borrar_gasto', slug=viaje.slug, gasto_id=g.id) }}"
      onsubmit="return confirm('¿Borrar este gasto y sus fotos?')">
 <button class="peligro">Borrar gasto</button></form>
{% endblock %}""",
}
app.jinja_loader = DictLoader(PLANTILLAS)


if __name__ == "__main__":
    DATOS.mkdir(parents=True, exist_ok=True)
    # 0.0.0.0 para usarla desde el móvil en la red local. Nunca exponer a internet.
    app.run(host=os.environ.get("GASTOS_HOST", "0.0.0.0"),
            port=int(os.environ.get("GASTOS_PORT", "5001")))
