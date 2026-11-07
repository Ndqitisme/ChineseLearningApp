# Nhân vật trợ lý Tiểu Mai

Bản vẽ 2D kiểu anime bán thực, chuyển động bằng rig 2D nhiều lớp chạy trong app.
Cách dựng khác (có hoặc không có GPU): [CHARACTER-PIPELINE.md](CHARACTER-PIPELINE.md).

## 1. Yêu cầu (bắt buộc)

### Ngoại hình

Mặt và tóc theo ảnh mẫu `references/character/face-reference.png` (do AI tạo), càng sát càng tốt:
- tóc nâu vừa, mái thưa rẽ giữa nhìn xuyên được, dài tới lông mày;
- vài lọn mảnh ôm mặt trước tai, phần còn lại buộc thấp ra sau;
- kính tròn gọng kim loại mảnh màu bạc trong, to so với mặt;
- mặt tròn mềm, má đầy, cằm nhỏ tròn;
- mắt nâu, hai mí nhẹ, mi tự nhiên, ánh nhìn hơi cụp và điềm tĩnh;
- mũi nhỏ mềm;
- môi đầy, khép, cười nhẹ, màu hồng be;
- da sáng ấm, má hồng nhẹ.

Dáng và trang phục theo ảnh dáng người, chỉ lấy hình dáng và quần áo, không lấy tư thế:
- dáng mảnh, chân dài;
- áo sơ mi trắng cắt lửng, cổ bẻ, tay ngắn, nơ đen ở cổ;
- chân váy bút chì ngắn kẻ caro xám.

Màu giữ theo số đo khớp với ảnh mẫu; không chỉnh ấm lên theo mô tả bằng chữ.
Bản vẽ không thể giống ảnh 100%; mức giống báo bằng số đo của bộ đo giống mặt, không bằng tính từ.

### Tư thế nghỉ

- Hai bàn chân đặt dưới hông, rộng bằng hông, mũi chân hơi chếch ra.
- Hai gối thẳng nhưng thả lỏng. Không gối khép vào trong, không chân bắt chéo hay co.
- Dồn trọng tâm chỉ là dao động nhỏ và chậm ở hông; hai chân vẫn đặt chắc.
- Tay trái chống hông, tay phải buông thả lỏng.

### Chuyển động

- Bộ động tác: thở, chớp mắt, nhìn quanh, vén tóc, suy nghĩ, nói, vẫy tay, vui, bị kéo, tiếp đất khi thả, ngủ.
- Mọi động tác đi ra từ khung nghỉ và về đúng khung nghỉ qua các khung trung gian. Không giật về khung nghỉ, không có bước nhảy tư thế trong một khung.
- Cử chỉ dùng tay trái. Tay phải luôn nằm trong bóng dáng lúc nghỉ, vì app lật hình khi nhân vật đứng ở mép phải màn hình.
- Chân gồm đùi, cẳng chân, bàn chân; khớp hông, gối, cổ chân; gối là bản lề.
  - Vui: nhún gối nhẹ.
  - Bị kéo: chân đung đưa như con lắc, có quán tính.
  - Tiếp đất: gối đỡ lực rồi ổn định.
  - Ngủ: đứng thả lỏng.
  - Bàn chân không trượt khi đang đặt và không lơ lửng.
- Tay và chân liền một khối. Không thấy chỗ nối giữa các mảnh cứng ở khuỷu, cổ tay, gối. Viền mượt ở mọi khung: không bậc thang, không khía, không hở, không da chồng đôi.
- Tư thế xa tư thế nghỉ (tay vẫy cao, tay chống cằm, tay vén tóc, dáng bị nhấc) lấy từ bản vẽ, không uốn từ tay đang nghỉ.
- Kính gắn với đầu: cùng xoay, ngẩng và uốn như mặt, không trượt khỏi mắt, gọng đọc rõ.
- Tay áo đi theo cánh tay, không có vạt rời hay lỗ. Nơ, tóc và váy theo sau với chuyển động phụ, không tách khỏi thân.

### Đứng yên

- Giữa các sự kiện, giữ đúng một khung và không vẽ lại gì.
- Sự kiện đứng yên:
  - chớp mắt mỗi 2–6 giây, 15% là chớp đôi;
  - thỉnh thoảng thở hoặc dồn trọng tâm trong vài giây;
  - liếc nhìn, nhìn quanh;
  - các clip đứng yên như vén tóc.
- Mỗi sự kiện đi ra từ khung giữ và về đúng khung đó.
- Khi ngủ: khoảng 10 fps. Khi cửa sổ trợ lý bị ẩn (có app toàn màn hình): dừng vòng vẽ.

### Ngân sách khi chạy

Đo trên máy yếu (i5-4570 / Intel HD 4600 là máy tham chiếu), trung vị ít nhất 3 lần, ghi cả độ lệch.

