# Tiểu Mai (小梅): thiết kế và ràng buộc

Tài liệu này mô tả app đang làm gì và những gì phải giữ khi sửa.
Tính năng tiếp theo: [ROADMAP.md](ROADMAP.md). Nhân vật trợ lý: [CHARACTER.md](CHARACTER.md).

## 1. Mục tiêu

Người Việt học từ vựng tiếng Trung thông dụng (đời sống, ăn uống, công việc) mà không cần ngồi vào học.
Một trợ lý đứng ở cạnh màn hình, bong bóng cạnh cô luôn hiện một từ: chữ Hán, pinyin, nghĩa tiếng Việt, âm Hán Việt.
Muốn học chủ động thì mở app chính: đoán nghĩa, viết theo nét, luyện thanh điệu, ôn theo lịch lặp lại ngắt quãng.

| Tiêu chí | Cách kiểm |
|---|---|
| Trợ lý chạy nền cả ngày trên máy yếu (i5-4570, Intel HD 4600) mà không thấy nặng | `pnpm perf`, đo 10 phút; ngân sách ở mục 6 |
| Mỗi từ có chữ, pinyin, nghĩa Việt ngắn; âm Hán Việt khi là từ Hán Việt thật; từ theo chủ đề có câu ví dụ | `pnpm data:build` báo lỗi, không lặng lẽ bỏ qua |
| Chạy được khi không có mạng và không cài giọng | Chạy thật |
| Một mã nguồn cho Windows, macOS, Linux; mobile làm sau trên cùng lõi | Build Windows tại máy; macOS và Linux qua GitHub Actions |

Ngoài phạm vi: chữ phồn thể, ngữ pháp, chấm phát âm bằng nhận dạng giọng nói, đồng bộ đám mây, tài khoản.

## 2. Kiến trúc

```
┌──────────────────────── Lõi Rust (Tauri 2) ────────────────────────┐
│ tray menu · single-instance · autostart (--autostart = chỉ trợ lý) │
│ pet: poller click-xuyên ~15 Hz, giữ luôn-nổi mỗi 2 s               │
│ pause: toàn màn hình/trình chiếu (SHQueryUserNotificationState),   │
│        rảnh tay > N phút (GetLastInputInfo) → phát event           │
│ speech: proxy HTTP + cache đĩa, đọc file gói giọng                 │
│ store: settings.json, progress.json; ghi nguyên tử, giữ .bak       │
└───────────────┬───────────────────────────────┬────────────────────┘
      cửa sổ "pet" (luôn tồn tại)        cửa sổ "main" (tạo khi mở,
      trong suốt, không viền, luôn nổi    HUỶ khi đóng để trả RAM)
```

- Đóng hết cửa sổ thì app không thoát; chỉ thoát khi chọn "Thoát" ở tray.
- Hai cửa sổ dùng chung store do Rust giữ (`src-tauri/src/store.rs`, lệnh `store_load` và `store_set`). Mỗi lần ghi, Rust phát `store:change` tới cả hai cửa sổ theo đúng thứ tự ghi.
- Lưu trữ là JSON. Vài nghìn thẻ chỉ vài trăm KB nên không cần SQLite.
- Mỗi lần lưu: ghi file tạm, sync xuống đĩa, đổi file cũ thành `.bak`, rồi đổi tên file tạm. Cài đặt lưu sau 300 ms, tiến độ sau 1,5 s; thoát từ tray thì lưu ngay.
- Khi mở app, file hỏng được cất thành `.damaged` và khôi phục từ `.bak`, kèm một hộp thoại báo. Không có bản sao lưu thì bắt đầu trống và vẫn giữ file hỏng.
- Quyền theo từng cửa sổ: `src-tauri/capabilities/main.json` và `pet.json`. Lệnh Rust mới phải khai trong `src-tauri/build.rs` và cấp ở file của cửa sổ dùng nó.

| Thư mục | Nội dung |
|---|---|
| `src/lib/` | Lõi dùng chung, thuần TS, không phụ thuộc Tauri (để mobile dùng lại) |
| `src/pet/` | Cửa sổ trợ lý |
| `src/main/` | Cửa sổ chính |
| `src-tauri/` | Lõi Rust |
| `data/` | Nội dung biên soạn tay: chủ đề, câu ví dụ, Hán Việt, sửa nghĩa, sửa pinyin |
| `tools/data/` | Tải nguồn (ghim URL và sha256), ghép, kiểm, cắt font |
| `tools/e2e/` | Bộ e2e: puppeteer với mock Tauri |
| `tools/icons/`, `tools/logo/` | Nguồn icon và logo |
| `tools/skins/` | Dựng nhân vật (xem [CHARACTER.md](CHARACTER.md)) |
| `tools/perf/`, `tools/voicepack/` | Đo CPU/RAM; sinh gói giọng |
| `src/generated/`, `public/strokes/` | Sinh ra bởi `data:build`, không commit |

