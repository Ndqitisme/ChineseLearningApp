# Tiểu Mai: hướng dẫn cho agent

App desktop học từ vựng tiếng Trung cho người Việt: Tauri 2, Svelte 5, TypeScript. Repo public, mã nguồn MIT.

Chỉ đọc tài liệu của việc đang làm:
- Thiết kế, ràng buộc, ngân sách hiệu năng: `docs/PLAN.md`.
- Tính năng tiếp theo và ca kiểm thử: `docs/ROADMAP.md`.
- Nhân vật trợ lý (yêu cầu, rig, dựng lại, bộ kiểm): `docs/CHARACTER.md`.
- Dựng nhân vật trên máy có hoặc không có GPU: `docs/CHARACTER-PIPELINE.md`.
- Bộ e2e: `tools/e2e/README.md`.
- Mọi thay đổi giao diện (liquid glass, màu, trạng thái): `docs/UI-GLASS.md`.

## Lệnh

```bash
pnpm install
pnpm data:fetch && pnpm data:build   # nguồn ghim sha256 → src/generated, public/strokes
pnpm check                           # svelte-check
pnpm test                            # vitest
pnpm e2e                             # puppeteer + mock Tauri; không chạy hai bộ cùng lúc
pnpm tauri dev
pnpm tauri build
pnpm perf                            # CPU/RAM của app đang chạy (Windows)
```

Dựng lại nhân vật: `pnpm skin:rig` sau khi tạo venv và chạy bộ dựng part; đủ các bước ở `docs/CHARACTER.md` mục 3.

Chạy test của file liên quan trước; cả bộ khi xong một đợt.

## Việc tiếp theo

1. **Đóng đợt glass và Skin.** Đã push lên `main`; `pnpm e2e` đầy đủ đã qua sau các commit Skin. Còn lại: `pnpm perf` 600 giây trên máy yếu, chỉ bảng gợi ý (`--autostart`), skin Trợ lý rồi skin Viền hoa lá, so với số ở `docs/PLAN.md` mục 6. Không mở cửa sổ chính trong lúc đo.
2. **Viền hoa lá:** luống hoa lá render từ mô hình CC0, lay chậm theo gió (`docs/UI-GLASS.md` mục 5, Cửa sổ trợ lý). Dựng lại: `python tools/skins/meadow/fetch.py` rồi `blender -b --factory-startup --python tools/skins/meadow/build.py`. Còn đo CPU khi hoa lá lay, trong lần đo ở mục 1.
3. **CPU và RAM của nhân vật mới trong app thật** vượt ngân sách. Số đo ở `docs/PLAN.md` mục 6, nguyên nhân ở `docs/CHARACTER.md` mục 2. Cần đo lại khi ngồi tại máy, rồi giảm (ví dụ clip nói chạy ít khung hơn) và đo lại trên máy yếu.
4. **Sửa các lỗi nhân vật đang chấp nhận** (`docs/CHARACTER.md` mục 2) bằng Blender và model mở chạy trên máy, không dùng agent hay dịch vụ ngoài. Chạy các bài thử ở `docs/CHARACTER-PIPELINE.md` mục 4 trước khi đổi cách dựng. Bổ sung luật cho các chỗ bộ kiểm còn hở trước khi sửa.
5. **Phát hành:** trang Releases trên GitHub chưa có bộ cài nào; README đang trỏ tới đó. Đẩy tag `v*` thì workflow `build.yml` tạo bản Release nháp; chạy tay workflow thì bản build nằm ở artifact.
6. **Tính năng:** theo thứ tự ở `docs/ROADMAP.md`.

## Luật bắt buộc

### Commit và repo public

- Không thêm dòng ghi công AI, `Co-Authored-By` hay link phiên vào commit và PR. Tiêu đề rõ, thân mô tả thay đổi.
- Không commit `.env*`, khoá, token; build output (`dist`, `src-tauri/target`, `src/generated`, `public/strokes`, `.cache`, `output/`); `references/`.
- Trước khi push: quét file staged tìm secret, đường dẫn cá nhân (`C:/Users/...`) và email; clone sạch vào thư mục tạm rồi chạy install → `data:fetch` → `data:build` → `check` → `test` → `build`.
- Chỉ commit và push khi chủ repo bảo.

### Chữ trong app, README và comment