| Mục | Ngưỡng |
|---|---|
| CPU lúc đứng yên, đo ít nhất 60 giây theo lịch sự kiện thật | Không quá mức sprite giữ một khung + 2 điểm % một nhân. Rig tốn khoảng 0,43 điểm mỗi fps hiển thị, nên trung bình nên dưới khoảng 5 fps |
| Bộ nhớ: JS heap + atlas đã giải mã + canvas | Tối đa 9,45 MB |
| Cử chỉ | Từ 30 fps |

### Bong bóng từ

Bong bóng ở cạnh nhân vật, ngang đầu (`bubbleInset` trong `src/pet/geometry.ts`). Kéo được từ mọi chỗ trên bong bóng trừ nút.

## 2. Bản đang phát hành

### Cấu trúc

- **File của app** (`public/skins/assistant/`):
  - `atlas.webp`: atlas part 1024×1024 (186 KB; khoảng 4,2 MB khi giải mã);
  - `rig.json`: part, xương, chuỗi khớp, các bản vẽ tay khoá;
  - `motion-spec.json`: clip, lịch đứng yên, và máy trạng thái gắn clip với sự kiện của app.
- **Trình phát** (`src/lib/rig/`): `rig-player.js` vẽ bằng WebGL.
  - Mỗi tay và mỗi chân là một texture liền, uốn theo xương bằng linear-blend skinning.
  - Thân, cổ và đầu là lưới cứng, có chuyển động phụ cho tóc, nơ, váy.
  - Tay trái có một bản vẽ cho mỗi tư thế khoá. Bản vẽ được chọn theo khoảng cách tới các tư thế khoá, đổi ngay trên cùng bộ xương.
  - Đầu trộn giữa bản nhìn thẳng và các bản quay hoặc ngẩng; kính được vẽ trên đầu nên đi cùng đầu.
  - Bàn chân đang đặt được ghim vào chỗ cũ.
  - Cùng mã này vẽ các khung để bộ kiểm đọc (`tools/skins/ai2d/rig/render.mjs`), nên khung được kiểm là khung app phát.
- **Gắn vào app:**
  - `Rig.svelte` dựng canvas theo `devicePixelRatio`.
  - `load.ts` nạp tài nguyên một lần mỗi cửa sổ.
  - `src/pet/Pet.svelte` phát đủ 21 sự kiện trong `stateMachine.events` tại đúng chỗ gọi. `Timeline` (`behaviour.js`) quyết định clip nào chạy.
  - Ảnh đại diện ở thanh bên của cửa sổ chính cũng là rig.
- **Vòng vẽ:**
  - Đứng yên thì không vẽ gì; chỉ chạy khi có sự kiện.
  - Cử chỉ chạy 30 fps, sự kiện đứng yên chậm hơn, ngủ khoảng 10 fps.
  - Cửa sổ ẩn hoặc tắt nhân vật thì dừng hẳn.

### Số đo

| Đo | Kết quả |
|---|---|
| Headless Chrome, trung vị 3 lần: CPU đứng yên theo lịch sự kiện thật | 1,2–1,8% một nhân (ngưỡng 2,8%) |
| Headless Chrome: bộ nhớ JS heap + atlas + canvas | 7,8 MB / 9,45 MB |
| Headless Chrome: cử chỉ; ẩn; ngủ | 30 fps; 0 lần vẽ; 5,5 fps |
| App thật, bản release, chỉ trợ lý, mỗi 16 giây một từ, `pnpm perf` 180 giây, 2 lần | CPU trung bình 3,4–3,9% một nhân, p95 15–17%; 0% giữa các lần đổi từ |
| App thật: RAM private | Trung bình 160–171 MB, cao nhất 185 MB (nhân vật cũ: 128,6 / 165,7 MB) |
| App thật sau đợt sửa lỗi 2026-11-07, như trên nhưng 600 giây, 1 lần, qua Remote Desktop | CPU trung bình 3,6% một nhân, p95 16%; RAM private trung bình 172 MB, cao nhất 188 MB |

CPU trong app cao hơn ngân sách đứng yên vì mỗi lần đổi từ chạy clip nói khoảng 5 giây ở 30 fps. RAM vượt 150 MB, chủ yếu do WebGL (suy luận: ngân sách của trình phát chỉ 7,8 MB). Đây là việc mở đầu tiên trong `CLAUDE.md`.

### Lỗi đang chấp nhận

Chủ repo chọn phát hành bản này với các lỗi dưới đây. Nguồn là lượt kiểm cuối: bộ kiểm tự động và người kiểm xem từng khung.

- **Bộ kiểm đường nối:** 167/1.674 khung trượt.
  - Theo clip: drag_loop 49, happy 32, hairTuck 22, sleep_exit 15, wave 11, drag_enter 11, think_exit 7, think_enter 6, sleep_loop 5, drag_exit 4, breathe 2, sleep_enter 2, talk_enter 1.
