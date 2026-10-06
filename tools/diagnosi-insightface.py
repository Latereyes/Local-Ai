"""Diagnosi di insightface su Windows: quale DLL manca a mesh_core_cython e perché l'import fallisce.

Da eseguire sul PC di ComfyUI con il Python di ComfyUI:
    C:\\IA\\Packages\\ComfyUI\\venv\\Scripts\\python.exe diagnosi-insightface.py
Con --patch rende opzionale il modulo 3D (mesh_core_cython), che FaceAnalysis/IPAdapter non usano.
"""
import ctypes
import glob
import importlib.util
import os
import struct
import sys


def pe_imports(path):
    """Elenco delle DLL importate da un file PE (.pyd/.dll), senza dipendenze esterne."""
    with open(path, 'rb') as f:
        data = f.read()
    pe = struct.unpack_from('<I', data, 0x3C)[0]
    nsec = struct.unpack_from('<H', data, pe + 6)[0]
    optsize = struct.unpack_from('<H', data, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from('<H', data, opt)[0]
    dd = opt + (112 if magic == 0x20B else 96)
    imp_rva = struct.unpack_from('<I', data, dd + 8)[0]
    secs = []
    for i in range(nsec):
        s = pe + 24 + optsize + i * 40
        vsize, va, rsize, raw = struct.unpack_from('<IIII', data, s + 8)
        secs.append((va, max(vsize, rsize), raw))

    def off(rva):
        for va, size, raw in secs:
            if va <= rva < va + size:
                return rva - va + raw
        raise ValueError(rva)

    names, p = [], off(imp_rva)
    while True:
        name_rva = struct.unpack_from('<I', data, p + 12)[0]
        if not name_rva:
            break
        o = off(name_rva)
        names.append(data[o:data.index(b'\0', o)].decode())
        p += 20
    return names


print('Python  ', sys.version.split()[0], sys.executable)
import numpy  # noqa: E402
print('numpy   ', numpy.__version__, os.path.dirname(numpy.__file__))
site = os.path.dirname(os.path.dirname(numpy.__file__))
leftovers = [d for d in os.listdir(site) if d.startswith('~')]
if leftovers:
    print('Cartelle residue di installazioni interrotte (si possono cancellare):', ', '.join(leftovers))

spec = importlib.util.find_spec('insightface')
if not spec:
    sys.exit('insightface non installato')
pkg = os.path.dirname(spec.origin)
pyds = glob.glob(os.path.join(pkg, '**', 'mesh_core_cython*.pyd'), recursive=True)
print('insightface', pkg)
for pyd in pyds:
    print('\nModulo:', pyd)
    os.add_dll_directory(os.path.dirname(pyd))
    for dll in pe_imports(pyd):
        try:
            ctypes.WinDLL(dll)
            print('  ok      ', dll)
        except OSError as e:
            print('  MANCANTE', dll, '-', e)

if '--patch' in sys.argv:
    # Il modulo compilato serve solo al "mask renderer" 3D: lo rendiamo opzionale,
    # come fanno le versioni più recenti di insightface. Il riconoscimento volti non lo usa.
    targets = {
        os.path.join(pkg, 'app', '__init__.py'): 'from .mask_renderer import *',
        os.path.join(pkg, 'thirdparty', '__init__.py'): 'from . import face3d',
    }
    for path, line in targets.items():
        if not os.path.exists(path):
            continue
        src = open(path, encoding='utf-8').read()
        if line in src and 'LOCALAI_PATCH' not in src:
            src = src.replace(line, f'try:  # LOCALAI_PATCH: componente 3D opzionale\n    {line}\nexcept ImportError:\n    pass')
            open(path, 'w', encoding='utf-8').write(src)
            print('Patch applicata a', path)

print()
try:
    from insightface.app import FaceAnalysis
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(pkg)))), 'models', 'insightface')
    app = FaceAnalysis(name='buffalo_l', root=root, providers=['CPUExecutionProvider'])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    print('FACEANALYSIS_OK: insightface funziona')
except Exception as e:
    print('ANCORA ERRORE:', type(e).__name__, e)
