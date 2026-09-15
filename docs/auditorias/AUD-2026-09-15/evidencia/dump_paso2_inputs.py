#!/usr/bin/env python3
# Reutiliza las funciones puras de calc_fx_av.py (Fraction, sin punto flotante)
# para volcar en JSON los inputs exactos que hay que cargar por API en D1
# (Planta) y FX-AV-B (Embolsado), sin re-derivar nada a mano.
import sys, json
from fractions import Fraction as F

sys.path.insert(0, '.claude/skills/costear-auditoria/scripts')
import calc_fx_av as m

d1 = m.corre_d1()

# corre_embolsado solo usa granja[i]['consumo_real'] — se arma el minimo necesario
GRANJA_CONSUMO = [36000, 34800, 50400, 51600]
granja_min = [dict(consumo_real=c) for c in GRANJA_CONSUMO]
emb = m.corre_embolsado(d1, granja_min)

def fnum(x):
    return float(x) if isinstance(x, F) else x

out = {
    "d1": [
        {k: fnum(v) for k, v in r.items() if k not in ("p",)} | {"p": r["p"]}
        for r in d1
    ],
    "emb": [
        {k: fnum(v) for k, v in r.items() if k not in ("p",)} | {"p": r["p"]}
        for r in emb
    ],
}
print(json.dumps(out, indent=2))