- **wave:**
  - 10→11: tay nhảy từ buông sang giơ 40° trong một khung.
  - 11–13: cẳng tay gồ, gập khúc, bàn tay quắp, có chỗ như hai cẳng tay.
  - 66→69: nhảy khi đổi bản vẽ, cổ tay thắt lại.
- **hairTuck:**
  - 17–19 và 64–65: tay áo dựng thành vạt nhọn trên vai.
  - 22–56: cánh tay trần không có tay áo.
  - 16→17, 53→54, 65→66: nhảy tư thế.
- **happy:** 8→9 và 16→17 nhảy tư thế; khung 17 cổ tay gập 90°; khung 10 không thấy bàn tay.
- **Nhảy tư thế một khung khác:** think_enter 20→21; think_exit 9→10 và 15→16; sleep_enter 43→44; talk_enter 7→8.
- **drag:** tay cách váy 1,5–2 px; khía ở chỗ đuôi tóc gặp cổ áo; răng cưa ở mép tóc gần tai.
- **think_loop:** đốm đen ở đầu ngón trỏ; mép tóc bậc thang.
- **Mắt:**
  - Chớp mắt không có khung mí khép nửa.
  - sleep_enter mở mắt lại giữa lúc gục xuống (39–45).
- **Bộ kiểm nhất quán:** 865 khung trượt, chưa tính màu mống mắt.
  - Theo luật: head_ssim 757, limbs 498, ghost 204, holes 185, seam 69.
  - Bộ đo giống mặt trượt ở 10 clip: think_enter, think_loop, wave, sleep_loop, sleep_exit, nod, talk_loop, happy, sleep_enter, notice.
  - Màu mống mắt nhạt và xám hơn ảnh mẫu, trượt trên 1.483 khung; chưa có quyết định chấp nhận hay sửa.
- **Chỗ bộ kiểm còn hở**, cần bổ sung luật trước khi sửa:
  - không có luật cho tay áo nhô trên đường vai;
  - độ méo lưới chưa chặn;
  - một số lần nhảy tư thế không bị bắt (think_exit 9→10, hairTuck 53→54).

## 3. Dựng lại

Mọi lệnh chạy từ gốc repo.

```bash
# Một lần: môi trường Python 3.12 cho bộ dựng và bộ kiểm
uv venv --python 3.12 tools/skins/ai2d/.venv
uv pip install --python tools/skins/ai2d/.venv -r tools/skins/ai2d/harness/requirements.lock

# 1. Bản vẽ nguồn → part (art/out), tư thế khoá (art/keyposes/out)
(cd tools/skins/ai2d/art && ../.venv/Scripts/python run.py)
(cd tools/skins/ai2d/art/keyposes && ../../.venv/Scripts/python run.py)

# 2. Motion spec, tay trung gian, atlas, rig.json, render mọi clip, bộ kiểm, cổng CPU/RAM
pnpm skin:rig                 # thêm -- --no-gates để bỏ đo cổng

# 3. Đưa sang app
cp tools/skins/ai2d/rig/out/rig.json tools/skins/ai2d/rig/out/atlas.webp tools/skins/ai2d/rig/motion/motion-spec.json public/skins/assistant/
```

- `skin:rig` trả mã 1 khi một bước trượt. Với các lỗi đang chấp nhận ở trên, bước kiểm đường nối trượt là đúng.
- Render và đo cổng dùng Chrome headless. Đường dẫn mặc định là Chrome trên Windows; đặt biến `CHROME` nếu khác.
- Đo cổng lấy thời gian CPU của Chrome qua PowerShell, nên chỉ chạy trên Windows.
- Trên Linux, python của venv nằm ở `.venv/bin/python`.
- **Thời gian trên i5-4570:**
  - bước 1 khoảng 18 phút;
  - `skin:rig` khoảng 95 phút: render 6 phút, chứng minh bộ kiểm đường nối trên mẫu lỗi 17 phút, kiểm đường nối mọi khung 34 phút, đo cổng 16 phút.
- **Bộ đo giống mặt:** cần `references/character/face-reference.png`. Thiếu file này thì bước dựng part không chạy.
- Dựng lại từ nguồn trong repo không cần Codex.
- **Vẽ thêm bằng Codex:** dùng `art/gen/codex_gen.sh`, `art/keyposes/gen/codex_gen2.sh` hoặc `rig/inbetween/gen/codex_gen.sh`.
  - Mỗi lượt gọi ghi prompt, ảnh vào và ảnh ra vào `art/generations.log`.
  - Script dừng khi log đã có `CODEX_BUDGET` lượt (mặc định 30); đặt biến này khi bắt đầu một đợt mới.
  - Script từ chối file trùng ảnh dáng người.
