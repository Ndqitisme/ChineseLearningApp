"""Builds an offline animation review page and contact sheet. Run after skin:render and skin:pack (needs Pillow).

The page embeds its metadata, so it opens from Explorer without a web server.
"""
import json
import pathlib
import shutil
from PIL import Image, ImageDraw, ImageFont

ROOT=pathlib.Path(__file__).resolve().parents[2]
FRAMES=ROOT/'.cache/render3d/reference-v4/frames'
OUT=ROOT/'output/character'
OUT.mkdir(parents=True,exist_ok=True)
previews=OUT/'previews'
previews.mkdir(exist_ok=True)
for name in ('face_neutral','face_smile'):
    shutil.copyfile(FRAMES/f'{name}.png',previews/f'{name}.png')
shutil.copyfile(ROOT/'public/skins/assistant/sheet.webp',previews/'sheet.webp')
shutil.copyfile(FRAMES.parent/'validation.json',OUT/'validation.json')
skin=json.loads((ROOT/'public/skins/assistant/skin.json').read_text(encoding='utf-8'))
meta=json.loads((FRAMES/'meta.json').read_text(encoding='utf-8'))
rawdir=previews/'frames'
rawdir.mkdir(exist_ok=True)
boxes=[]
for name in meta['frames']:
    shutil.copyfile(FRAMES/f'{name}.png',rawdir/f'{name}.png')
    with Image.open(FRAMES/f'{name}.png') as im: boxes.append(im.getbbox())
crop=[max(0,min(b[0] for b in boxes)-6),max(0,min(b[1] for b in boxes)-6),
      min(460,max(b[2] for b in boxes)+6),min(840,max(b[3] for b in boxes)+6)]
labels={'idle':'Đứng','wave':'Chào','breathe':'Thở','blink':'Chớp mắt','look':'Nhìn quanh',
        'wink':'Vuốt tóc','think':'Suy nghĩ','talk':'Nói chuyện','happy':'Vui','drag':'Khi kéo','sleep':'Ngủ'}
