# Việc cần làm (ghi ngày 2026-11-04)

## Trạng thái (cập nhật cuối ngày 2026-11-04)

Đã làm cả 9 mục, build ra `TieuMai - Chinese Learning.exe` và bộ cài NSIS.

**Đã kiểm:**
- `pnpm check` 0 lỗi; 24 test qua (thêm test emoji cho Windows 10 và test vị trí cho chế độ chỉ có bảng từ).
- Exe và cửa sổ đang chạy đều mang icon Tiểu Mai (trích bằng `ExtractAssociatedIcon` và `WM_GETICON`).
- Chữ trên giao diện đã có trong bản build.
- Không có mục tự khởi động nào trỏ tới exe cũ (`tieumai.exe`).

**Chưa kiểm bằng mắt** (máy khoá màn hình lúc build): tooltip sát mép, nút quay lại, xem mẫu / gợi ý nét, vẽ lần lượt, trang Ôn tập, chế độ chỉ có bảng từ, nút loa.

**Quyết định riêng:**
- Máy đang lưu theme Hoa anh đào được chuyển sang Biển xanh một lần (key `settingsVersion`); máy mới mặc định Biển xanh.
- Taskbar trước đó hiện icon cũ là do Windows cache icon theo đường dẫn exe. Đổi tên exe sang tên app mới nên dùng đường dẫn mới, không cần xoá cache.

Phiên sau đọc file này rồi làm lần lượt. Mỗi mục ghi: vấn đề → nguyên nhân dự đoán (chưa xác nhận nếu ghi "đoán") → cần sửa ở đâu → kiểm thế nào là xong. Ảnh minh hoạ nằm trong tin nhắn của người dùng ở phiên trước, không lưu trong repo.

Kiểm chung khi xong cả đợt:
- `pnpm check`, `pnpm test` và `pnpm tauri build --no-bundle` đều chạy sạch.
- Chạy bản release, chụp màn hình từng chỗ đã sửa. Chỉ chụp phần cửa sổ app vì màn hình người dùng có nội dung riêng; ảnh chụp toàn màn hình thì xoá ngay sau khi xem.

## 1. Theme mặc định là "Biển xanh"; theme "Trà sữa" bị lỗi font

**Theme mặc định**
- Đổi `theme: 'sakura'` thành `'ocean'` trong `DEFAULT_SETTINGS` (`src/lib/settings.svelte.ts`).
- Người dùng đã lưu `sakura` thì vẫn giữ `sakura`, vì `merge()` lấy giá trị đã lưu. Cần quyết một trong hai: chuyển một lần các máy đang lưu `sakura` sang `ocean` (thêm key `themeMigrated` vào settings), hoặc chỉ đổi mặc định cho máy mới. Nên hỏi người dùng. Máy của người dùng hiện đang lưu `sakura`.

**Lỗi font "Trà sữa"**
- Ô vuông là emoji 🧋, thuộc Emoji 13.0, font Segoe UI Emoji trên Windows 10 không có.
- Đã đổi sang 🥤 trong commit `bc1e63e` (`src/lib/theme/themes.ts`, `data/topics/_index.json`). Ảnh lỗi chụp từ bản build cũ hơn commit đó.
- Việc còn lại: build lại, mở Cài đặt → Giao diện, xác nhận icon hiện đúng.
- Rà thêm mọi emoji trong `src/` và `data/` cho chắc. Script rà ở phiên trước tìm theo các mã Emoji 13 trở lên; nên đưa thành test hoặc thành bước kiểm trong `data:build`.

**Xong khi:** máy mới mở lên là theme Biển xanh, và Cài đặt không còn ô vuông nào.

## 2. Icon trên taskbar vẫn là icon mặc định của Tauri, chưa phải Tiểu Mai

- Ảnh cho thấy icon tròn xanh-vàng, đúng icon mẫu của Tauri.
- Đã chạy `pnpm tauri icon .cache/logo/icon-1024.png` và build lại, nhưng exe có thể vẫn nhúng `icon.ico` cũ. Đoán là `tauri-build` không chạy lại `build.rs` khi file icon đổi.

