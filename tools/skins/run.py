"""Use installed tools or this workspace's portable Blender/Pillow environment."""
import os
import pathlib
import shutil
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[2]
task=sys.argv[1] if len(sys.argv)>1 else 'render'
args=sys.argv[2:]
if task=='pack':
    local=ROOT/'.cache/venv/Scripts/python.exe'
    python=str(local) if local.exists() else sys.executable
    command=[python,str(ROOT/'tools/skins/pack.py'),*args]
else:
    portable=sorted((ROOT/'.cache/sources/mh').glob('blender-*/blender.exe'))
    blender=os.environ.get('BLENDER_EXE') or shutil.which('blender') or (str(portable[-1]) if portable else None)
    if not blender:
        raise SystemExit('Blender not found. Set BLENDER_EXE or add Blender 4.5 with MPFB to PATH.')
    mode={'render':'full','check':'check','save':'save'}.get(task,task)
    command=[blender,'-b','-t',str(min(6,os.cpu_count() or 2)),'--python-exit-code','1',
             '--python',str(ROOT/'tools/skins/makehuman/build.py'),'--',mode,*args]
raise SystemExit(subprocess.call(command,cwd=ROOT))
