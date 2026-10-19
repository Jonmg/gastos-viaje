"""Batería offline: python3 pruebas.py"""

import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

_tmp = tempfile.TemporaryDirectory()
os.environ["GASTOS_DATOS"] = _tmp.name

import app as gv  # noqa: E402

JPG = b"\xff\xd8\xff\xe0" + b"0" * 100


class Utilidades(unittest.TestCase):
    def test_parse_importe(self):
        self.assertEqual(gv.parse_importe("12,50"), 1250)
        self.assertEqual(gv.parse_importe("12.5"), 1250)
        self.assertEqual(gv.parse_importe("1.234,56 €"), 123456)
        self.assertEqual(gv.parse_importe("7"), 700)
        for malo in ("", "abc", "-3"):
            with self.assertRaises(ValueError):
                gv.parse_importe(malo)

    def test_euros(self):
        self.assertEqual(gv.euros(123456), "1.234,56 €")
        self.assertEqual(gv.euros(5, False), "0,05")

    def test_nombre_foto(self):
        g = {"fecha": "2026-10-15", "categoria": "cena", "importe": 123450}
        self.assertEqual(gv.nombre_foto(3, g, 1, 1, ".jpg"), "03_2026-10-15_cena_1234,50EUR.jpg")
        self.assertEqual(gv.nombre_foto(3, g, 2, 2, ".png"), "03_2026-10-15_cena_1234,50EUR_2.png")


