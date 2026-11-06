import json, numpy as np, cv2
from PIL import Image
sil=(np.asarray(Image.open('out/rest_sil.png'))>127).astype(np.uint8)
f=np.asarray(Image.open('../../src/master.png').convert('RGB')).astype(np.float32)
a=(f[...,1]-np.maximum(f[...,0],f[...,2])<40)
roi=np.zeros_like(a); roi[:760]=1   # upper body: the mesh legs differ from the master's
best=None
for k in np.arange(0.96,1.10,0.01):
  for tx in range(-10,50,2):
    for ty in range(-30,31,3):
      c=512; M=np.float32([[k,0,tx+(1-k)*c],[0,k,ty]])
      w=cv2.warpAffine(sil,M,(1024,1536),flags=cv2.INTER_NEAREST)>0
      i=((w&a)&roi).sum()/max(1,((w|a)&roi).sum())
      if best is None or i>best[0]: best=(i,k,tx+(1-k)*c,ty)
print(best)
J=json.load(open('out/joints3d.json'))
s,x0,z0=J['s'],J['x0'],J['z0']
i,k,tx,ty=best
s2=s/k; print(json.dumps({'s':s2,'x0':x0-tx*s2,'z0':z0+ty*s2,'iou_upper':round(float(i),4)}))
json.dump({'s':s2,'x0':x0-tx*s2,'z0':z0+ty*s2,'iou_upper':round(float(i),4),'k':float(k),'tx':float(tx),'ty':float(ty)},open('reg.json','w'),indent=1)