**Việc cần làm**
- Kiểm icon đang nhúng trong exe bằng PowerShell: `[System.Drawing.Icon]::ExtractAssociatedIcon('src-tauri/target/release/tieumai.exe')`, lưu ra PNG rồi xem.
- Nếu là icon cũ: chạy `cargo clean -p tieumai --release` (hoặc sửa `build.rs`) rồi build lại.
- Windows cache icon theo đường dẫn exe. Nếu exe đã đúng mà taskbar vẫn sai, khởi động lại Explorer hoặc xoá `%LOCALAPPDATA%\IconCache.db`. Phải hỏi người dùng trước khi làm vì đụng tới hệ thống.
- Cửa sổ chính tạo lúc chạy (`show_main` trong `src-tauri/src/lib.rs`). Có thể gọi `.icon(...)` tường minh cho cửa sổ này.

**Xong khi:** icon trên taskbar, trong Alt+Tab và ở góc tiêu đề đều là Tiểu Mai.

## 3. Tooltip pinyin bị mất nội dung khi chữ nằm sát mép trên

- Tooltip luôn mở phía trên chữ, nên khi chữ ở gần đỉnh cửa sổ thì phần đầu bị cắt (mất dòng pinyin).
- Sửa ở `src/main/components/HoverPinyin.svelte`:
  - Đo kích thước tooltip sau khi render.
  - Phía trên không đủ chỗ thì mở xuống dưới chữ.
  - Ép tooltip nằm trong khung nhìn theo chiều ngang, cả hai mép trái và phải.

**Xong khi:** rê chuột lên chữ ở hàng trên cùng (thẻ chủ đề ở trang chủ) và ở sát mép trái/phải, tooltip hiện đủ cả pinyin, Hán Việt và nghĩa.

## 4. Viết theo nét: thêm phần "xem mẫu" và gợi ý

- Hiện vào trang Viết là phải vẽ ngay, không có mẫu để biết chữ viết thế nào.
- Hanzi Writer có sẵn `animateCharacter()`, `showOutline`, `highlightStroke()` và tuỳ chọn `showHintAfterMisses`.

**Việc cần làm** (`src/main/pages/Write.svelte`, `src/main/components/HanziStroke.svelte`)
- Nút **"Xem mẫu"**: chạy hoạt hình thứ tự nét, có thể xem lại.
- Lần đầu vào chữ thì tự chạy mẫu một lần trước khi cho vẽ; thêm tuỳ chọn tắt.
- Nút **"Gợi ý nét"**: nháy sáng nét tiếp theo cần viết.
- Bật/tắt nét mờ làm nền (outline).
- Sai nhiều lần thì tự gợi ý.

**Xong khi:** người mới vào trang Viết xem được mẫu, vẽ theo, và được gợi ý khi bí.

## 5. Nút quay lại quá nhỏ

- "← Luyện tập" và "← Quay lại" đang là link chữ nhỏ.
- Tạo component `src/main/components/BackButton.svelte`:
  - Dạng nút có viền hoặc nền, cao khoảng 36 px, icon mũi tên rõ, có hiệu ứng hover và focus.
  - Có phím tắt `Esc` hoặc `Alt+←`.
- Dùng component này cho mọi trang đang có link quay lại (`Write`, `Word`, `Quiz`, `Tones`, `Topic`…). Dùng Grep tìm `← ` trong `src/main/pages`.

**Xong khi:** nút quay lại ở mọi trang dễ thấy, dễ bấm, giống nhau.

## 6. Trang Ôn tập: các nút "1 · Quên / 2 · Khó / 3 · Nhớ / 4 · Dễ" không có giải thích

- Đây là cách chấm mức nhớ của FSRS: mỗi nút hẹn lần ôn tiếp theo sau thời gian ghi bên dưới (1 phút, 6 phút, 10 phút, 1 ngày).
- Người dùng không biết bấm vào để làm gì.

**Việc cần làm** (`src/main/pages/Review.svelte`)
- Thêm một dòng hướng dẫn phía trên các nút, ví dụ: "Bạn nhớ từ này đến đâu? Chọn một mức, Tiểu Mai sẽ hẹn lần ôn tiếp theo."
- Mỗi nút có `title` giải thích, ví dụ "Quên: chưa nhớ ra, ôn lại sau 1 phút".
- Đổi chữ dưới mỗi nút thành "ôn lại sau 1 phút" cho dễ hiểu.
- Cân nhắc chỉ hiện nghĩa và các nút sau khi bấm "Xem đáp án" (Space). Hiện tại nghĩa hiện sẵn nên khó tự kiểm tra trí nhớ. Xem lại luồng đang làm trước khi đổi.