class Flujo(unittest.TestCase):
    def setUp(self):
        self.c = gv.app.test_client()

    def crear_viaje(self, nombre="Feria Milán"):
        r = self.c.post("/viaje/nuevo", data={"nombre": nombre, "destino": "Milán",
                                               "inicio": "2026-10-14", "fin": "2026-10-16",
                                               "viajero": "Jon", "companeros": "Ana, Luis"})
        self.assertEqual(r.status_code, 302)
        return r.headers["Location"].rsplit("/", 1)[-1]

    def gasto(self, slug, **datos):
        base = {"importe": "10", "categoria": "otros", "fecha": "2026-10-14",
                "comentario": "", "pagado_por": "Jon"}
        base.update(datos)
        fotos = base.pop("fotos", [])
        base["fotos"] = [(io.BytesIO(c), n) for n, c in fotos]
        return self.c.post(f"/viaje/{slug}/gasto", data=base,
                           content_type="multipart/form-data")

    def test_flujo_completo(self):
        slug = self.crear_viaje()
        self.assertEqual(slug, "2026-10-14-feria-milan")
        self.gasto(slug, importe="8,40", categoria="desayuno", fotos=[("t.jpg", JPG)])
        self.gasto(slug, importe="45", categoria="cena", fecha="2026-10-15", pagado_por="Ana",
                   con=["Jon", "Luis"], comentario="Cena cliente",
                   fotos=[("a.jpg", JPG), ("b.png", JPG)])
        self.gasto(slug, importe="22,30", categoria="taxi", fecha="2026-10-14")
        self.gasto(slug, importe="3", categoria="otros", fotos=[("virus.exe", b"MZ")])

        viaje = gv.cargar(slug)
        self.assertEqual(len(viaje["gastos"]), 4)
        cena = [g for g in viaje["gastos"] if g["categoria"] == "cena"][0]
        self.assertEqual(cena["con"], ["Jon", "Luis"])
        self.assertEqual(len(cena["fotos"]), 2)
        self.assertEqual([g for g in viaje["gastos"] if g["importe"] == 300][0]["fotos"], [])

        r = gv.resumen(viaje)
        self.assertEqual(r["por_grupo"], {"Comida": 5340, "Transporte": 2230, "Otros": 300})
        self.assertEqual(r["por_persona"], {"Jon": 3370, "Ana": 4500})

        page = self.c.get(f"/viaje/{slug}").get_data(as_text=True)
        self.assertIn("Cena cliente", page)
        self.assertIn("78,70 €", page)

        # descarga bloqueada hasta cerrar
        self.assertEqual(self.c.get(f"/viaje/{slug}/descargar").status_code, 302)
        self.c.post(f"/viaje/{slug}/estado", data={"accion": "cerrar"})
        self.assertEqual(self.gasto(slug, importe="1").status_code, 302)
        self.assertEqual(len(gv.cargar(slug)["gastos"]), 4)

        r = self.c.get(f"/viaje/{slug}/descargar")
        self.assertEqual(r.status_code, 200)
        z = zipfile.ZipFile(io.BytesIO(r.data))
        nombres = sorted(z.namelist())
        self.assertIn(f"{slug}/resumen.csv", nombres)
        self.assertIn(f"{slug}/resumen.txt", nombres)
        # orden por fecha: desayuno(14), taxi(14), otros(14), cena(15)
        self.assertIn(f"{slug}/fotos/01_2026-10-14_desayuno_8,40EUR.jpg", nombres)
        self.assertIn(f"{slug}/fotos/04_2026-10-15_cena_45,00EUR_1.jpg", nombres)
        self.assertIn(f"{slug}/fotos/04_2026-10-15_cena_45,00EUR_2.png", nombres)
        csv_txt = z.read(f"{slug}/resumen.csv").decode("utf-8-sig")
        self.assertIn("Total Comida;;53,40", csv_txt)
        self.assertIn("TOTAL;;78,70", csv_txt)
        self.assertIn("Transporte", z.read(f"{slug}/resumen.txt").decode())

    def test_editar_y_borrar(self):
        slug = self.crear_viaje("Editar")
        self.gasto(slug, importe="10", fotos=[("a.jpg", JPG)])
        g = gv.cargar(slug)["gastos"][0]
        self.assertEqual(self.c.get(f"/viaje/{slug}/gasto/{g['id']}").status_code, 200)
        self.c.post(f"/viaje/{slug}/gasto/{g['id']}",
                    data={"importe": "12,5", "categoria": "metro", "fecha": "2026-10-15",
                          "pagado_por": "Jon", "quitar_foto": g["fotos"][0]})
        g2 = gv.cargar(slug)["gastos"][0]
        self.assertEqual((g2["importe"], g2["categoria"], g2["fotos"]), (1250, "metro", []))
        self.assertFalse((gv.DATOS / slug / "fotos" / g["fotos"][0]).exists())
        self.c.post(f"/viaje/{slug}/gasto/{g['id']}/borrar")
        self.assertEqual(gv.cargar(slug)["gastos"], [])

    def test_companeros(self):
        slug = self.crear_viaje("Compis")
        self.c.post(f"/viaje/{slug}/companero", data={"nombre": "Marta"})
        self.assertEqual(gv.cargar(slug)["companeros"], ["Ana", "Luis", "Marta"])
        self.gasto(slug, pagado_por="Luis")
        self.c.post(f"/viaje/{slug}/companero/quitar", data={"nombre": "Luis"})
        self.assertIn("Luis", gv.cargar(slug)["companeros"])  # pagó algo: no se quita
        self.c.post(f"/viaje/{slug}/companero/quitar", data={"nombre": "Marta"})
        self.assertNotIn("Marta", gv.cargar(slug)["companeros"])

    def test_borrar_viaje_exige_nombre(self):
        slug = self.crear_viaje("Borrable")
        self.c.post(f"/viaje/{slug}/borrar", data={"confirmar": "otro"})
        self.assertTrue((gv.DATOS / slug).exists())
        self.c.post(f"/viaje/{slug}/borrar", data={"confirmar": "Borrable"})
        self.assertFalse((gv.DATOS / slug).exists())

    def test_rutas_maliciosas(self):
        self.assertEqual(self.c.get("/viaje/..%2F..%2Fetc").status_code, 404)
        slug = self.crear_viaje("Seguro")
        self.assertEqual(self.c.get(f"/viaje/{slug}/foto/..%2Fviaje.json").status_code, 404)

    def test_inicio(self):
        self.crear_viaje("Listado")
        self.assertIn("Listado", self.c.get("/").get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
