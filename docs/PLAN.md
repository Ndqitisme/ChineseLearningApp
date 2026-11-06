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
│ store plugin: settings.json, progress.json (dùng chung 2 cửa sổ)   │
└───────────────┬───────────────────────────────┬────────────────────┘
      cửa sổ "pet" (luôn tồn tại)        cửa sổ "main" (tạo khi mở,
      trong suốt, không viền, luôn nổi    HUỶ khi đóng để trả RAM)
```

- Đóng hết cửa sổ thì app không thoát; chỉ thoát khi chọn "Thoát" ở tray.
- Hai cửa sổ dùng chung store. Một bên ghi thì bên kia nhận `onKeyChange` và cập nhật.
- Lưu trữ bằng `tauri-plugin-store` (JSON). Vài nghìn thẻ chỉ vài trăm KB nên không cần SQLite.

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

## 3. Trợ lý

- **Vị trí:** mặc định đứng trên taskbar ở góc phải. Kéo đi đâu cũng được; kéo chỉ bắt đầu khi chuột đã di quá vài px để click vẫn là click. Thả gần mép thì hít vào mép theo vùng làm việc của màn hình. Nhớ vị trí theo từng màn hình.
- **Bong bóng** ở cạnh nhân vật, ngang đầu; tự đổi bên theo nửa màn hình đang đứng. Kéo được từ mọi chỗ trên bong bóng trừ nút.
- **Click xuyên:** phần trong suốt không chặn chuột. Rust hỏi vị trí chuột khoảng 15 lần/giây và chỉ nhận chuột khi con trỏ nằm trên vùng nhân vật, bong bóng hay menu mà trang báo lên. Wayland không có API này nên cửa sổ luôn nhận chuột.
- **Nhịp:** mỗi từ ở lại `wordSec` giây, nội dung mờ đi rồi từ mới hiện lên; khung bong bóng không tắt đi bật lại.
- **Đoán trước:** với từ đã gặp nhiều lần, chữ hiện trước, nghĩa hiện sau khoảng 2,5 giây.
- **Trên bong bóng:** nút loa, "Biết rồi" (giảm tần suất), sao (lưu sổ tay); bấm chữ để mở trang từ. Rê chuột lên bong bóng thì giữ từ đang hiện.
- **Menu chuột phải:** từ tiếp theo, tạm dừng 30 phút, mở app, ẩn nhân vật nhưng giữ bảng từ, ẩn trợ lý.
- **Tự tạm dừng:** có app toàn màn hình hoặc trình chiếu, không chạm máy quá `idlePauseMin` phút, giờ yên lặng, hoặc tạm dừng từ tray hay menu. Khi tạm dừng cô ngủ.
- **Chuyển động:** đứng yên giữ một khung, chỉ cử động khi có sự kiện; yêu cầu chi tiết ở [CHARACTER.md](CHARACTER.md).

## 4. App chính

- Danh sách màn hình và chế độ luyện: README, mục Tính năng.
- Pinyin khi rê chuột: một bộ lắng nghe `pointermove` ở `document`, giới hạn theo `requestAnimationFrame`; `caretPositionFromPoint` cho ký tự dưới con trỏ. Vùng đã hiện pinyin gắn `data-has-pinyin`; vùng mà pinyin là đáp án gắn `data-hover-pinyin="off"`.
- Theme là bộ design token dạng biến CSS: 5 theme, mỗi theme có bản sáng và tối; người dùng sửa được từng token hoặc dán CSS riêng. UI mới chỉ dùng token, không viết màu cứng.
- Icon là mask CSS tô bằng `currentColor` (`src/lib/ui/Icon.svelte`); không dùng emoji.
- Pinyin hiển thị bằng font chữ Hán vì Nunito thiếu ǐ ǒ ǖ ǘ ǚ ǜ.

## 5. Thuật toán học

### 5.1 Lộ diện thụ động (trợ lý)

- Nhóm từ gồm các chủ đề và cấp HSK đang bật, xếp theo chủ đề rồi tần suất.
- Luôn giữ một nhóm mới khoảng 6 từ. Mỗi từ mới được chiếu khoảng 5 lần với khoảng cách giãn dần (sau 1, 3, 8, 20 lượt), rồi chuyển sang "đã quen" và một từ mới vào nhóm.
- Mỗi lượt chọn theo trọng số: khoảng 60% nhóm mới, 25% từ đã quen lâu chưa gặp, 15% thẻ FSRS đến hạn.
- Từ đã bấm "Biết rồi" thỉnh thoảng vẫn nhắc lại với tỉ lệ thấp.
- Không lặp một từ trong 5 lượt liên tiếp.
- Logic là hàm thuần, có test (`src/lib/scheduler.ts`).

### 5.2 Học chủ động (FSRS)

- Mỗi từ một thẻ FSRS cho kỹ năng nhận mặt chữ và nghĩa.
- Đoán nghĩa: đúng và nhanh → Good, đúng nhưng chậm → Hard, sai → Again. Flashcard cho người dùng tự chấm 4 mức.
- Viết theo nét chỉ thống kê số lần sai theo chữ; không có lịch FSRS riêng.

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

Số đo gần nhất: bản release, chỉ trợ lý, mỗi 16 giây một từ, 180 giây, hai lần.
- CPU trung bình 3,4–3,9% một nhân.
- RAM private trung bình 160–171 MB, cao nhất 185 MB.
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
- `tools/data/sources.lock.json` ghim URL, commit và sha256 của mọi nguồn tải về.
- Nghĩa CVDICT khớp theo pinyin (满 có mục "dân tộc Mãn Châu"); bỏ thẻ lượng từ `LT:`.
- Unihan `kVietnamese` chỉ là gợi ý (nhiều âm Nôm: 你 "nể"). Hán Việt ghép theo cặp (chữ, pinyin).
- Hán Việt chỉ hiện khi là từ Hán Việt thật và cùng nghĩa (`data/hanviet/word-verdicts.tsv`); chưa chắc thì ẩn. Muốn hiện một từ đang ẩn thì sửa file đó rồi chạy `pnpm data:build`.
- Sửa nghĩa ngắn không cần đụng code: `data/gloss-overrides.tsv`. Sửa pinyin HSK: `data/hsk-pinyin-overrides.tsv`.
- Pinyin câu ví dụ được đối chiếu tự động với pinyin-pro; chỗ lệch được báo để duyệt.
- Chỉ dùng file export của CC-CEDICT, không cào web MDBG.
- Font chữ Hán là bản cắt của LXGW WenKai Lite, đổi tên thành "TieuMai Kai" theo OFL.

## 9. Ràng buộc đã chốt

| Ràng buộc | Lý do |
|---|---|
| Phát hành công khai, miễn phí; không nguồn NC hay ND | Quyết định của chủ repo |
| Không đóng gói giọng; giọng là plugin | App nhẹ; ai cần thì tự cài |
| Chữ giản thể; pinyin ghi biến điệu của 一/不 như sách HSK | Chuẩn đại lục, đúng thói quen giáo trình |
| Giữ cả hai bộ HSK (2021 và 2025), mặc định 2021; không ghi ngày đổi kỳ thi | Các nguồn chưa thống nhất ngày chuyển |
| HSK 1–3 mở sẵn; người học tự mở 4 → 5 → 6, không tài khoản, không trả phí | Quyết định của chủ repo |
| Tab "Ủng hộ tác giả": một câu và mã QR; không popup, không nhắc | Không gây áp lực |
| ts-fsrs ghim 5.4.2 | Bản 6 đổi API sang async và khai báo Node ≥ 24 |
| Tauri 2 + Svelte 5 | Cửa sổ trong suốt, luôn nổi, tray, autostart có sẵn; bundle nhỏ; Svelte không có virtual DOM |
| Lối thoát nếu RAM vượt ngân sách: viết lại riêng cửa sổ trợ lý bằng Rust native | Lõi dữ liệu và app chính giữ nguyên |

## 10. Chưa xác nhận

| Vấn đề | Tình trạng |
|---|---|
| CPU và RAM với nhân vật mới vượt ngân sách (mục 6) | Đo lại 10 phút khi màn hình mở; giảm khung hình của clip nói rồi đo lại |
| Wayland: không luôn nổi, không đọc vị trí chuột, không tự đặt vị trí | Giới hạn nền tảng; `GDK_BACKEND=x11` chưa kiểm |
| macOS: Tauri luôn bật private API | Chưa rõ ảnh hưởng tới Mac App Store; phát hành ngoài Store trước |
| Phát hiện toàn màn hình trên macOS và Linux | Chỉ có trên Windows; hai hệ kia chỉ dựa vào thời gian rảnh tay |
| macOS, Linux | Chỉ build qua CI, chưa chạy trên máy thật |
| Nghĩa ngắn, câu ví dụ, Hán Việt | AI viết và soát, chưa có người bản ngữ duyệt |
| Kokoro tiếng Trung xếp hạng D, chữ đơn có thể sai thanh | Gói giọng là tuỳ chọn; tool có danh sách ép âm cho chữ đa âm |

## 11. Mobile sau này

- Android: plugin Kotlin chạy foreground service, vẽ view nổi `TYPE_APPLICATION_OVERLAY` (quyền `SYSTEM_ALERT_WINDOW`; phải kiểm chính sách Google Play).
- iOS không cho cửa sổ nổi: thay bằng widget WidgetKit "từ của giờ này" và thông báo cục bộ.
- App chính dùng lại `src/lib` và `src/main`; chạm giữ thay cho rê chuột.
