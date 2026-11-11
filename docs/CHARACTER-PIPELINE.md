# Dựng nhân vật: không có GPU và có GPU

Tài liệu này dùng khi cần vẽ thêm tư thế, sửa lỗi nối khớp hoặc làm lại bộ chuyển động.
Yêu cầu về nhân vật và bản đang phát hành nằm ở [CHARACTER.md](CHARACTER.md).

Không dùng agent hay dịch vụ ngoài để vẽ. Hình mới làm trên máy bằng Blender, script trong repo và model mở chạy cục bộ (mục 3). Ảnh nguồn đã duyệt nằm ở `tools/skins/ai2d/`.

App phát hành không cần GPU. GPU chỉ thay đổi khâu sản xuất hình.
CPU và RAM của app luôn đo trên máy yếu cỡ i5-4570 / Intel HD 4600, vì đó là máy người dùng.

Nhãn: [đo] là đã đo hoặc đã đọc tận nguồn; [suy luận] là suy ra, chưa kiểm; [chưa kiểm] là con số hay khẳng định của bên thứ ba chưa thử ở đây.

## 1. Các khâu

| Khâu | Cách làm (GPU NVIDIA trên máy) |
|---|---|
| Vẽ tư thế mới | Model ảnh chạy trên máy: SDXL / Animagine XL 4.0 kèm ControlNet (khung xương, depth) và IP-Adapter hoặc LoRA học từ ảnh gốc. Seed cố định, không giới hạn số lần |
| Tách bức vẽ thành part | See-through tự tách tối đa 23 lớp, vẽ bù phần bị che, xuất PSD kèm depth và mask |
| Khung chuyển tiếp khi tay đổi tư thế | Wan2.1-VACE tạo chuyển động giữa hai khung khoá theo khung xương hoặc depth; RIFE chỉ cho phần chênh nhỏ |
| Đầu, mặt, kính | LivePortrait điều khiển xoay, ngẩng, chớp mắt, miệng bằng tham số; kính đi theo đầu vì cả vùng đầu được uốn cùng nhau |
| Khung tham chiếu tư thế 3D | Không bắt buộc: vẽ khung xương ControlNet thẳng từ toạ độ khớp. Nếu cần 3D thì Blender Cycles chạy GPU |
| Bộ kiểm nhất quán và đường nối | Gần như chạy CPU; nhanh lên nhờ CPU nhiều nhân, GPU ít tác dụng [suy luận] |
| Một vòng dựng và kiểm rig | Khoảng 1–1,5 giờ với CPU đời mới 8–16 nhân [suy luận] |
| Phụ thuộc bên ngoài lúc dựng | Chỉ tải trọng số model một lần; sau đó chạy không cần mạng |

Máy GPU làm vòng dựng ngắn lại nhưng không tự làm hết lỗi.
Lỗi khuỷu tay và giật một khung khi đổi tư thế là giới hạn của cách làm rig sống từ part cắt tay, không phải của tốc độ máy.

## 2. Không có GPU

### Dùng được ngay

- Dựng lại bản đang phát hành từ nguồn trong repo.
- Sửa lỗi ở tầng rig và chuyển động bằng part có sẵn: thời gian clip, khung trung gian nội suy, trọng số skinning, lịch sự kiện.
- Đo CPU và RAM trực tiếp trên máy giống máy người dùng.

### Giới hạn

- Không vẽ được thứ chưa có (tư thế tay mới, kiểu bàn tay mới, sửa nét vẽ): việc đó cần model ảnh cục bộ ở mục 3, tức cần GPU.
- Part cắt từ một bức vẽ phẳng không có phần bị che (vai sau tay, eo sau tay chống hông), nên khớp nối phải vá.
- Blender ở chế độ nền: Workbench render sai góc nhìn trên Intel HD 4600, nên dùng Cycles CPU với đường dẫn Windows tuyệt đối. Eevee không chạy trên GPU này.

### Phương án thay thế chạy CPU (chưa thử)