**Xong khi:** người mới nhìn trang Ôn tập hiểu cần làm gì mà không cần hỏi.

## 7. Trang chi tiết từ: nút quay lại không chạy, và các chữ vẽ cùng lúc

**Nút quay lại**
- Mở trang từ bằng cách bấm chữ trên bong bóng (`ipc.openMain('/word/…')`, sự kiện `main:navigate`) thì không có trang trước trong lịch sử, nên "Quay lại" không làm gì.
- Sửa trong `src/main/router.svelte.ts`: quay lại khi không có trang trước thì chuyển về trang cha hợp lý, ví dụ `/search` hoặc trang chủ.
- Kiểm cả trường hợp cửa sổ chính được tạo mới lúc bấm từ bong bóng.

**Vẽ từng chữ lần lượt**
- Với từ nhiều chữ (您好), các chữ đang chạy hoạt hình nét cùng lúc nên rối mắt.
- Sửa trong `src/main/pages/Word.svelte` và `HanziStroke.svelte`: chạy lần lượt từ trái sang phải, chữ sau bắt đầu khi chữ trước xong (dùng promise hoặc callback `onComplete` của `animateCharacter`).
- Nút "Xem lại nét" cũng chạy theo thứ tự này.

**Xong khi:** bấm từ trên bong bóng → trang từ mở → "Quay lại" về được trang tra cứu; các chữ vẽ lần lượt từng chữ.

## 8. Tuỳ chọn ẩn Tiểu Mai, chỉ giữ bảng từ vựng

- Thêm setting, ví dụ `petMode: 'full' | 'bubbleOnly'`, trong `src/lib/settings.svelte.ts`. Có công tắc trong Cài đặt → Trợ lý, và có thể thêm vào menu chuột phải cùng menu khay.

**Ở chế độ chỉ bong bóng** (`src/pet/Pet.svelte`, `src/pet/geometry.ts`)
- Không vẽ sprite. Cửa sổ thu lại vừa bong bóng.
- Vùng nhận chuột chỉ còn bong bóng.
- Kéo bằng thanh tiêu đề của bong bóng (dòng chủ đề / HSK), vì hiện chỉ kéo được bằng nhân vật. Chuột phải lên bong bóng mở menu.
- Bám mép và giới hạn trên màn hình vẫn đúng; mở rộng test trong `src/pet/geometry.test.ts`.
- Bỏ đuôi nhọn chỉ vào đầu nhân vật.

**Xong khi:** bật tuỳ chọn thì nhân vật biến mất, bảng từ vẫn đổi từ đều đặn, vẫn kéo được, vẫn bám mép, vẫn mở được menu.

## 9. Nút loa trên bảng từ vựng lúc nào cũng hiện

- Bong bóng đã có nút 🔊, nhưng chỉ hiện khi đã cài giọng đọc (`canSpeak={speechAvailable()}` trong `src/pet/Pet.svelte`, `src/pet/Bubble.svelte`). Chưa cài giọng thì người dùng không thấy nút, nên không biết có tính năng này.
- Luôn hiện nút 🔊 cạnh pinyin, hoặc cạnh chữ Hán cho dễ bấm:
  - **Đã có giọng:** bấm là đọc từ đó qua `speak(word.hanzi)`.
  - **Chưa có giọng:** nút mờ đi, `title` ghi "Chưa cài giọng đọc — bấm để cài". Bấm thì mở cửa sổ chính ở Cài đặt → Giọng đọc qua `ipc.openMain('/settings')`; nếu trang có anchor thì cuộn tới mục đó.
- Kiểm nút có cập nhật ngay khi người dùng vừa cài giọng ở cửa sổ chính không. Settings đồng bộ giữa hai cửa sổ qua store `onKeyChange`, nhưng `speechAvailable()` có thể không theo dõi thay đổi. Nếu không cập nhật thì đưa nó thành `$derived` theo `settings.speech`.
- Phím tắt trên bong bóng không cần, vì cửa sổ trợ lý không giữ focus.

**Xong khi:** máy chưa cài giọng vẫn thấy nút loa và bấm vào thì tới đúng trang cài; cài xong (giọng hệ thống, API hoặc gói giọng) thì bấm nút loa nghe được ngay, không cần khởi động lại app.

## Còn tồn từ phiên trước

