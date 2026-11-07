<p align="center"><img src="docs/logo.png" alt="Tiểu Mai" width="200" /></p>

# TieuMai - Chinese Learning (Tiểu Mai 小梅)

Ứng dụng desktop mã nguồn mở giúp người Việt học từ vựng tiếng Trung thông dụng trong đời sống, ăn uống và công việc.

Một trợ lý đứng ở cạnh màn hình và luôn hiện một từ: chữ Hán, pinyin tô màu theo thanh điệu, nghĩa tiếng Việt và âm Hán Việt. Cửa sổ chính có các bài luyện và lịch ôn tập.

<p align="center"><img src="docs/assistant.png" alt="Trợ lý Tiểu Mai" width="640" /></p>

## Tính năng

- **Trợ lý chạy nền:** tự ẩn khi có ứng dụng toàn màn hình, ngủ khi máy không được dùng hoặc trong giờ yên lặng. Kéo được tới bất kỳ đâu trên màn hình.
- **Từ vựng:** HSK 3.0 cấp 1–6 theo bộ từ bản 2025, cùng 22 chủ đề có câu ví dụ. Bộ bản 2021 chọn được trong Cài đặt. Mặc định mở HSK 1–3; HSK 4–6 mở thêm trong app.
- **Luyện tập:** đoán nghĩa, chọn mặt chữ, nghe chọn chữ, viết theo thứ tự nét, ghép câu, luyện thanh điệu (thu âm và so cao độ).
- **Ôn tập** theo lịch FSRS, **sổ tay** từ đã lưu.
- **Tra cứu** theo chữ Hán, pinyin (có hoặc không dấu), nghĩa tiếng Việt hoặc âm Hán Việt.
- **Pinyin khi rê chuột** lên chữ Hán bất kỳ trong app.
- **Giao diện:** 5 theme, mỗi theme có bản sáng và tối; chỉnh được màu và CSS.
- **Giọng đọc (tuỳ chọn):** giọng zh-CN của hệ điều hành, API chuyển văn bản thành giọng nói (kiểu OpenAI, Azure Speech hoặc URL tuỳ chỉnh), hoặc gói giọng MP3 cục bộ.

Số từ mỗi cấp HSK:

| Bộ từ | HSK 1 | HSK 2 | HSK 3 | HSK 4 | HSK 5 | HSK 6 |
|---|---|---|---|---|---|---|
| Bản 2025 | 294 | 197 | 487 | 972 | 1.547 | 1.684 |
| Bản 2021 | 506 | 750 | 953 | 972 | 1.059 | 1.123 |

## Tải về

Bộ cài cho Windows, macOS và Linux được đăng ở trang [Releases](https://github.com/Ndqitisme/ChineseLearningApp/releases).

- Windows 10/11: đã kiểm trên máy thật.
- macOS, Linux: build qua GitHub Actions, chưa kiểm trên máy thật.

## Build từ mã nguồn

Yêu cầu:

- Node.js 22.18+ và pnpm.
- Rust stable.
- Windows: WebView2 (có sẵn trên Windows 10/11). Có thể dùng toolchain `x86_64-pc-windows-gnu` thay cho Visual Studio Build Tools.
- Linux: các gói hệ thống liệt kê trong `.github/workflows/build.yml`.

```bash
pnpm install
pnpm data:fetch     # tải nguồn dữ liệu (ghim theo commit, kiểm sha256)
pnpm data:build     # tạo dữ liệu từ vựng và dữ liệu nét chữ
pnpm tauri dev      # chạy ở chế độ phát triển
pnpm tauri build    # tạo bộ cài
```

Các lệnh khác:

| Lệnh | Việc |
|---|---|
| `pnpm check` | Kiểm kiểu TypeScript/Svelte |
| `pnpm test` | Chạy unit test |
| `pnpm data:fonts` | Cắt font theo bộ chữ đang dùng (cần Python có `fonttools` và `brotli`) |
| `pnpm perf` | Đo CPU/RAM của app đang chạy (Windows) |
| `pnpm skin:rig` | Dựng lại rig nhân vật từ bản vẽ nguồn và chạy bộ kiểm ([docs/CHARACTER.md](docs/CHARACTER.md)) |

Cấu trúc chính: `src/main/` (cửa sổ chính), `src/pet/` (cửa sổ trợ lý), `src/lib/` (dùng chung), `src-tauri/` (Rust), `data/` (dữ liệu biên tập tay), `tools/` (pipeline dữ liệu, dựng nhân vật, gói giọng).

## Dữ liệu và giấy phép

| Nguồn | Dùng cho | Giấy phép |
|---|---|---|
| [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | Danh sách từ HSK 3.0 | MIT |
| [CVDICT](https://github.com/ph0ngp/CVDICT) | Nghĩa tiếng Việt | CC BY-SA 4.0 |
| [hanviet-pinyin-wordlist](https://github.com/ph0ngp/hanviet-pinyin-wordlist) | Âm Hán Việt cho chữ HSK 4–6 | MIT |
| [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) | Thứ tự nét | Arphic Public License |
| `data/` | Chủ đề, câu ví dụ, nghĩa ngắn, bảng Hán Việt HSK 1–3 (biên soạn cho dự án) | CC BY-SA 4.0 |

Nghĩa ngắn, câu ví dụ và âm Hán Việt một phần do AI viết và soát, chưa có người bản ngữ duyệt lại. Dòng "Hán Việt" chỉ hiện với từ Hán Việt có thật và cùng nghĩa (学生 học sinh, 电话 điện thoại); khi chưa chắc thì ẩn.

Nhân vật trợ lý là bản vẽ 2D tạo bằng AI cho dự án.
App ghép các phần của bản vẽ và cho chúng chuyển động bằng WebGL.

## Đóng góp

Sửa nội dung từ vựng trong `data/` (chủ đề, âm Hán Việt, sửa nghĩa, sửa pinyin), rồi chạy `pnpm data:build` để kiểm. Báo lỗi và góp ý qua GitHub Issues hoặc Pull Request.

## Giấy phép

| Phần | Giấy phép |
|---|---|
| Mã nguồn | MIT ([LICENSE](LICENSE)) |
| Dữ liệu từ vựng (`data/`, dữ liệu sinh ra) | CC BY-SA 4.0 |
| Dữ liệu nét chữ | Arphic Public License |
| Font | SIL OFL 1.1 |
| Icon (`public/icons/`, tạo bằng AI cho dự án) | CC0 1.0 |
| Nhân vật (bản vẽ tạo bằng AI cho dự án) | CC0 1.0 |

Chi tiết và ghi công: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) và trang **Giới thiệu** trong app.