Kiểu dữ liệu nằm ở `src/lib/types.ts`.
- `Word.hsk` là cấp trong bộ 2021, `Word.hsk2025` là cấp trong bộ 2025.
- Từ có cấp thấp nhất (ở một trong hai bộ) từ 3 trở xuống nằm trong dữ liệu chính; còn lại nằm trong gói `src/generated/hsk{4,5,6}.json`, nạp khi mở khoá.
- Khoá của `progress.srs` là id từ; mỗi từ một thẻ FSRS.

## 3. Bảng gợi ý và trợ lý

- **Tên gọi:** bảng gợi ý là cửa sổ bong bóng từ (`settings.petEnabled`); trợ lý là nhân vật (`settings.petCharacter`). Mọi chữ trong app dùng đúng hai tên này.
- **Bật, tắt:** thanh bên của app chính có hai công tắc "Bảng gợi ý" và "Trợ lý". Khi bảng gợi ý tắt, công tắc trợ lý xám và không bấm được; bật bảng gợi ý thì nó chuyển dần sang màu thường và giữ giá trị cũ. Cài đặt có hai dòng cùng nghĩa, cùng chiều.
- **Vị trí:** mặc định đứng trên taskbar ở góc phải. Kéo đi đâu cũng được; kéo chỉ bắt đầu khi chuột đã di quá vài px để click vẫn là click. Thả gần mép thì hít vào mép theo vùng làm việc của màn hình. Nhớ vị trí theo từng màn hình, lưu theo chỗ chân cô đứng để đổi cỡ nhân vật không làm cô lơ lửng.
- **Bong bóng** ở cạnh nhân vật, ngang đầu; tự đổi bên theo nửa màn hình đang đứng. Kéo được từ mọi chỗ trên bong bóng trừ nút.
- **Click xuyên:** phần trong suốt không chặn chuột. Rust hỏi vị trí chuột khoảng 15 lần/giây và chỉ nhận chuột khi con trỏ nằm trên vùng nhân vật, bong bóng hay menu mà trang báo lên. Wayland không có API này nên cửa sổ luôn nhận chuột.
- **Nhịp:** mỗi từ ở lại `wordSec` giây, nội dung mờ đi rồi từ mới hiện lên; khung bong bóng không tắt đi bật lại.
- **Đoán trước:** với từ đã gặp nhiều lần, chữ hiện trước, nghĩa hiện sau khoảng 2,5 giây. Bật tự đọc thì từ được đọc khi nghĩa hiện ra.
- **Trên bong bóng:** nút loa, "Biết rồi" (giảm tần suất), sao (lưu sổ tay); bấm chữ để mở trang từ. Rê chuột lên bong bóng thì giữ từ đang hiện.
- **Menu chuột phải:** từ tiếp theo, tạm dừng 30 phút, mở app, ẩn hoặc hiện trợ lý, ẩn bảng gợi ý. Đang tạm dừng hoặc trong giờ yên lặng thì menu có "Tiếp tục".
- **Tự tạm dừng:** có app toàn màn hình hoặc trình chiếu (kiểm cả lúc khởi động), không chạm máy quá `idlePauseMin` phút, giờ yên lặng, hoặc tạm dừng từ tray hay menu. Khi tạm dừng cô ngủ.
- Toàn màn hình và rảnh tay chỉ phát hiện được trên Windows (`src-tauri/src/system.rs`, mục 10).
- **Tiếp tục trong giờ yên lặng** có hiệu lực tới hết khung giờ đó; tạm dừng lại thì huỷ.
- **Tính lượt hiện:** một lượt chỉ được tính khi người dùng đang dùng máy (rảnh tay dưới 60 giây) và cô đang hiện. Lúc cô ẩn, "Từ tiếp theo" ở tray không làm gì.
- **Chuyển động:** đứng yên giữ một khung, chỉ cử động khi có sự kiện; yêu cầu chi tiết ở [CHARACTER.md](CHARACTER.md).

## 4. App chính

