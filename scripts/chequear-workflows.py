"""Detecta lineas mal indentadas dentro de bloques escalares de YAML (run: |, etc).

Existe porque la primera version de este chequeo buscaba `run: |` con EXACTAMENTE
diez espacios de indentacion, y auto-etiquetar.yml lo tiene con ocho. Reporto "OK"
sobre un archivo que nunca habia mirado: el verificador tenia el mismo punto ciego
que el codigo que venia a verificar.

Ahora detecta el bloque a cualquier profundidad y compara contra la indentacion
real de su contenido.
"""
import io
import re
import sys

BLOQUE = re.compile(r'^(\s*)[\w.-]+:\s*[|>][-+]?\s*$')
# Una clave YAML valida: `algo:` o `- algo:`, opcionalmente entre comillas.
CLAVE = re.compile(r"""^\s*(-\s+)?("[^"]+"|'[^']+'|[\w.$-]+)\s*:(\s|$)""")


def revisar(path):
    lineas = io.open(path, encoding='utf-8').read().split('\n')
    problemas = []
    i = 0
    while i < len(lineas):
        m = BLOQUE.match(lineas[i])
        if not m:
            i += 1
            continue

        indent_clave = len(m.group(1))

        # La indentacion del bloque la fija su primera linea no vacia.
        j = i + 1
        while j < len(lineas) and not lineas[j].strip():
            j += 1
        if j >= len(lineas):
            break
        indent_bloque = len(lineas[j]) - len(lineas[j].lstrip())
        if indent_bloque <= indent_clave:
            i += 1
            continue

        # Toda linea no vacia del bloque tiene que estar al menos a esa altura.
        k = j
        while k < len(lineas):
            linea = lineas[k]
            if not linea.strip():
                k += 1
                continue
            indent = len(linea) - len(linea.lstrip())

            if indent < indent_bloque:
                # Menos indentada que el contenido del bloque: o el bloque
                # termino y esto es una clave del nivel de arriba, o es texto
                # del bloque que se escapo. La diferencia es si parece una clave.
                #
                # La primera version cortaba apenas la indentacion bajaba de la
                # clave, y por eso daba OK sobre un `**Por que...:**` en columna
                # cero — que no es una clave, es markdown suelto rompiendo el
                # archivo.
                # Un comentario YAML puede ir a cualquier altura, asi que
                # tambien marca el final del bloque. Sin esta rama el chequeo
                # daba ROTO sobre ci.yml y post-deploy-smoke.yml, que llevan
                # semanas corriendo bien — y un verificador que grita sobre
                # archivos sanos se deja de mirar en dos dias.
                if CLAVE.match(linea) or linea.lstrip().startswith('#'):
                    break  # el bloque termino como corresponde
                problemas.append((k + 1, linea))
            k += 1
        i = k

    return problemas


hubo = False
for path in sys.argv[1:]:
    problemas = revisar(path)
    if problemas:
        hubo = True
        print('ROTO  %s' % path)
        for n, linea in problemas:
            print('        linea %d: %s' % (n, linea[:90]))
    else:
        print('ok    %s' % path)

sys.exit(1 if hubo else 0)