Các model ở mục 3 đều chạy được trên CPU, nhưng rất chậm:
- LivePortrait: đoán 1–3 giây mỗi khung, chưa đo.
- Wan2.1-VACE-1.3B qua stable-diffusion.cpp (MIT, có AVX2): ước 30 phút tới 4,7 giờ cho một clip 33 khung, chưa có benchmark công bố.
- See-through, ToonCrafter: cần 8–27 GB VRAM, không chạy được trên máy này.

## 3. Có GPU

### Bỏ được gì

| Bỏ | Thay bằng | Ghi chú |
|---|---|---|
| Vẽ tay bằng dịch vụ ngoài | Model ảnh cục bộ (mục 1) | Có thể train LoRA nhỏ từ các PNG nguồn đã có để giữ đúng nét; cần nhiều VRAM (mục 7) |
| Vòng cắt part bằng script | See-through | Phần bị che được vẽ bù nên khớp nối liền từ gốc |
| Ảnh trung gian cho tay | Wan2.1-VACE | Khung đầu và cuối là hai tư thế đã có |
| Sửa kính lệch | LivePortrait | Bỏ bộ dò mặt InsightFace (giấy phép phi thương mại), dùng vùng cắt cố định từ toạ độ khớp hoặc MediaPipe |
| Blender làm khung tham chiếu | Khung xương vẽ từ toạ độ khớp | Giữ Blender nếu cần depth thật |

### Không đổi

- Yêu cầu về hình, chuyển động và đứng yên trong [CHARACTER.md](CHARACTER.md).
- Motion spec, bộ kiểm đường nối, bộ kiểm nhất quán và ngưỡng của chúng. Không nới ngưỡng để qua.
- Ngân sách CPU/RAM của app, đo trên máy yếu.
- Ảnh dáng người thật trong `references/` không đưa vào bất kỳ model nào, kể cả model chạy trên máy. Chỉ ảnh mặt (do AI tạo) và các PNG nguồn của dự án được làm input.
- Giấy phép đầu ra CC0 1.0: chỉ dùng model mà giấy phép không giữ quyền với ảnh tạo ra (mục 6).

### Quy trình đề xuất

1. **Cài đặt.** Hướng dẫn cài See-through viết cho Linux; trên Windows dùng WSL2. Ghim phiên bản và sha256 của từng file trọng số, giống `tools/data/sources.lock.json`.
2. **Part.** Chạy See-through trên ảnh gốc (`master.png`). So từng lớp với part hiện tại.
3. **Đầu.** LivePortrait trên vùng đầu của ảnh gốc, điều khiển bằng đường cong trong motion spec (xoay, ngẩng, nghiêng, mắt, miệng, ánh nhìn). Dán lại theo vị trí đầu của rig.
4. **Tư thế khoá.** Model ảnh cục bộ chỉ vẽ lại vùng tay hoặc chân (inpaint), để mặt và thân giữ nguyên từng pixel. Khung xương lấy từ toạ độ khớp của ảnh gốc.
5. **Chuyển tiếp.** VACE cho các cử động tay lớn (vẫy, vén tóc, suy nghĩ, bị kéo). RIFE chỉ cho phần chênh nhỏ còn lại.
6. **Vá đường nối** ở cổ tay và khuỷu bằng hoà trộn Poisson hoặc làm mềm mép.
7. **Đóng gói**, chọn một trong hai sau thử nghiệm (mục 4):
   - **Giữ rig sống:** part mới đưa vào atlas hiện tại; app giữ nguyên trình phát rig.
   - **Clip dựng sẵn:** mỗi clip là một ảnh AVIF động, app phát bằng WebCodecs `ImageDecoder`, đứng yên thì giữ một khung.
8. **Kiểm.** Chạy toàn bộ bộ kiểm hiện có, không sửa; đo CPU/RAM trên máy yếu.

### Hai cách đóng gói

| | Rig sống | Clip dựng sẵn |
|---|---|---|
| App | Giữ code rig hiện tại | Thay bằng trình phát clip nhỏ |
| Chất lượng từng khung | Bị giới hạn bởi part và nội suy | Sửa được từng khung trước khi đóng gói |
| Bộ nhớ lúc chạy | Atlas part khoảng 4,2 MB giải mã [đo] | Khoảng 4,6 MB khi giữ 2 khung 2× [đo, ước từ thành phần] |
| Dung lượng | Một atlas | Khoảng 6–20 MB cho khoảng 1.700 khung 2×, tuỳ chất lượng [suy luận từ số đo mỗi khung] |
| Biến thể chuyển động | Tham số đổi được lúc chạy | Cố định theo clip |

