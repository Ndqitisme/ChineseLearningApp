<p align="center"><img src="docs/logo.png" alt="Tiểu Mai" width="200" /></p>

# Tiểu Mai (小梅)

Ứng dụng desktop mã nguồn mở giúp người Việt làm quen với từ vựng tiếng Trung thông dụng trong đời sống, ăn uống và công việc mà không cần mở app ra học.

Một trợ lý 3D đứng ở cạnh màn hình. Bong bóng bên cạnh cô luôn hiện một từ, gồm chữ Hán, pinyin tô màu theo thanh điệu, nghĩa tiếng Việt và âm Hán Việt (nếu đó là từ Hán Việt thật). Khi muốn học chủ động, mở cửa sổ chính để luyện đoán nghĩa, viết theo thứ tự nét, luyện thanh điệu và ôn tập theo lịch lặp lại ngắt quãng.

<p align="center"><img src="docs/assistant.png" alt="Trợ lý Tiểu Mai" width="640" /></p>

## Tính năng

- **Trợ lý chạy nền.** Mỗi từ ở lại khoảng 18 giây rồi đổi sang từ mới; khung bong bóng không tắt đi bật lại. Trợ lý tự ẩn khi có ứng dụng toàn màn hình, ngủ khi máy không được dùng hoặc trong giờ yên lặng. Phần trong suốt của cửa sổ cho chuột đi xuyên qua. Có thể kéo trợ lý tới bất kỳ đâu, thả gần mép thì nó tự bám vào mép.
- **Từ vựng:** 2.486 từ, gồm HSK 3.0 cấp 1–3 và 22 chủ đề (682 từ, 648 câu ví dụ).
- **Luyện tập:**
  - Đoán nghĩa.
  - Viết chữ theo thứ tự nét.
  - Luyện thanh điệu: thu âm, đo cao độ và so với đường thanh chuẩn.
  - Ôn tập theo lịch FSRS, sổ tay từ.
  - Tra cứu theo chữ Hán, pinyin (có hoặc không dấu), nghĩa tiếng Việt hoặc Hán Việt.
- **Pinyin khi rê chuột:** rê chuột lên bất kỳ chữ Hán nào trong app để xem pinyin.
- **Giao diện:** 5 theme, mỗi theme có bản sáng và tối; chỉnh được màu và CSS.
- **Giọng đọc (tuỳ chọn, không kèm sẵn):** giọng zh-CN của hệ điều hành, API chuyển văn bản thành giọng nói (kiểu OpenAI `/v1/audio/speech`, Azure Speech hoặc URL tuỳ chỉnh), hoặc gói giọng MP3 cục bộ.

## Nền tảng

