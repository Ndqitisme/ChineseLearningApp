# Nhân vật tham chiếu v4

Bản v4 dựng lại từ hai ảnh mẫu mới: ảnh nhan sắc (khuôn mặt do AI tạo, dùng làm mẫu
nhan sắc) và ảnh dáng người (dùng cho hình thể và trang phục, không dùng tư thế). Khuôn
mặt chỉ dùng target hình thái của MakeHuman và vật liệu, không dán ảnh lên mesh; mức giống
là xấp xỉ MakeHuman cho phép, có bảng so sánh cùng tỉ lệ ở
`.cache/compare/tieumai-v4-face.png`. Trang phục giữ từ v3: áo trắng ngắn tay cắt ngang eo,
nơ đen có hạt, váy ôm kẻ xám. Tư thế đứng và bộ động tác là bộ v2 (commit bc1e63e) dựng lại
trên bộ giải cổ tay mới. Giày và các bề mặt không thấy trong ảnh là phần dựng bổ sung.

## Khác với v3

- Tóc: scalp `ponytail01` (CC0) nhuộm nâu sáng, buộc thấp ra sau; mái thưa nhìn xuyên
  và hai lọn ôm mặt dựng bằng hair card (dải mesh 2,5 cm có texture alpha sợi tóc: các
  chùm sợi sẫm, đục, có khe hở thấy da), bám theo mặt trán đo từ mesh da, kết thúc ở
  ngang lông mày. Sợi mảnh hơn 2 mm biến mất ở tỉ lệ sprite nên không dùng curve từng sợi.
- Mặt: mặt tròn-oval, cằm nhỏ, má đầy, mắt to hơi xếch xuống, lông mày thẳng
  (`eyebrow001` nhuộm nâu), mũi nhỏ sống hẹp, môi hồng (tint theo trọng số xương
  orbicularis oris trộn vào node da của MPFB), da sáng ấm (`young_caucasian_female`
  trộn thêm màu đào), mống mắt nâu sẫm. Tổng các target hình đầu làm môi gốc hé và
  nhô ra; `LIPS_CLOSED` (mouth-open −0,12) khép môi và `LIPS_FLAT` (mouth-pursing −0,3)
  làm phẳng môi ở mọi khung, giá trị `open`/`purse` của từng tư thế cộng thêm vào đó.
  Cười là cười mím (corner-puller 0,55, không há).
- Kính: gọng tròn mảnh bạc, bán kính 24,5 mm, đặt đúng tâm mắt.
- Dáng đứng (bộ v2): dồn trọng tâm chân phải, tay trái chống hông (gót bàn tay trên
  xương hông, cổ tay duỗi 28°), tay phải buông sát người. Camera lệch 14° (hơi 3/4).
- Cổ tay: bỏ cách "ngắm hướng bàn tay rồi kẹp góc" của v3 (tay chống hông bị gãy cổ
  tay). Xương `wrist` để nguyên theo cẳng tay (ở rest bàn tay đã thẳng với cẳng tay,
  lệch 6°), xoay sấp/ngửa chia đều hai xương cẳng tay để lòng bàn tay quay đúng hướng,
  rồi chỉ gập cổ tay tường minh theo từng tư thế (`flex` duỗi/gập, `dev` nghiêng về
  ngón cái). Ngón tay cuộn riêng từng ngón để làm chữ V, chỉ tay, nắm điện thoại.
- Bộ động tác (bộ v2, 43 khung; cử chỉ dùng tay trái vì tay phải ở phía mép màn hình):
  thở; chớp mắt; nhìn quanh; vuốt tóc sau tai; suy nghĩ (tay trái đỡ cằm, tay phải
  gập ngang eo đỡ khuỷu); nói chuyện bàn tay ngửa và 4 khẩu hình; vẫy tay cạnh đầu
  (lắc cổ tay); vui (hai tay chụm trước ngực, vai nhún); bị kéo thì tay đưa lên xương
  đòn, chân co; ngủ thì đầu cúi, mắt nhắm dần. Mọi shot đi lên từ `rest` và đi xuống
  qua đúng các khung đó (khung đầu/cuối cách `rest` một bước nhỏ), 120–200 ms một
  khung chi, có giữ. `tools/skins/pack.py` ánh xạ tên app: `wink → hair`,
  `drag → drag`, `sleep → sleep` giữ khung cuối.

## Nguồn chỉnh sửa

- `tools/skins/makehuman/build.py`: hình thể, target mặt, giải IK hai đoạn, hướng bàn
  tay, trạng thái tay, các shot, ánh sáng, camera, kiểm tra và xuất timeline Blender.
- `tools/skins/makehuman/reference_style.py`: áo crop, váy kẻ, nơ, tóc mái hair card,
  tint lông mày/môi/da/mống mắt, kính.
- `tools/skins/pack.py`: đóng gói các khung render vào sprite của ứng dụng.
- `tools/skins/review.py`: trang xem chuyển động cục bộ, ảnh tổng hợp và ảnh động.

## Quy trình kiểm tra

1. `pnpm skin:check`: kiểm đủ 43 khung. Lỗi điểm đích tay trên 5 mm, cổ tay vượt 40°,
   khuỷu ngoài khoảng 3–155°, tay xuyên bề mặt trên 3 mm hoặc chân ra ngoài váy làm
   lệnh thất bại. Kiểm vải dùng bề mặt ngoài. Đuôi tóc nằm trong áo được đếm
   (`hairInsideShirt`) nhưng không làm thất bại. Đây là kiểm tra hình học, không phải
   chứng nhận cơ sinh học.
2. Xem `.cache/compare/tieumai-v4.png` (khung chính mọi shot), `tieumai-v4-face.png`
   (cận mặt cạnh ảnh mẫu, cùng tỉ lệ) và `tieumai-v4-vs-ref.png` (hình thể cạnh ảnh
   mẫu). Đọc báo cáo `.cache/render3d/reference-v4/validation.json`.
3. `pnpm skin:render` rồi `pnpm skin:pack`. Packer từ chối báo cáo khác mã nguồn,
   khung rỗng, sai kích thước hoặc chạm biên render. Một vùng cắt chung giữ vị trí
   nhân vật ổn định giữa các khung; atlas 340 px/khung, ảnh render gốc là 460×840 px.
   Kết quả v4: 43 khung 139×340 px, atlas 1390×1700 px, `sheet.webp` 517 KB; kiểm tra: 0 lỗi, xuyên tối đa 0,0 mm, lệch đích tay tối đa 0,4 mm, cổ tay tối đa 21,4° (trái) / 8,2° (phải), khuỷu 72–148° (trái) / 31–90° (phải), không khung nào vượt mép trái của tư thế đứng (`edgeOverhangPx` rỗng).
4. `.cache/venv/Scripts/python tools/skins/review.py` và mở
   `output/character/review.html`: xem đủ 11 trạng thái, tốc độ chậm, kéo từng khung,
   đổi nền và lật trái/phải. `tools/skins/verify.mjs` có thể kiểm trang bằng Chrome CDP.
5. `pnpm check`, `pnpm test`, `pnpm tauri build --no-bundle`.

`pnpm skin:save` xuất `output/character/tieumai-reference.blend`, bao gồm texture và
timeline 30 fps có marker tên các động tác. Ứng dụng vẫn phát sprite, không chạy Blender
hay engine 3D khi sử dụng. Sprite được lật ở mép phải màn hình (`facing: "right"`), nên
trong khung render gốc tay phải (cầm điện thoại) luôn ở phía mép và không vượt ra ngoài
hình bóng tư thế đứng; `edgeOverhangPx` trong báo cáo kiểm tra phải rỗng.