- Danh sách màn hình và chế độ luyện: README, mục Tính năng.
- Pinyin khi rê chuột: một bộ lắng nghe `pointermove` ở `document`, giới hạn theo `requestAnimationFrame` và luôn dùng vị trí chuột mới nhất; `caretPositionFromPoint` cho ký tự dưới con trỏ, cả chiều cao dòng tính là trúng chữ. Vùng đã hiện pinyin gắn `data-has-pinyin`; vùng mà pinyin là đáp án gắn `data-hover-pinyin="off"`. Cửa sổ trợ lý chỉ tra từ điển của app, chữ ngoài từ điển không có gợi ý.
- Giao diện kính (khúc xạ trên Chromium, bản thay thế trên WebKit), công tắc, thanh trượt, danh sách chọn: [UI-GLASS.md](UI-GLASS.md).
- Theme là bộ design token dạng biến CSS: 5 theme, mỗi theme có bản sáng và tối; người dùng sửa được từng token (riêng cho chế độ sáng và tối) hoặc dán CSS riêng. UI mới chỉ dùng token, không viết màu cứng.
- Đổi bộ HSK chỉ đổi nhóm từ, cấp và bài học. Ôn tập, sổ tay, tra cứu và trang từ giữ từ của cả hai bộ; khoá cấp vẫn áp dụng, từ chủ đề luôn mở.
- Icon là mask CSS tô bằng `currentColor` (`src/lib/ui/Icon.svelte`); không dùng emoji.
- Pinyin hiển thị bằng font chữ Hán vì Nunito thiếu ǐ ǒ ǖ ǘ ǚ ǜ.

## 5. Thuật toán học

### 5.1 Lộ diện thụ động (trợ lý)

- Nhóm từ gồm các chủ đề và cấp HSK đang bật, xếp theo chủ đề rồi tần suất.
- Luôn giữ một nhóm mới khoảng 6 từ. Mỗi từ mới được chiếu 5 lần, cách nhau ít nhất 1, 3, 8, 20 phút, rồi chuyển sang "đã quen" và một từ mới vào nhóm.
- Khoảng cách là bắt buộc: từ đang học chưa tới giờ thì không bao giờ hiện sớm, kể cả khi thẻ FSRS của nó đến hạn.
- Mỗi lượt chọn theo trọng số: khoảng 60% nhóm mới, 25% từ đã quen lâu chưa gặp, 15% thẻ FSRS đến hạn.
- Lượt không có từ đang học nào tới giờ thì hiện từ đã quen hoặc thẻ đến hạn. Không có cả hai thì cho thêm một từ mới vào nhóm, vượt mức 6.
- Nhóm từ quá nhỏ, mọi từ đều đang chờ: bong bóng giữ từ đang hiện. Lúc chưa có bong bóng (sau khi khởi động hay sau app toàn màn hình) thì hiện lại từ vừa hiện gần nhất, không tính là một lượt.
- Từ đã bấm "Biết rồi" thỉnh thoảng vẫn nhắc lại với tỉ lệ thấp.
- Không lặp một từ trong 5 lượt liên tiếp.
- Logic là hàm thuần, có test (`src/lib/scheduler.ts`).

### 5.2 Học chủ động (FSRS)

- Mỗi từ một thẻ FSRS cho kỹ năng nhận mặt chữ và nghĩa.
- Đoán nghĩa: đúng và nhanh → Good, đúng nhưng chậm → Hard, sai → Again. Flashcard cho người dùng tự chấm 4 mức.
- Ôn tập nhận tối đa 10 thẻ mới mỗi ngày. Thẻ hẹn lại trong 20 phút (Again, hoặc thẻ mới chấm Hard/Good) quay lại ngay trong buổi.
- Viết theo nét chỉ thống kê số lần sai theo chữ; không có lịch FSRS riêng.
- Luyện thanh điệu không ghi thẻ FSRS. Chọn thanh chấp nhận cả thanh gốc và thanh biến điệu (一, 不, 3-3); điểm cao độ của bản thu vẫn so với thanh ghi trong dữ liệu.

## 6. Hiệu năng

| Trạng thái | Ngân sách |
|---|---|
| Chỉ trợ lý, đứng yên | CPU trung bình dưới 0,5% một nhân; RAM (private working set của cả cây `app.exe` + `msedgewebview2.exe`) dưới 150 MB |
| Bong bóng đổi từ | CPU tăng dưới 5% trong dưới 300 ms |
| App chính đang mở | RAM dưới 300 MB |
| Sau khi đóng app chính | RAM về mức đứng yên cộng tối đa 15 MB |

- Đứng yên thì trang không vẽ khung nào.
- Cửa sổ trợ lý chỉ nạp dữ liệu cần dùng, không nạp pinyin-pro hay Hanzi Writer.
- Cửa sổ chính bị huỷ khi đóng.
- Cách đo: `pnpm perf` (`tools/perf/measure.ps1 -Seconds 600`) lấy mẫu mỗi giây cây tiến trình của app, xuất CSV, in trung bình và p95.