[Tauri 2](https://tauri.app) (Rust + WebView của hệ điều hành), Svelte 5, TypeScript, Vite.

- Windows 10/11: đã kiểm trên máy thật.
- macOS, Linux: build qua GitHub Actions, chưa kiểm trên máy thật.
- Android, iOS: chưa hỗ trợ.

## Bắt đầu

Yêu cầu:

- Node.js 22+ và pnpm.
- Rust stable.
- Windows: WebView2 (có sẵn trên Windows 10/11).
- Linux: các gói hệ thống liệt kê trong `.github/workflows/build.yml`.

```bash
pnpm install
pnpm data:fetch     # tải nguồn dữ liệu (ghim theo commit, kiểm sha256)
pnpm data:build     # tạo src/generated/dataset.json và public/strokes/
pnpm tauri dev      # chạy ở chế độ phát triển
```

| Lệnh | Việc |
|---|---|
| `pnpm tauri build` | Tạo bộ cài |
| `pnpm check` | Kiểm kiểu TypeScript/Svelte |
| `pnpm test` | Test logic: lịch hiện từ, thanh điệu, vị trí trợ lý |
| `pnpm perf` | Đo CPU/RAM của app đang chạy (Windows) |

Trên Windows có thể dùng toolchain Rust `x86_64-pc-windows-gnu` (MinGW-w64) thay cho Visual Studio Build Tools. Thư viện Rust chỉ build dạng `rlib`; lý do ghi trong `src-tauri/Cargo.toml`.

## Cấu trúc thư mục

```
src/main/          cửa sổ chính: trang học, luyện tập, tra cứu, cài đặt
src/pet/           cửa sổ trợ lý: bong bóng, vị trí trên màn hình, lịch hiện từ
src/lib/           dùng chung: dữ liệu, pinyin, FSRS, thanh điệu, theme, giọng đọc, sprite
src-tauri/         Rust: cửa sổ trong suốt, cho chuột đi xuyên, khay hệ thống, gọi TTS qua HTTP
data/              dữ liệu biên tập tay: chủ đề, Hán Việt, sửa nghĩa và pinyin
tools/data/        pipeline dữ liệu từ vựng
tools/skins/       dựng nhân vật (Blender + MakeHuman) và đóng gói sprite
tools/logo/        tạo logo và icon
tools/voicepack/   tạo gói giọng cục bộ (sherpa-onnx + Kokoro)
tools/perf/        đo CPU/RAM
docs/PLAN.md       thiết kế, nguồn dữ liệu, quyết định kỹ thuật
```

## Dữ liệu từ vựng

| Bước | Lệnh | Kết quả |
|---|---|---|
| Tải nguồn | `pnpm data:fetch` | `.cache/sources/` |
| Ghép và kiểm từ vựng | `pnpm data:build` | `src/generated/dataset.json`, `public/strokes/`, báo cáo trong `.cache/reports/` |
| Cắt font theo bộ chữ đang dùng | `pnpm data:fonts` | `public/fonts/` (cần Python có `fonttools` và `brotli`) |

**Nguồn dữ liệu:**

| Nguồn | Dùng cho |
|---|---|
| [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | Danh sách từ HSK |
| [CVDICT](https://github.com/ph0ngp/CVDICT) | Nghĩa tiếng Việt |
| [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) | Thứ tự nét |
| `data/` | Chủ đề, câu ví dụ, bảng Hán Việt (biên soạn riêng cho dự án) |

Mọi chỉnh sửa nội dung nằm trong `data/`:

| File | Nội dung |
|---|---|
| `topics/*.json` | Các chủ đề |
| `hanviet/chars.tsv` | Âm Hán Việt theo cặp chữ và pinyin |
| `hanviet/word-verdicts.tsv` | Từ nào được hiện dòng Hán Việt |
| `gloss-overrides.tsv` | Sửa nghĩa |
| `hsk-pinyin-overrides.tsv` | Sửa pinyin |

Dòng "Hán Việt" chỉ hiện với từ Hán Việt có thật trong tiếng Việt và cùng nghĩa (学生 học sinh, 电话 điện thoại). Từ phiên âm (咖啡) và kiểu ghép âm từng chữ (没关系) không hiện. `pnpm data:build` báo lỗi khi một từ thiếu pinyin, thiếu nghĩa hoặc chưa được duyệt Hán Việt.

## Nhân vật trợ lý

Nhân vật được dựng bằng MakeHuman (extension MPFB2 trong Blender), đặt tư thế bằng script, render sẵn thành sprite sheet (`public/skins/assistant/`). Lúc chạy, app chỉ đổi khung ảnh và không có engine 3D. Cách render lại:

1. Cài Blender 4.5 LTS và extension MPFB. Cài các gói tài sản `makehuman_system_assets`, `shirts02`, `skirts02` và `glasses01`.
2. Chạy `pnpm skin:render` (cần lệnh `blender` trong PATH). Một số chế độ khác:
   - `blender -b --python tools/skins/makehuman/build.py -- frames rest think_05`: chỉ render vài khung để xem thử.
   - `-- check`: kiểm tay có chạm đúng điểm đích không, có xuyên vào thân hay quần áo không.
3. Chạy `pnpm skin:pack` (cần Python có `pillow`).

## Giấy phép

| Phần | Giấy phép |
|---|---|
| Mã nguồn | MIT ([LICENSE](LICENSE)) |
| Dữ liệu từ vựng (`data/`, dữ liệu sinh ra) | CC BY-SA 4.0 |
| Dữ liệu nét chữ | Arphic Public License |
| Font | SIL OFL 1.1 |
| Nhân vật | Tài sản MakeHuman CC0; áo (Elvaerwyn) và chân váy (MTKnife) theo CC-BY |

Chi tiết và ghi công: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), và trang **Giới thiệu** trong app.