## 4. Thử trước khi chuyển (pass/fail)

Chạy trên máy GPU, khoảng nửa ngày. Chỉ chuyển hẳn khi các mục cần cho cách đóng gói đã chọn đều đạt.

1. **See-through trên ảnh gốc.**
   - Đạt nếu tách riêng được hai cánh tay, cẳng tay với bàn tay, tóc, kính, và phần thân sau tay được vẽ bù.
   - Rig dựng từ các lớp này qua bộ kiểm đường nối; các mẫu lỗi gài sẵn (khuỷu cứng, vết cắt) vẫn bị bắt.
2. **LivePortrait, clip `look`:** 81 khung, xoay đầu 0° → 14° → 0° kèm một lần chớp mắt.
   - Đạt nếu bộ đo giống mặt (likeness harness) qua trên vùng đầu;
   - kính lệch mắt tối đa 1 px ở 2× trên mọi khung;
   - nhìn từng khung không thấy méo.
   - Ghi lại thời gian mỗi khung.
3. **Model ảnh cục bộ, tư thế vẫy tay.**
   - Đạt nếu mặt và thân giữ nguyên từng pixel ngoài vùng tay;
   - tay và bàn tay liền, đúng số ngón;
   - bộ đo giống mặt vẫn qua.
4. **VACE, chuyển tiếp tay rời hông → giơ tay vẫy.**
   - Đạt nếu bộ kiểm đường nối qua, không có bước nhảy tư thế một khung, và bộ đo giống mặt qua.
5. **Trình phát clip** (chỉ khi chọn clip dựng sẵn): clip `wave` 2×, AVIF chất lượng 85, 4:4:4, phát bằng `ImageDecoder`, đo theo cách của bộ đo cổng (CDP, 3 lần, lấy trung vị) trên máy yếu.
   - Đạt nếu CPU lúc đứng yên tối đa 3,4% một nhân;
   - bộ nhớ dưới 9,45 MB;
   - cử chỉ từ 30 fps;
   - Chrome không lệch màu so với khung PNG.
   - `ImageDecoder` cần secure context. App chạy ở `http://tauri.localhost`, Chromium coi `*.localhost` là đáng tin, nên dự kiến chạy được nhưng chưa kiểm trong app. Dự phòng: `createImageBitmap` trên từng file WebP.

## 5. Số đo đã có

| Mục | Số đo | Ghi chú |
|---|---|---|
| CPU trang trắng | 0,98% một nhân | Headless Chrome 156, CDP, trung vị 3 lần [đo] |
| CPU sprite cũ đứng yên (một khung giữ) | 0,8–1,4% tuỳ lần đo | Ngưỡng của rig là mức này + 2 điểm [đo] |
| Canvas chỉ trình chiếu 15 fps | 5,01% | Khoảng 0,27 điểm mỗi fps [đo] |
| Rig chạy liên tục 19,4 fps | 9,35% | Khoảng 0,43 điểm mỗi fps; lý do đứng yên phải giữ một khung [đo] |
| Rig đứng yên giữ khung + sự kiện | 1,2–1,8% (ngưỡng khoảng 2,8%) | Hai lần đo, mỗi lần trung vị 3 lần chạy [đo] |
| Bộ nhớ rig | 7,83 MB / 9,45 MB | JS heap + atlas giải mã + canvas [đo] |
| Giải mã AVIF từng khung (`ImageDecoder`) | 1,5 / 3,3 ms ở 1×; 2,7 / 4,6 ms ở 2× (trung vị / p95) | Clip `wave` 81 khung, Chrome 156 [đo] |
| Dung lượng mỗi khung AVIF | 1,5 KB (1×, q70); 3,6 KB (2×, q70); 11,6 KB (2×, q85, 4:4:4) | [đo] |

Pillow giải mã AVIF ra màu hơi tối hơn; chưa kiểm trong Chrome.

## 6. Giấy phép