Số đo gần nhất (2026-11-07): bản release, chỉ trợ lý (`--autostart`), nhân vật bật, mỗi 16 giây một từ, đo 600 giây sau 30 giây khởi động, một lần.
- CPU trung bình 3,6% một nhân; p95 16%; giữa các lần đổi từ khoảng 1,5%.
- RAM private trung bình 172 MB, cao nhất 188 MB.
- Đo qua Remote Desktop: RAM đáng tin, CPU có thể khác khi ngồi tại máy vì WebView vẽ theo đường khác.
- Lần đo trước (tại máy, 180 giây, hai lần) cho CPU 3,4–3,9% và RAM 160–171 MB.
- Cả hai đều vượt ngân sách; chi tiết và nguyên nhân ở [CHARACTER.md](CHARACTER.md) mục 2.

## 7. Giọng đọc

App không mang sẵn âm thanh. Có 3 loại nhà cung cấp, mỗi loại gán vào 2 vai: nam trầm ấm và nữ dễ thương.

| Nhà cung cấp | Hoạt động |
|---|---|
| `system` | `speechSynthesis` của WebView với giọng zh-CN cài trong hệ điều hành |
| `http` | Gọi API qua Rust (tránh CORS), cache file trên đĩa. Mẫu sẵn: OpenAI-compatible `/v1/audio/speech`, Azure Speech, URL tuỳ chỉnh |
| `pack` | Thư mục `manifest.json` + MP3 theo từ. `tools/voicepack` sinh gói bằng sherpa-onnx + Kokoro-82M (Apache-2.0, chạy CPU) |

- Gói giọng là MP3 mono 24 kHz 48 kbps; không dùng Opus vì WKWebView hỗ trợ chập chờn.
- Không dùng edge-tts (endpoint không chính thức), F5-TTS (trọng số NC), Fish-Speech (giới hạn doanh thu).

## 8. Dữ liệu

- Nguồn và giấy phép: README, mục Dữ liệu và giấy phép; chi tiết ở `THIRD_PARTY_NOTICES.md`.
- `tools/data/sources.lock.json` ghim URL, commit và sha256 của mọi nguồn tải về. Nguồn mới phải ghim bằng `pnpm data:fetch --update`.
- `pnpm data:build` dừng với lỗi khi thiếu file TSV trong `data/`, thiếu dữ liệu nét của một chữ đang hiện, hoặc font TieuMai Kai thiếu một ký tự Hán hay pinyin trong dữ liệu và UI, kể cả chữ Hán trong nghĩa tiếng Việt.
- Lỗi font thì chạy `pnpm data:fonts` (Python có fonttools) rồi build lại. Chữ Hán mới viết trong UI phải thêm vào `ui_han` trong `tools/data/subset_font.py`.
- Nghĩa CVDICT khớp theo pinyin (满 có mục "dân tộc Mãn Châu"); bỏ thẻ lượng từ `LT:`.
- Chữ Hán trong nghĩa tiếng Việt chỉ ghi giản thể: cặp phồn|giản của CVDICT (`兩個|两个`) chỉ giữ chữ giản. Bộ kiện như 刂, 亻 giữ nguyên.
- Unihan `kVietnamese` chỉ là gợi ý (nhiều âm Nôm: 你 "nể"). Hán Việt ghép theo cặp (chữ, pinyin).
- Hán Việt chỉ hiện khi là từ Hán Việt thật và cùng nghĩa (`data/hanviet/word-verdicts.tsv`); chưa chắc thì ẩn. Muốn hiện một từ đang ẩn thì sửa file đó rồi chạy `pnpm data:build`.
- Sửa nghĩa ngắn không cần đụng code: `data/gloss-overrides.tsv`. Sửa pinyin HSK: `data/hsk-pinyin-overrides.tsv`.
- Từ HSK có nhiều cách đọc: pinyin-pro chọn cách đọc. Cách nó đọc không trùng cách nào trong danh sách HSK thì `pnpm data:build` báo lỗi kèm tên từ; thêm cách đọc đúng vào `data/hsk-pinyin-overrides.tsv`.
- Pinyin từ HSK ghi biến điệu của 一 và 不: 一 thanh 1 và 不 thanh 4 lấy thanh pinyin-pro đọc cho cả từ, nếu đó là biến điệu (不 → bú; 一 → yí, yì). pinyin-pro giữ yī ở số thứ tự và cuối từ (第一, 一月, 统一).
- Các âm tiết khác giữ đúng danh sách HSK, cả thanh nhẹ (不客气 búkèqi). 一, 不 thanh nhẹ giữ nguyên. Không ghi biến điệu 3-3.
- Từ có trong `data/hsk-pinyin-overrides.tsv` ghi đúng như dòng đó, không đổi 一, 不. Từ đã đổi được liệt kê trong `.cache/reports/hsk-yi-bu-sandhi.tsv`.
- Pinyin câu ví dụ được đối chiếu tự động với pinyin-pro; chỗ lệch được báo để duyệt.
- Chỉ dùng file export của CC-CEDICT, không cào web MDBG.
- Font chữ Hán là bản cắt của LXGW WenKai Lite, đổi tên thành "TieuMai Kai" theo OFL.