- **Khung tham chiếu 3D:** `art/keyposes/guide/run_guide.py`, cần Blender 4.5 (biến `BLENDER`) và file `.glb` trong `references/`.
- **Bộ kiểm nhất quán:**
  - Chia khung bằng `rig/cons_split.py`, rồi chạy `tools/skins/ai2d/.venv/Scripts/python -I tools/skins/ai2d/consistency/consistency.py --frames <dir> --out <dir> --spec tools/skins/ai2d/rig/motion/motion-spec.json`.
  - Mất khoảng 4 giây mỗi khung.
  - `prove.py` cần các fixture lớn (khoảng 80 MB) không đưa vào repo; chủ repo giữ chúng cùng `references/`.

### Thư mục `tools/skins/ai2d/`

| Thư mục | Nội dung |
|---|---|
| `art/` | Ảnh nguồn Codex đã duyệt (`src/`), prompt (`gen/`), nhật ký sinh ảnh, bộ dựng part |
| `art/keyposes/` | Tư thế khoá: tay vẫy, kéo, tiếp đất, đầu quay và ngẩng; khung tham chiếu 3D (`guide/`) |
| `rig/` | Dựng atlas và `rig.json`, render, bộ kiểm đường nối, cổng CPU/RAM (`gates.mjs`, so với sprite cũ trong `fixtures/sprite-baseline/`) |
| `rig/inbetween/` | Bản vẽ tay trung gian (tay rời hông, đưa ra trước, vén tóc nửa chừng) |
| `rig/motion/` | Bộ sinh motion spec, bộ kiểm spec, fixture lỗi gài sẵn |
| `consistency/`, `harness/` | Bộ kiểm nhất quán và bộ đo giống mặt, đóng băng bằng sha256 (`FROZEN`) |
| `motion-v1/` | Motion spec và bộ lập lịch bản đầu: mốc so sánh cho bộ dựng part và cho bằng chứng sửa lỗi lập lịch |

## 4. Bộ kiểm

- **Motion spec và bộ kiểm spec:** luật về đi vào, đi ra, đứng yên, thăng bằng, chân; mỗi luật có mẫu lỗi gài sẵn phải bị bắt.
- **Bộ kiểm đường nối** chạy trên mọi khung của mọi clip ở 1× và 2×. Phải bắt được:
  - viền alpha bị đứt;
  - khía (độ cong tăng vọt dọc viền gần khớp);
  - vết cắt thẳng trong vùng da;
  - mảnh rời (thêm thành phần liên thông);
  - kính lệch khỏi mắt trong khoảng xoay đầu, đo trên khung màu;
  - bước nhảy tư thế trong một khung.
- **Bộ kiểm nhất quán và bộ đo giống mặt** bị đóng băng: file kèm sha256 trong `FROZEN`. Kiểm sha256 trước khi chạy; không sửa.
- **Cổng CPU/RAM** đo bằng CDP Performance (TaskDuration + raster) trong headless Chrome cùng nhánh Chromium với WebView2, rồi đo lại trong app thật bằng `pnpm perf`.
- Người kiểm xem từng khung của mọi clip, phóng to đầu và kính, vai và tay áo, khuỷu, cổ tay và bàn tay, hông và gấu váy, gối và bàn chân; liệt kê mọi lỗi theo clip và khung.
- Một đợt chỉ đạt khi cả bộ kiểm tự động và phần xem bằng mắt đều sạch.

**Không nới bộ kiểm để qua.** Không tắt, bỏ cổng hay nới ngưỡng của luật phát hiện nào chỉ để qua. Luật đang tắt hoặc chỉ báo mà không chặn là lỗi chặn. Ngưỡng hiệu chỉnh trên lỗi thật: mẫu lỗi phải trượt, khung nghỉ sạch phải qua.

## 5. Ảnh mẫu và giấy phép

- `references/` nằm ngoài repo (trong `.gitignore`). Bản sao chép bằng tay giữa các máy.
- Ảnh dáng người là ảnh người thật. Chỉ đọc trên máy để lấy hình dáng và trang phục, mô tả bằng chữ. Không đưa vào Codex, dịch vụ web hay bất kỳ model nào, kể cả model chạy trên máy. Script gọi Codex từ chối file có sha256 trùng ảnh này.
- Ảnh mặt do AI tạo; được làm input cho model ảnh.
- Mô hình 3D TRELLIS.2 (`references/character/*.glb`) chỉ dùng làm khung tham chiếu tư thế, không phát hành. Bản `…051444.292.glb` là bản dùng; bản `…051807.330.glb` hỏng (hai tay chống hông, tóc thủng).
- Bản vẽ của nhân vật (ảnh nguồn Codex và mọi thứ dựng ra từ đó): CC0 1.0.