| Thành phần | Giấy phép | Trạng thái |
|---|---|---|
| See-through (code) | Apache-2.0 | [đo] |
| See-through, model tách lớp (dựa trên SDXL và Animagine XL 4.0) | CreativeML OpenRAIL++-M, cho dùng thương mại kèm danh sách cấm dùng | [đo] |
| See-through, model nhận diện cơ thể (SAM) | Apache-2.0 | [đo] |
| Marigold (depth) | | [chưa kiểm] |
| LivePortrait (code và trọng số) | MIT | [đo] |
| Bộ dò mặt InsightFace đi kèm LivePortrait | Chỉ cho nghiên cứu phi thương mại: phải bỏ | [đo] |
| `landmark.onnx` của LivePortrait | Không ghi nguồn gốc | [chưa kiểm] |
| Wan2.1-VACE-1.3B | Apache-2.0; thẻ model không nhận quyền với đầu ra | [đo] |
| RIFE | MIT | [đo] |
| stable-diffusion.cpp | MIT | [đo] |
| ControlNet SDXL, IP-Adapter | Khác nhau theo bản; chọn bản Apache-2.0 hoặc OpenRAIL++ | [chưa kiểm] |
| OpenRAIL++-M và quyền với ảnh tạo ra | Theo trí nhớ, điều 6 nói bên cấp phép không giữ quyền với đầu ra | [chưa kiểm]; đọc lại văn bản trước khi phát hành |
| TRELLIS.2 | MIT | [chưa kiểm lại] |

## 7. Phần cứng

- Máy dựng hiện tại: RTX 5060 8 GB VRAM, i7-14700 28 luồng, 32 GB RAM [đo]. Đủ hay không cho từng khâu do các bài thử ở mục 4 quyết định.
- GPU NVIDIA 16 GB VRAM là thoải mái cho See-through, LivePortrait, VACE 1.3B và SDXL [suy luận].
- 8 GB chạy được See-through nếu nén model NF4 [chưa kiểm].
- 24 GB trở lên mới nên chạy VACE 14B hoặc train LoRA thoải mái [suy luận].
- CPU nhiều nhân giúp bộ kiểm chạy nhanh; bộ kiểm không dùng GPU.

## 8. Đã loại

| Cách | Lý do |
|---|---|
| Live2D Cubism, Spine, Rive | Cần editor có giao diện; Spine bắt mỗi người dùng mua giấy phép editor; Live2D có thể cần thoả thuận phát hành |
| DragonBones, Inochi2D | Cùng cách cắt part và skinning đã làm; rig Inochi chỉ làm bằng giao diện |
| Stretchy Studio, Bunraku, Meta Animated Drawings | Chỉ có giao diện, chỉ có README, hoặc đã lưu trữ (09/2025) |
| VRM hay ảnh sang 3D tô kiểu hoạt hình | Mặt chấm 19/30 so với 28/30 của bản vẽ 2D; bộ nhớ và fps vượt xa ngân sách |
| Sprite sheet giải mã toàn bộ | Khoảng 51 MB, gấp 5,4 lần ngân sách 9,45 MB; phát từng khung thì không vướng (mục 5) |
| Video VP9 có alpha | Khó nối clip chính xác từng khung; `ImageDecoder` tốt hơn |
| RIFE hay FILM giữa hai tư thế xa nhau | Bóng mờ khi tay di chuyển lớn |
| GPU đám mây miễn phí | Phải tải ảnh gốc lên dịch vụ ngoài; chỉ làm khi chủ repo đồng ý |

## 9. Nguồn

- See-through: https://github.com/shitagaki-lab/see-through
- LivePortrait: https://github.com/KwaiVGI/LivePortrait, https://huggingface.co/KwaiVGI/LivePortrait
- Wan2.1-VACE: https://github.com/ali-vilab/VACE, https://huggingface.co/Wan-AI/Wan2.1-VACE-1.3B
- stable-diffusion.cpp: https://github.com/leejet/stable-diffusion.cpp
- RIFE: https://github.com/hzwer/Practical-RIFE
- Giấy phép Live2D và Spine: https://www.live2d.com/en/sdk/license/, https://esotericsoftware.com/spine-runtimes-license