- **RAM:** đo lần gần nhất có lúc vọt lên 165,7 MB, vượt ngân sách 150 MB (trung bình vẫn 128,6 MB). Chưa rõ nguyên nhân. Đo lại khi màn hình đang mở bằng `pnpm perf`, để 10 phút.
- **Chưa kiểm trên màn hình thật:** nhân vật v2 đứng sát mép, và logo ở thanh tiêu đề cửa sổ chính.
- **GitHub:** mục About (Description, Topics) chưa đặt vì máy chưa có GitHub CLI. Nội dung cần dán nằm trong tin nhắn cuối của phiên trước.
- **Hán Việt:** một số từ Hán Việt hiếm nhưng có thật đang bị ẩn (健康, 受伤, 有利…). Muốn hiện thì sửa `data/hanviet/word-verdicts.tsv` rồi chạy `pnpm data:build`.

## 10. Dựng lại nhân vật bằng VRoid Studio (việc tiếp theo, ghi ngày 2026-11-04)

Bản MakeHuman v4 (xem `docs/CHARACTER.md`) được tạm chấp nhận. Dáng, động tác và chuyển động đã ổn, nhưng gương mặt chưa đẹp được như ảnh mẫu, vì MakeHuman chỉ có thanh trượt nặn mặt và tóc dạng tấm. Người dùng muốn dựng lại nhân vật bằng VRoid Studio.

**Ảnh mẫu** nằm ở `references/character/`, kèm `README.md` mô tả. Thư mục này nằm trong `.gitignore`, không đưa lên repo vì ảnh trang phục là ảnh người thật.
- `face-reference.png`: gương mặt do AI tạo, người dùng muốn giống càng sát càng tốt.
  - Mặt tròn-oval mềm, cằm nhỏ, má đầy.
  - Mắt to nâu sẫm hơi cụp, hai mí.
  - Mũi nhỏ, môi hồng khép, mỉm cười nhẹ.
  - Mái thưa màu nâu sáng, tóc mai hai bên, buộc thấp phía sau.
  - Kính tròn gọng mảnh trong suốt hoặc bạc; da trắng ấm.
- `figure-outfit-reference.png`: lấy **hình dáng và trang phục**, không lấy tư thế.
  - Dáng mảnh, chân dài.
  - Áo sơ mi trắng cắt lửng, cổ bẻ, tay ngắn, nơ đen.
  - Chân váy bút chì ngắn kẻ caro xám.

**Đã chốt với người dùng:**
- **Tư thế nghỉ:** đứng thả lỏng, trọng tâm dồn một chân, tay trái chống hông, tay phải buông. Đây là bộ động tác v2/v4 trong `tools/skins/makehuman/build.py`.
- **Động tác:** thở, chớp mắt, nhìn quanh, vén tóc, chống cằm, nói kèm cử chỉ, vẫy tay, chắp tay cười, dáng bị nhấc khi kéo, ngủ gật.
- **Chuyển động mượt:** mọi động tác đi lên từ tư thế nghỉ và hạ về qua các khung trung gian; không giật về khung đầu. Chuyển động tay 120–200 ms mỗi khung.
- **Phía mép màn hình:** tay phải (phía mép) luôn nằm trong bóng dáng lúc nghỉ; mọi động tác vươn tay dùng tay trái. `facing: "right"`. Định dạng `meta.json` giữ như `tools/skins/pack.py` đang đọc.
- **Giới hạn khung:** khoảng 55 khung trở xuống, không khung nào chạm mép ảnh render.

**Hướng làm dự kiến:**
1. Dựng nhân vật trong VRoid Studio (miễn phí).
2. Xuất file `.vrm`.
3. Nhập vào Blender bằng add-on VRM (VRM Add-on for Blender).
4. Dùng lại khung camera, ánh sáng, render, pipeline kiểm và đóng gói hiện có.
5. Chuyển tư thế và động tác sang khung xương humanoid của VRM. Mặt, chớp mắt và cười dùng blendshape có sẵn của VRM.

**Cần xác nhận trước khi làm:**
- **Điều khoản VRoid:** nhân vật do người dùng tự dựng trong VRoid Studio thuộc quyền người dùng. Cần kiểm điều khoản mới nhất của VRoid Studio và metadata giấy phép trong file VRM trước khi phát hành công khai.
- **Ai dựng mô hình:** VRoid Studio là phần mềm có giao diện; agent không tự điều khiển được nếu không có cách tự động hoá. Cần hỏi người dùng tự dựng mô hình, hay mình hướng dẫn từng bước rồi người dùng xuất file `.vrm`.