page='''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Tiểu Mai · Xem nhân vật</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f1eb;color:#252b35;font:16px/1.6 system-ui,sans-serif}
main{max-width:1180px;margin:32px auto;padding:0 24px}h1{margin-bottom:4px;font-size:30px}p{color:#56606c}
.layout{display:grid;grid-template-columns:minmax(320px,1fr) 1fr;gap:24px}.stage{border-radius:24px;background:#e7e2d9;display:grid;place-items:center;min-height:610px}
canvas{max-width:100%;height:580px;object-fit:contain}.controls{padding:24px;background:#fff;border-radius:24px}
button,select{font:inherit;padding:9px 14px;border:1px solid #c5ccd3;border-radius:10px;background:white;cursor:pointer;margin:4px}
button.active{background:#254f60;color:#fff;border-color:#254f60}input[type=range]{width:100%}label{display:block;margin-top:18px}
.photos{display:flex;gap:16px;flex-wrap:wrap}.photos figure{margin:0;max-width:calc(50% - 8px)}.photos img{max-width:100%;max-height:620px;object-fit:contain;border-radius:16px;background:#e7e2d9}
figcaption{font-size:14px;color:#56606c}small{display:block;color:#56606c}details{margin-top:24px}a{color:#254f60}
@media(max-width:760px){.layout{grid-template-columns:1fr}.stage{min-height:500px}canvas{height:480px}}
</style><main><h1>Tiểu Mai · Nhân vật theo ảnh tham chiếu</h1>
<p>Chọn động tác để xem chuyển động, hoặc dừng và kéo thanh trượt để kiểm từng khung.</p>
<div class="layout"><div class="stage" id="stage"><canvas id="preview"></canvas></div><div class="controls">
<div id="actions"></div><label><button id="play">Dừng</button><button id="mirror">Lật trái / phải</button></label>
<label>Tốc độ <select id="speed"><option value=".25">¼ tốc độ</option><option value=".5">½ tốc độ</option><option value="1" selected>Bình thường</option></select></label>
<label>Ảnh xem thử <select id="quality"><option value="render">Render gốc · rõ chi tiết</option><option value="atlas">Sprite dùng trong ứng dụng</option></select></label>
<label>Nền <select id="background"><option value="#e7e2d9">Trung tính</option><option value="#ffffff">Trắng</option><option value="#202632">Tối</option></select></label>
<label>Khung chuyển động <input id="scrub" type="range" min="0" value="0"></label><small id="info"></small>
<p><a href="tieumai-reference.blend">Mở file Blender có timeline chuyển động</a> · <a href="wave.webp">Xem ảnh động chào</a></p>
<small>Đây là bản dựng 3D tham chiếu, chưa phải bản sao chân dung chính xác từ ảnh. Giày và phần phía sau được dựng bổ sung vì ảnh mẫu không cho thấy đầy đủ.</small>
</div></div><details open><summary>Chi tiết khuôn mặt và dáng tham chiếu</summary><div class="photos">
<figure><img src="../../.cache/render3d/reference-v4/frames/face_neutral.png" alt="Khuôn mặt render"><figcaption>Cận mặt</figcaption></figure>
<figure><img src="../../.cache/render3d/reference-v4/frames/face_smile.png" alt="Khuôn mặt cười"><figcaption>Cận mặt cười</figcaption></figure>
</div></details><details><summary>Ảnh gốc được cung cấp (chỉ lưu cục bộ)</summary><div class="photos">
<figure><img src="references/body.png" alt="Tham chiếu dáng người và trang phục"><figcaption>Dáng và trang phục</figcaption></figure>
<figure><img src="references/face.png" alt="Tham chiếu khuôn mặt"><figcaption>Khuôn mặt</figcaption></figure>
</div></details></main>
<script>
const skin=__SKIN__, labels=__LABELS__;
const frameNames=__FRAME_NAMES__,crop=__CROP__,raw=new Map();
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),scrub=document.querySelector('#scrub');
canvas.width=crop[2]-crop[0];canvas.height=crop[3]-crop[1];
const atlas=new Image();atlas.src='../../public/skins/assistant/sheet.webp';
let action='wave',steps=[],i=0,playing=true,mirrored=false,timer;
function draw(){if(!atlas.complete||!atlas.naturalWidth)return;const frame=steps[i][0];ctx.clearRect(0,0,canvas.width,canvas.height);
ctx.save();if(mirrored){ctx.translate(canvas.width,0);ctx.scale(-1,1)}
let full=raw.get(frame);if(document.querySelector('#quality').value==='render'&&!full){full=new Image();raw.set(frame,full);full.onload=draw;full.src='previews/frames/'+frameNames[frame]+'.png'}
if(document.querySelector('#quality').value==='render'&&full?.complete&&full.naturalWidth)ctx.drawImage(full,crop[0],crop[1],canvas.width,canvas.height,0,0,canvas.width,canvas.height);
else ctx.drawImage(atlas,frame%skin.columns*skin.frameW,Math.floor(frame/skin.columns)*skin.frameH,skin.frameW,skin.frameH,0,0,canvas.width,canvas.height);ctx.restore();
scrub.value=i;document.querySelector('#info').textContent=`${labels[action]} · ${i+1}/${steps.length} · ${steps[i][1]||'Giữ'} ms`}
function tick(){clearTimeout(timer);draw();if(playing)timer=setTimeout(()=>{i=(i+1)%steps.length;tick()},(steps[i][1]||1200)/Number(document.querySelector('#speed').value))}
function select(name){action=name;steps=skin.animations[name];i=0;scrub.max=steps.length-1;document.querySelectorAll('#actions button').forEach(b=>b.classList.toggle('active',b.dataset.name===name));tick()}
for(const [name,label] of Object.entries(labels)){const b=document.createElement('button');b.textContent=label;b.dataset.name=name;b.onclick=()=>select(name);document.querySelector('#actions').append(b)}
document.querySelector('#play').onclick=()=>{playing=!playing;document.querySelector('#play').textContent=playing?'Dừng':'Phát';tick()};
document.querySelector('#mirror').onclick=()=>{mirrored=!mirrored;draw()};scrub.oninput=()=>{playing=false;document.querySelector('#play').textContent='Phát';i=Number(scrub.value);tick()};
document.querySelector('#speed').onchange=tick;document.querySelector('#background').onchange=e=>document.querySelector('#stage').style.background=e.target.value;
document.querySelector('#quality').onchange=draw;
atlas.onload=()=>select('wave');atlas.onerror=()=>document.querySelector('#info').textContent='Không tìm thấy sprite sheet. Chạy skin:pack trước.';
</script></html>'''
page=page.replace('__SKIN__',json.dumps(skin,ensure_ascii=False)).replace('__LABELS__',json.dumps(labels,ensure_ascii=False))
page=page.replace('__FRAME_NAMES__',json.dumps(meta['frames'])).replace('__CROP__',json.dumps(crop))
page=page.replace('../../.cache/render3d/reference-v4/frames/','previews/').replace('../../public/skins/assistant/','previews/')
(OUT/'review.html').write_text(page,encoding='utf-8')

chosen=[('rest','Đứng'),('wave_0','Chào'),('hair_04','Vuốt tóc'),('think_04','Suy nghĩ'),('happy_04','Vui'),('drag_3','Khi kéo')]
contact=Image.new('RGB',(230*len(chosen),450),'#ece8e1')
fontpath=pathlib.Path('C:/Windows/Fonts/segoeui.ttf')
font=ImageFont.truetype(str(fontpath),16) if fontpath.exists() else ImageFont.load_default()
for i,(name,label) in enumerate(chosen):
    im=Image.open(FRAMES/f'{name}.png').convert('RGBA').resize((230,420),Image.Resampling.LANCZOS)
    contact.paste(im,(i*230,0),im)
    ImageDraw.Draw(contact).text((i*230+115,426),label,font=font,fill='#37404d',anchor='mt')
contact.save(OUT/'poses.png')
contact.save(ROOT/'docs/assistant.png')
sequence=[('rest',700)]+meta['shots']['wave']+[('rest',1200)]
frames=[Image.open(FRAMES/f'{name}.png').convert('RGBA').resize((276,504),Image.Resampling.LANCZOS) for name,_ in sequence]
temporary=OUT/'wave.tmp.webp'
frames[0].save(temporary,save_all=True,append_images=frames[1:],duration=[ms for _,ms in sequence],loop=0,quality=92,method=6)
temporary.replace(OUT/'wave.webp')
print(f'Review: {OUT / "review.html"}')