## 9. Ràng buộc đã chốt

| Ràng buộc | Lý do |
|---|---|
| Phát hành công khai, miễn phí; không nguồn NC hay ND | Quyết định của chủ repo |
| Không đóng gói giọng; giọng là plugin | App nhẹ; ai cần thì tự cài |
| Chữ giản thể, cả chữ Hán trong nghĩa tiếng Việt; pinyin ghi biến điệu của 一/不 như sách HSK, không ghi biến điệu 3-3 | Chuẩn đại lục, đúng thói quen giáo trình |
| Giữ cả hai bộ HSK, mặc định 2025, bản 2021 là tuỳ chọn; không ghi ngày đổi kỳ thi | Các nguồn chưa thống nhất ngày chuyển |
| HSK 1–3 mở sẵn; người học tự mở 4 → 5 → 6, không tài khoản, không trả phí | Quyết định của chủ repo |
| Tab "Ủng hộ tác giả": một câu và mã QR; không popup, không nhắc | Không gây áp lực |
| ts-fsrs ghim 5.4.2 | Bản 6 đổi API sang async và khai báo Node ≥ 24 |
| Tauri 2 + Svelte 5 | Cửa sổ trong suốt, luôn nổi, tray, autostart có sẵn; bundle nhỏ; Svelte không có virtual DOM |
| Lối thoát nếu RAM vượt ngân sách: viết lại riêng cửa sổ trợ lý bằng Rust native | Lõi dữ liệu và app chính giữ nguyên |

## 10. Chưa xác nhận

| Vấn đề | Tình trạng |
|---|---|
| CPU và RAM với nhân vật mới vượt ngân sách (mục 6) | Đo lại 10 phút khi màn hình mở; giảm khung hình của clip nói rồi đo lại |
| Wayland: không luôn nổi, không đọc vị trí chuột, không tự đặt vị trí | Giới hạn nền tảng; `GDK_BACKEND` có x11 đứng trước wayland thì chạy như X11, chưa kiểm trên Linux |
| macOS: Tauri luôn bật private API | Chưa rõ ảnh hưởng tới Mac App Store; phát hành ngoài Store trước |
| Tự tạm dừng trên macOS và Linux | Chỉ có trên Windows; hai hệ kia luôn báo không toàn màn hình và rảnh tay 0 giây, nên chỉ còn giờ yên lặng và tạm dừng tay |
| Linux: tự khởi động với đường dẫn có dấu cách | auto-launch ghi dòng `Exec` không có ngoặc kép; tên app có dấu cách; chưa kiểm |
| macOS: click xuyên trên màn hình phụ khác tỉ lệ | tao đổi toạ độ chuột theo tỉ lệ của màn hình chính; chưa kiểm |
| Cửa sổ chính trên màn hình nhỏ | Kích thước bị giới hạn theo vùng làm việc của màn hình chính; chưa thử trên màn hình nhỏ thật |
| macOS, Linux | Chỉ build qua CI, chưa chạy trên máy thật |
| Nghĩa ngắn, câu ví dụ, Hán Việt | AI viết và soát, chưa có người bản ngữ duyệt |
| Kokoro tiếng Trung xếp hạng D, chữ đơn có thể sai thanh | Gói giọng là tuỳ chọn; tool có danh sách ép âm cho chữ đa âm |

## 11. Mobile sau này

- Android: plugin Kotlin chạy foreground service, vẽ view nổi `TYPE_APPLICATION_OVERLAY` (quyền `SYSTEM_ALERT_WINDOW`; phải kiểm chính sách Google Play).
- iOS không cho cửa sổ nổi: thay bằng widget WidgetKit "từ của giờ này" và thông báo cục bộ.
- App chính dùng lại `src/lib` và `src/main`; chạm giữ thay cho rê chuột.