- Nói màn hình hay nút dùng để làm gì. Không kể cơ chế bên trong, không lặp giá trị chỉnh được trong Cài đặt.
- Trạng thái tách khỏi mô tả.
- Không câu thừa: "miễn phí", "không cần tài khoản", "hoàn toàn", xin góp ý.
- Mỗi dòng một ý; không nối các ý bằng ". " hay " · ".
- Không giọng văn quảng cáo hay "vibe".
- README chỉ chứa thứ người dùng và người đóng góp cần; không quy trình, agent, đợt chạy.
- Comment chỉ ghi lý do không hiển nhiên. Không lịch sử, không giai đoạn dự án.
- UI dùng `<Icon name=… />` (`src/lib/ui/Icon.svelte`), không dùng emoji. Thêm icon: vẽ bằng code trong repo (SVG hoặc script Blender), xuất mask 128 px vào `public/icons/` và thêm tên vào `src/lib/ui/icon-names.ts`; không dùng agent hay dịch vụ ngoài.
- Vùng mà pinyin là đáp án gắn `data-hover-pinyin="off"`.

### Dữ liệu

- `pnpm data:build` phải báo lỗi khi thiếu hay sai, không lặng lẽ bỏ qua.
- Hán Việt chỉ hiện khi là từ Hán Việt có thật và cùng nghĩa; chưa chắc thì ẩn.
- Không dùng nguồn có điều khoản NC hay ND.

### Tiến trình nền

- Việc xong thì không process nào nó tạo còn chạy. Trên Windows tiến trình con sống sau khi cha bị dừng: dừng cả cây bằng `taskkill /T /F /PID <pid>`.
- Mỗi khi một việc nền xong: liệt kê `node|chrome|python` kèm tiến trình cha, giờ tạo, dòng lệnh; dọn cái của mình.
- Không giết Chrome của người dùng, tiến trình nền của công cụ khác, MCP server, hay việc của agent khác.
- Vòng chờ phải thoát cả khi gặp lỗi và có giới hạn thời gian. Git Bash không có `pgrep`.
- Kiểm không có bản nào đang chạy trước khi chạy e2e, bộ đo hay server.
- Việc nặng (`tauri build`, `cargo`, `pnpm e2e` đầy đủ, `skin:rig`, `pnpm perf`) chỉ chạy khi các việc khác đã xong, mỗi lần một việc. Agent chạy song song chỉ được kiểm nhẹ (`pnpm check`, vitest từng file) và báo lại phần còn cần build hay e2e.

### Nhân vật

- Yêu cầu trong `docs/CHARACTER.md` là bắt buộc: tư thế nghỉ, tay chân liền, kính theo đầu, đứng yên giữ một khung.
- `references/` là file riêng, không có trong repo. Ảnh dáng người là ảnh người thật: không đưa vào web hay bất kỳ model nào, kể cả model chạy trên máy.
- Không nới bộ kiểm để qua.
- CPU/RAM của app đo trên máy yếu, không đo trên máy GPU.
- Bản vẽ nhân vật và icon: CC0 1.0.
- Hình trang trí của Skin (cỏ, hoa, lá) render bằng Blender từ mô hình CC0 có sẵn (Poly Haven), tải bằng script ghim sha256 (`tools/skins/meadow/assets.lock.json`) và ghi nguồn trong `tools/skins/meadow/CREDITS.md`. Không dùng nguồn giới hạn phân phối lại hay bắt ghi nguồn (pngtree, Freepik, ảnh stock).

## Cách làm

- Viết lại mục tiêu bằng lời của mình trước khi làm.
- Chốt kiểu dữ liệu trước khi viết UI.
- Mỗi kết quả sinh ra bằng một lệnh chạy lại được, không có bước tay.
- Mỗi bước kết thúc bằng một kiểm tra thật đã chạy. Với hình: render rồi tự xem ảnh ở đúng kích thước app.
- Mỗi con số ghi cách đo, số lần chạy và nó có thể đang đo nhầm cái gì.
- Ghi nhãn mọi khẳng định: đã đo, suy luận, hay đoán.
- Hai lần sửa trên cùng một giả định thất bại thì kiểm lại giả định trước lần thứ ba.

## Ghi chú Windows

- Python in tiếng Việt ra console cần `PYTHONIOENCODING=utf-8`.
- Blender chạy nền trên GPU Intel đời cũ: Workbench render sai góc nhìn, Eevee không chạy; dùng Cycles với đường dẫn Windows tuyệt đối.
- Toolchain Rust `x86_64-pc-windows-gnu` dùng được thay Visual Studio Build Tools; lib chỉ build `rlib`.
