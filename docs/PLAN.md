# Tiểu Mai (小梅) — app học tiếng Trung chạy ngầm cùng cô trợ lý pixel

> Bản plan thiết kế + lộ trình. Cập nhật: 2026-11-04.
> Trạng thái từng mốc ghi ở mục 7; quyết định ghi ở mục 11.

## 0. Mục tiêu

**Viết lại theo cách hiểu của tôi:** người Việt học từ vựng tiếng Trung cơ bản (đời sống, ăn uống, công việc) mà không cần "ngồi vào học". Một cô trợ lý 3D sống ở cạnh màn hình. Bong bóng bên cạnh cô luôn hiện một từ, khoảng 18 giây đổi một lần, gồm chữ Hán, pinyin, nghĩa tiếng Việt và âm Hán Việt, để mắt quen dần với mặt chữ và nghĩa. Khi muốn học chủ động thì mở app chính để đoán nghĩa, viết theo nét, luyện thanh điệu và ôn tập theo lịch lặp lại ngắt quãng. Ở chỗ nào chưa hiện pinyin, rê chuột lên chữ Hán sẽ thấy pinyin.

**Tiêu chí xong v1**

| # | Tiêu chí | Cách kiểm |
|---|---|---|
| 1 | Trợ lý chạy nền cả ngày trên máy yếu (i5-4570, Intel HD 4600) mà không thấy nặng. CPU trung bình dưới 1% một nhân, RAM của cả cây tiến trình dưới 150 MB khi chỉ có trợ lý. | Script `tools/perf/measure.ps1`, đo 10 phút |
| 2 | Khoảng 2.200 từ HSK 3.0 cấp 1–3 và khoảng 650 từ theo 22 chủ đề. Mỗi từ có chữ, pinyin, nghĩa Việt ngắn, và âm Hán Việt khi đó là từ Hán Việt có thật; từ theo chủ đề có thêm câu ví dụ. | `pnpm data:build` kiểm và báo lỗi, không lặng lẽ bỏ qua |
| 3 | Chạy được khi không có mạng và không cài giọng. Có giọng (hệ thống, API hoặc gói giọng) thì phát âm. | Chạy thật trên máy này |
| 4 | Một mã nguồn chạy Windows, macOS, Linux; mobile làm sau trên cùng lõi. | Build Windows tại máy; macOS/Linux qua CI |

**Ngoài phạm vi v1:** chữ phồn thể, ngữ pháp, nhận dạng giọng nói để chấm phát âm (có hướng làm ở mục 9), đồng bộ đám mây, tài khoản.

## 1. pStack áp dụng thế nào

pStack là bộ kỹ năng "làm ít mà chắc" của Lauren Tan (poteto), gốc là plugin cho Cursor ([cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack), MIT). Các bản port cho Claude Code do bên thứ ba làm và tôi chưa kiểm, nên tôi **áp dụng nguyên tắc chứ không cài plugin**.

| Nguyên tắc pStack | Áp vào dự án này |
|---|---|
| in-your-own-words | Mục 0: viết lại mục tiêu và tiêu chí xong trước khi làm. |
| foundational-thinking / model the domain | Chốt kiểu dữ liệu `Word`, `Topic`, `CardState`, `Settings` (mục 3.3) trước khi viết UI. Mọi màn hình chỉ đọc từ các kiểu này. |
| experience-first | Thiết kế hành vi trợ lý (mục 4.1) trước, rồi mới tới kỹ thuật cửa sổ. |
| laziness-protocol / subtract before add | Dùng `tauri-plugin-store` thay SQLite. Không đóng gói giọng đọc. Không dùng Live2D/Spine. Không có backend. |
| build-the-lever | Pipeline dữ liệu có bước kiểm (fail khi thiếu pinyin/Hán Việt/nghĩa). Script render sprite ra PNG để duyệt hình. Script đo RAM/CPU. |
| sequence-verifiable-units | Lộ trình chia mốc M1–M8, mỗi mốc kết thúc ở trạng thái chạy thật và kiểm được (mục 7). |
| prove-it-works | Mỗi mốc chạy app thật, chụp màn hình, đo số liệu; không dừng ở mức "build qua". |
| explain-the-number / benchmark-checklist | Số RAM/CPU luôn so với baseline một app Tauri rỗng, ghi rõ cách đo (mục 6). |
| encode-lessons-in-structure | Luật dữ liệu nằm trong code kiểm (`tools/data/validate`), không nằm trong lời dặn. Kiểu TypeScript strict. |
| fix-root-causes / attack-the-premise | Ví dụ: Unihan cho 你 → "nể" (âm Nôm). Sửa tận gốc bằng bảng Hán Việt theo (chữ, pinyin), không vá từng từ. |

**Chỗ khác với pStack gốc:** luật trong `CLAUDE.md` của bạn được ưu tiên. Cụ thể: hỏi gọn một lượt trước khi code thay vì "never block on the human"; không chạy nhiều agent song song cho việc code (arena/swarm); subagent chỉ dùng cho research và biên tập nội dung độc lập.

## 2. Kết quả research

### 2.1 Nguồn dữ liệu (đã mở repo và đọc LICENSE)

| Nguồn | Dùng cho | Giấy phép | Ghi chú |
|---|---|---|---|
| [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | Danh sách HSK 3.0 cấp 1–3 (506 + 750 + 953 = 2.209 từ), pinyin, từ loại, tần suất | MIT; phần nghĩa tiếng Anh lấy từ CC-CEDICT nên theo CC BY-SA | Xương sống danh sách từ |
| [CVDICT](https://github.com/ph0ngp/CVDICT) | Nghĩa tiếng Việt (122.591 mục) | CC BY-SA 4.0 | Có 2.201/2.209 từ HSK 1–3. Phải khớp theo pinyin (满 có mục "dân tộc Mãn Châu"), bỏ thẻ lượng từ `LT:` |
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | Đối chiếu pinyin | CC BY-SA 4.0 | Chỉ dùng file export, không cào web MDBG |
| [Unihan](https://www.unicode.org/charts/unihan.html) `kVietnamese` | Gợi ý Hán Việt | Unicode License v3 | **Yếu**: thiếu 123/899 chữ HSK 1–3, nhiều âm Nôm (你 "nể", 吧 "và"). Chỉ dùng làm gợi ý; bảng chính do biên tập |
| [hanzi-writer](https://github.com/chanind/hanzi-writer) 3.7.3 | Hoạt hình nét và quiz viết | MIT | `quiz()` có `onMistake`, `onCorrectStroke`, `onComplete` |
| [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) | Dữ liệu nét (khoảng 2,4 KB/chữ) | Arphic Public License | Chỉ đóng gói các chữ cần, kèm `ARPHICPL.TXT` |
| [pinyin-pro](https://github.com/zh-lx/pinyin-pro) 3.29 | Pinyin theo ngữ cảnh cho câu, dùng khi hover | MIT | 145 KB gzip, chỉ nạp ở cửa sổ chính |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | Lịch ôn tập FSRS | MIT | Bản 6 đổi API và khai báo Node ≥ 24; phải kiểm chạy trong webview, nếu không thì ghim bản 5 |
| [LXGW WenKai Lite](https://github.com/lxgw/LxgwWenKai-Lite) | Font chữ Hán kiểu Khải (gần nét viết tay, hợp cho người học) | OFL 1.1 | Cắt còn các chữ dùng tới (khoảng 1 MB) và **đổi tên font** vì tên "LXGW" là tên dành riêng |
| Nunito (Google Fonts) | Font giao diện tiếng Việt, bo tròn dễ thương | OFL 1.1 | Thiếu ǐ ǒ ǖ ǘ ǚ ǜ nên pinyin hiển thị bằng font chữ Hán (có đủ dấu) |
| [Tatoeba](https://tatoeba.org) | Câu ví dụ bổ sung | CC BY 2.0 FR | Chỉ có 667 câu Trung–Việt và không theo chủ đề, nên câu ví dụ chủ yếu do mình biên soạn |

**Nội dung tự biên soạn** (22 chủ đề × 24–32 từ, câu ví dụ, bảng Hán Việt 1.114 cặp chữ–âm) phát hành theo CC BY-SA 4.0 cùng phần dữ liệu. Pinyin câu ví dụ được **đối chiếu tự động** với pinyin-pro, chỗ lệch được báo để duyệt.

**Trang uy tín chỉ dùng để tham khảo cấu trúc, không sao chép:** chuẩn HSK 3.0 (GF0025-2021, chinesetest.cn), Chinese Grammar Wiki (CC BY-NC-SA, cấm thương mại), HelloChinese (điều khoản cấm sao chép), Hanzii.net, MDBG. Bộ 22 chủ đề (`data/topics/_index.json`) là cấu trúc riêng, rút từ cách các giáo trình nhóm từ đời sống / ăn uống / công việc.

### 2.2 Nền tảng: chọn Tauri 2 + Svelte 5

| Ứng viên | Ưu | Nhược với app này |
|---|---|---|
| **Tauri 2.12** (Rust + WebView hệ thống) | Đã hỗ trợ Android/iOS. Cửa sổ trong suốt, luôn nổi, ẩn khỏi taskbar, tray, autostart, single-instance đều có sẵn. Giao diện bằng CSS nên tuỳ biến theme gần như vô hạn. Dùng thẳng Hanzi Writer. Bundle nhỏ. | RAM phụ thuộc WebView2 (con số thật phải tự đo). Wayland không cho luôn nổi và không đọc được vị trí chuột. |
| Flutter | Một mã nguồn cho mobile, render GPU riêng | Đa cửa sổ desktop vẫn chưa ổn định trên kênh stable (cuối 2026). Thư viện nét chữ kém trưởng thành hơn. |
| Electron | Hệ sinh thái lớn | Mỗi app kèm một Chromium, RAM cao. |
| Rust native (Slint/egui/GPUI) | RAM thấp nhất | Làm theme "dễ thương" tốn công. Mobile chưa chín. Phải tự viết phần nét chữ. |

Chọn **Tauri 2.12 + Svelte 5 + TypeScript + Vite 8**. Svelte biên dịch ra JS gọn, không có virtual DOM, tốn ít CPU. WebView2 vẽ bằng GPU qua compositor. Hoạt hình chỉ đổi `transform`/`opacity` nên compositor xử lý, không phải vẽ lại.

**Lối thoát nếu RAM vượt ngân sách:** viết lại riêng cửa sổ trợ lý bằng Rust native (BongoCat đã đi đường này). Lõi dữ liệu và app chính giữ nguyên.

### 2.3 Giọng đọc: không đóng gói, cắm thêm khi cần

Đây là quyết định của bạn: app không mang sẵn âm thanh, ai cần thì tự cài giọng. Kiến trúc có 3 loại "nhà cung cấp giọng", mỗi loại gán vào 2 vai: **Nam trầm ấm** và **Nữ dễ thương**.

| Nhà cung cấp | Hoạt động | Ghi chú |
|---|---|---|
| `system` | `speechSynthesis` của WebView, dùng giọng zh-CN đã cài trong hệ điều hành | Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói, thêm Huihui (nữ) / Kangkang (nam). Máy này hiện **chưa có** giọng Trung nào. |
| `http` | Gọi API qua Rust (tránh CORS) và cache file trên đĩa | Mẫu sẵn: **OpenAI-compatible** `/v1/audio/speech` (chạy được với server local như Kokoro-FastAPI, hoặc dịch vụ đám mây), **Azure Speech** (key + region), và mẫu URL tuỳ chỉnh. |
| `pack` | Thư mục gói giọng: `manifest.json` + file MP3 theo từ | Có tool `tools/voicepack` sinh gói bằng **sherpa-onnx + Kokoro-82M** (Apache-2.0, chạy CPU). Giọng gợi ý: nam `zm_yunyang`/`zm_yunjian`, nữ `zf_xiaoyi`/`zf_xiaoni`. Chất lượng tiếng Trung của Kokoro chỉ xếp hạng D nên phải nghe duyệt. |

Không dùng edge-tts (endpoint không chính thức, rủi ro điều khoản khi phát hành). Không dùng F5-TTS (trọng số CC-BY-NC) hay Fish-Speech (giới hạn doanh thu).

Định dạng gói giọng là **MP3 mono 24 kHz 48 kbps**, phát được trên WebView2, WKWebView và WebKitGTK. Không chọn Opus vì Safari/WKWebView hỗ trợ Opus chập chờn.

### 2.4 Nhân vật: model 3D người thật, render sẵn thành sprite

Nhân vật đã qua bốn vòng thử. Vòng 1 là pixel chibi tự vẽ: bạn thấy chưa đẹp. Vòng 2 là các bộ chibi/pixel có giấy phép mở (Cute Girl CC0, LPC): bạn thấy không đủ quyến rũ. Vòng 3 là model Microsoft Rocketbox (MIT) ghép và đổi màu trang phục: không giống ảnh tham chiếu, động tác lấy từ thư viện thì nhanh và vội. Bản chốt là **nhân vật dựng bằng MakeHuman**.

- **Nguồn:** MakeHuman qua extension [MPFB2](https://static.makehumancommunity.org/mpfb.html) trong Blender 4.5 LTS. Thân, da `young_asian_female`, tóc `ponytail01`, giày `shoes04`, mắt, răng, biểu cảm là tài sản hệ thống **CC0**. Kính tròn `toigo_round_glasses_leopard` (CC0). Áo `elvs_male_shirt_untucked_bd1` (Elvaerwyn) và chân váy `mtknife_pleated_mini_skirt` (MTKnife) theo **CC-BY**, phải ghi công (đã ghi ở trang Giới thiệu, `THIRD_PARTY_NOTICES.md` và `CREDITS.txt`).
- **Phong cách theo ảnh tham chiếu** (chỉ lấy phong cách, không lấy gương mặt): cô gái châu Á da sáng, tóc nâu đuôi ngựa, kính tròn gọng kim loại mảnh, sơ mi jean tay ngắn, chân váy xếp ly ngắn màu xám than, giày da đen. Script `tools/skins/makehuman/build.py` cắt tay áo, tô màu jean có vân chéo, đổi váy sang xám, tách tròng kính thành kính trong, bỏ phần tất trắng của giày, làm mềm phần ngực áo.
- **Dáng người** (chỉnh bằng target MakeHuman, không mô phỏng người thật): dáng người mẫu mảnh, chân dài. Số đo quy về cao 1,68 m: ngực–eo–hông 87–58–86 cm (trước 94–68–101).
- **Hoạt hình đặt tay bằng code.** Dáng nghỉ: trọng tâm dồn một chân, tay trái chống hông, tay phải buông. Tay phải luôn nằm phía mép màn hình (ảnh được lật để cô quay vào giữa), nên mọi động tác vươn tay dùng tay trái. Nhờ vậy khung hình phía mép chỉ dư 1 px và nhân vật đứng sát mép được. `build.py -- check` đo cả độ xuyên tay vào thân/áo/váy (tối đa 3,9 mm) và phần nhô ra phía mép. Các động tác: thở, chớp mắt, nhìn quanh, vén tóc, chống cằm suy nghĩ, nói kèm cử chỉ, vẫy tay, chắp tay cười, ngạc nhiên (khi bị kéo), ngủ gật. Tay được đặt bằng IK hai đốt giải tích, mắt nhắm bằng xương mí trên, miệng cười/mở bằng target biểu cảm. Mỗi khung có thời lượng riêng (ms) theo tốc độ thật: tay đưa lên mặt mất khoảng 0,8 giây, giữ 2,6 giây rồi hạ xuống; không còn kiểu chiếu nhanh như trước.
- **Không render 3D lúc chạy.** Script render 39 khung bằng Cycles CPU (Eevee lỗi trên driver Intel HD 4600), `tools/skins/pack.py` ghép thành `sheet.webp` và `skin.json`. App chỉ đổi khung ảnh nên CPU gần như bằng 0.
- **Những gì không dùng được:**
  - Live2D: runtime Cubism là phần mềm độc quyền, các model mẫu cấm phát hành lại.
  - Mixamo: không được phát hành lại file gốc.
  - Hình nhân vật trong VPet, BongoCat, Shimeji: không có giấy phép.
  - Repo "public" trên GitHub mà không ghi giấy phép thì mặc định là giữ mọi quyền.

## 3. Kiến trúc

### 3.1 Tiến trình và cửa sổ

```
┌──────────────────────── Lõi Rust (Tauri 2) ────────────────────────┐
│ tray menu · single-instance · autostart (--autostart = chỉ trợ lý) │
│ pet: poller click-xuyên ~15 Hz, giữ luôn-nổi mỗi 2 s, snap mép      │
│ pause: toàn màn hình/trình chiếu (SHQueryUserNotificationState),    │
│        rảnh tay > N phút (GetLastInputInfo) → phát event            │
│ speech: proxy HTTP + cache đĩa, đọc file gói giọng                  │
│ store plugin: settings.json, progress.json (dùng chung 2 cửa sổ)    │
└───────────────┬───────────────────────────────┬────────────────────┘
      cửa sổ "pet" (luôn tồn tại)        cửa sổ "main" (tạo khi mở,
      trong suốt, không viền, luôn nổi    HUỶ khi đóng để trả RAM)
      Sprite · Bubble · Scheduler         Trang chủ · Chủ đề · Từ · Luyện tập
                                          · Tra cứu · Cài đặt · Giấy phép
              └──────── src/lib dùng chung: data · srs · speech · theme · pinyin ────────┘
```

- Đóng hết cửa sổ thì app không thoát (`prevent_exit`); chỉ thoát khi chọn "Thoát" ở tray.
- Hai cửa sổ dùng chung store. Khi một bên ghi, bên kia nhận sự kiện `onKeyChange` và cập nhật.

### 3.2 Cấu trúc thư mục

```
data/            nguồn tự biên soạn (commit): topics/*.json, hanviet/*.tsv, gloss-overrides.tsv
tools/data/      fetch-sources (tải nguồn có ghim URL) · build (ghép + kiểm) · subset-font
tools/sprite/    render sprite ra PNG để duyệt
tools/perf/      đo RAM/CPU
tools/voicepack/ sinh gói giọng bằng sherpa-onnx
src/lib/         lõi dùng chung (thuần TS, không phụ thuộc Tauri, để mobile dùng lại)
src/pet/         cửa sổ trợ lý
src/main/        cửa sổ app chính
src/generated/   words.json, topics.json (sinh ra, commit để build không cần mạng)
public/strokes/  dữ liệu nét từng chữ (sinh ra)
src-tauri/       lõi Rust
```

### 3.3 Mô hình dữ liệu (chốt trước khi viết UI)

```ts
type Tone = 1 | 2 | 3 | 4 | 5;               // 5 = thanh nhẹ
interface Word {
  id: string;            // "吃" hoặc "行|hang2" khi một chữ có nhiều cách đọc
  hanzi: string;         // giản thể
  pinyin: string;        // "mǐfàn" (dấu thanh)
  syllables: { py: string; tone: Tone }[];   // để tô màu thanh điệu và quiz thanh
  vi: string;            // nghĩa ngắn ≤ 30 ký tự (hiện trong bong bóng)
  viFull?: string;       // nghĩa đầy đủ từ CVDICT
  hanviet?: string;      // "học sinh"; chỉ có khi là từ Hán Việt thật (data/hanviet/word-verdicts.tsv)
  hsk?: 1 | 2 | 3;
  topics: string[];
  freq?: number;
  ex?: { zh: string; py: string; vi: string };
}
interface CardState {    // tiến độ theo từ (progress.json)
  seen: number; lastSeen: number;            // lộ diện thụ động (trợ lý)
  known?: boolean;                            // người dùng bấm "biết rồi"
  fsrs?: FsrsCard;                            // học chủ động
}
```

Lưu trữ dùng `tauri-plugin-store` (JSON). Vài nghìn thẻ chỉ vài trăm KB nên không cần SQLite. Nếu sau này cần lịch sử ôn tập chi tiết thì mới chuyển.

## 4. Trải nghiệm

### 4.1 Cô trợ lý Tiểu Mai

- **Vị trí:** mặc định ngồi trên taskbar ở góc phải. Kéo đi đâu cũng được (chỉ bắt đầu kéo khi chuột đã di quá 4 px, để click vẫn là click). Thả gần mép (dưới 48 px) thì tự hít vào mép theo vùng làm việc của màn hình, không đè taskbar. Nhớ vị trí theo từng màn hình. Bong bóng tự đổi bên theo nửa màn hình đang đứng.
- **Click xuyên:** phần trong suốt của cửa sổ không chặn chuột. Rust hỏi vị trí chuột khoảng 15 lần/giây và chỉ bật nhận chuột khi con trỏ nằm trên nhân vật hoặc bong bóng. Trên Wayland không có API này nên cửa sổ luôn nhận chuột (cửa sổ nhỏ nên ít vướng).
- **Nhịp:** bong bóng luôn mở. Mỗi từ ở lại `wordSec` giây (mặc định 18, chỉnh được 8–60), rồi nội dung mờ đi và từ mới hiện lên trong khoảng 1,5 giây; khung bong bóng không tắt đi bật lại vì như vậy gây nhức mắt. Bong bóng gồm chữ Hán cỡ lớn, pinyin tô màu theo thanh, nghĩa Việt, Hán Việt, và tuỳ chọn câu ví dụ.
- **Chế độ "đoán trước":** với từ đã gặp nhiều lần, bong bóng hiện chữ trước, khoảng 2,5 giây sau mới hiện nghĩa. Người dùng tự nhớ lại trước khi thấy đáp án.
- **Tương tác trên bong bóng:** 🔊 đọc (nếu có giọng), ✓ "Biết rồi" (giảm tần suất), ★ lưu sổ tay, bấm chữ để mở trang từ trong app chính. Rê chuột lên bong bóng thì từ đang hiện được giữ lại, chưa chuyển. Bấm vào nhân vật để sang từ tiếp theo ngay.
- **Trạng thái hoạt hình:** đứng yên (khung tĩnh, thỉnh thoảng chớp mắt hoặc thở), nói (khi hiện bong bóng), vẫy tay (khi rê chuột tới), vui (khi bấm "biết rồi"), bị kéo (đung đưa), ngủ (khi tạm dừng, có "zzz").
- **Tự tạm dừng:** khi có app toàn màn hình hoặc trình chiếu, khi người dùng không chạm máy quá 3 phút, trong giờ yên lặng, hoặc khi bấm tạm dừng 30 phút từ tray hay menu chuột phải. Khi tạm dừng, cô trợ lý ngủ và không tốn khung hình nào.
- **Menu chuột phải trên nhân vật:** từ tiếp theo, tạm dừng, đổi trang phục, mở app, ẩn trợ lý.

### 4.2 App chính

| Màn hình | Nội dung |
|---|---|
| Trang chủ | Chào theo giờ, số từ đã gặp hôm nay, chuỗi ngày học, số thẻ đến hạn ôn, nút "Ôn ngay". |
| Chủ đề | 22 thẻ chủ đề theo 3 nhóm (Đời sống / Ăn uống / Công việc) và HSK 1/2/3, có thanh tiến độ. Bật/tắt chủ đề nào được đưa vào trợ lý. |
| Chi tiết từ | Chữ lớn với hoạt hình thứ tự nét, pinyin, Hán Việt, nghĩa đầy đủ, ví dụ, phát âm 2 giọng, thêm vào sổ tay. |
| Luyện tập | (1) **Đoán nghĩa**: chữ → 4 nghĩa, và chiều ngược nghĩa → 4 chữ. (2) **Ôn tập** dạng flashcard FSRS. (3) **Viết theo nét** bằng quiz Hanzi Writer (gợi ý sau 3 lần sai). (4) **Thanh điệu**: chọn thanh cho từng âm tiết; ghi âm giọng mình rồi so đường cao độ (thuật toán McLeod qua `pitchy`, MIT) với đường mẫu của thanh, **không cần file giọng mẫu**. |
| Tra cứu | Tìm theo chữ Hán, pinyin (gõ có hoặc không dấu, ví dụ "mifan"), nghĩa Việt hoặc Hán Việt. |
| Cài đặt | Theme và sáng/tối, trang phục, kích thước nhân vật, nhịp, chế độ đoán trước, điều kiện tạm dừng, giờ yên lặng, giọng đọc (nhà cung cấp, gán 2 vai, nút nghe thử), khởi động cùng máy, xuất/nhập tiến độ. |
| Giấy phép | Ghi nguồn đầy đủ cho mọi bộ dữ liệu và font. |

### 4.3 Hover pinyin ở mọi nơi

Một bộ lắng nghe `pointermove` gắn ở `document`, giới hạn theo `requestAnimationFrame`. Hàm `caretPositionFromPoint` cho biết ký tự dưới con trỏ. Nếu đó là chữ Hán và vùng chứa không có cờ `data-has-pinyin`, tooltip hiện pinyin. Pinyin lấy theo từ trong từ điển trước, nếu không có thì dùng pinyin-pro theo ngữ cảnh câu. Nếu chữ thuộc một từ trong từ điển, tooltip hiện thêm Hán Việt và nghĩa. Vùng quiz mà pinyin chính là đáp án gắn `data-hover-pinyin="off"`.

### 4.4 Theme và trang phục

- Theme là một bộ **design token** dạng biến CSS: màu nền, bề mặt, chữ, màu chính, màu nhấn, viền, bóng, bo góc, font, màu 4 thanh điệu, kiểu bong bóng, hoa văn nền.
- Có 5 theme sẵn, mỗi theme có bản sáng và tối: 🌸 Hoa anh đào, 🍵 Matcha, 🧋 Trà sữa, 🌊 Biển, 🌙 Đêm sao.
- Chế độ sáng/tối có 3 lựa chọn: theo hệ thống, sáng, tối.
- **Tuỳ biến nâng cao:** sửa từng token bằng bộ chọn màu, hoặc dán CSS riêng. Muốn đổi bất kỳ thành phần nào cũng được.

## 5. Thuật toán học

### 5.1 Lộ diện thụ động (trợ lý)

- Nhóm từ đưa vào trợ lý gồm các chủ đề và cấp HSK đang bật, xếp theo thứ tự chủ đề rồi tần suất.
- Luôn giữ một **nhóm mới** khoảng 6 từ. Mỗi từ mới được chiếu khoảng 5 lần với khoảng cách giãn dần (sau 1, 3, 7, 15 lượt). Đủ số lần thì từ chuyển sang "đã quen" và một từ mới được kéo vào nhóm.
- Mỗi lượt chọn theo trọng số: khoảng 60% từ nhóm mới, khoảng 25% từ đã quen lâu chưa gặp, khoảng 15% thẻ FSRS đến hạn. Bỏ qua từ đã bấm "biết rồi", nhưng thỉnh thoảng vẫn nhắc lại với tỉ lệ thấp.
- Không lặp lại một từ trong 5 lượt liên tiếp.
- Logic này là hàm thuần, có test riêng.

### 5.2 Học chủ động (FSRS)

- Mỗi từ có một thẻ FSRS cho kỹ năng nhận mặt chữ và nghĩa.
- Đoán nghĩa: đúng và nhanh → Good, đúng nhưng chậm → Hard, sai → Again. Flashcard cho người dùng tự chấm 4 mức.
- Viết theo nét chỉ lưu thống kê số lần sai theo chữ. Kỹ năng viết chưa có lịch FSRS riêng trong v1.

## 6. Hiệu năng: ngân sách và cách đo

| Trạng thái | Ngân sách |
|---|---|
| Chỉ trợ lý, đang đứng yên | CPU trung bình dưới 0,5%; RAM (private working set, cộng cả cây `app.exe` + `msedgewebview2.exe`) dưới 150 MB |
| Bong bóng xuất hiện | CPU tăng vọt dưới 5% trong dưới 300 ms |
| App chính đang mở | RAM dưới 300 MB |
| Sau khi đóng app chính | RAM về lại mức đứng yên cộng tối đa 15 MB |

**Các cách giữ máy nhẹ**

- Lúc đứng yên, nhân vật là một khung tĩnh và trang không vẽ khung hình nào. Hoạt hình chạy bằng `setTimeout` khoảng 8 fps và chỉ trong lúc diễn. Chỉ đổi `transform: translateX` trên dải sprite nên compositor xử lý.
- Cửa sổ trợ lý chỉ nạp phần dữ liệu cần dùng, không nạp pinyin-pro hay Hanzi Writer.
- Cửa sổ chính bị huỷ khi đóng.
- Có thể đặt `MemoryUsageTargetLevel=Low` cho WebView2 qua `with_webview`, nhưng chỉ làm khi số đo cho thấy có lợi.

**Số đo (bản release, chỉ trợ lý, 120 giây, máy i5-4570):**

| Lần đo | CPU trung bình / p95 / cao nhất | RAM private trung bình / cao nhất |
|---|---|---|
| Sheet Rocketbox (72 khung 198×400) | 0,27% / 1,76% / 3,12% | 165 MB / 206 MB (vượt ngân sách) |
| Sheet MakeHuman (39 khung 186×340, 345 KB) | 0,11% / 1,01% / 2,65% | 124 MB / 128,5 MB |

Lần đo thứ hai chạy lúc màn hình đang khoá. WebView2 có thể giảm vẽ khi cửa sổ bị che, nên cần đo lại khi màn hình mở. Chưa đo baseline Tauri rỗng.

**Cách đo:** `tools/perf/measure.ps1 -Seconds 600` lấy mẫu mỗi giây cây tiến trình của app (gồm các `msedgewebview2.exe` con), xuất CSV và in trung bình/p95. Mọi con số so với baseline là một app Tauri rỗng chạy trên cùng máy.

## 7. Lộ trình: các mốc kiểm chứng được

| Mốc | Nội dung | Điều kiện qua mốc | Trạng thái |
|---|---|---|---|
| M0 | Research, plan, chốt mô hình dữ liệu | Plan này | ✅ |
| M1 | Khung app: Tauri 2 + Svelte 5 nhiều trang, tray, cửa sổ trợ lý trong suốt luôn nổi, kéo + hít mép, click xuyên, single-instance, không thoát khi đóng cửa sổ, tạo/huỷ cửa sổ chính | Chạy `pnpm tauri dev`, kéo thả, click xuyên chạy thật; có số đo baseline | ✅ chạy thật trên máy này |
| M2 | Pipeline dữ liệu: tải nguồn, ghép HSK 1–3 + chủ đề + Hán Việt + nghĩa rút gọn + nét chữ, bước kiểm, cắt font | `pnpm data:build` sạch, báo cáo số liệu, 0 lỗi kiểm | ✅ 2.486 từ, 0 lỗi |
| M3 | Trợ lý: sprite 3D render sẵn, máy trạng thái hoạt hình, bong bóng, bộ lịch lộ diện, phát hiện tạm dừng | Chạy 10 phút trong ngân sách mục 6; ảnh chụp | 🟡 chạy thật; chưa đo bản release |
| M4 | App chính: hệ theme (5 × sáng/tối + CSS riêng), trang chủ, chủ đề, chi tiết từ, tra cứu, cài đặt, hover pinyin | Duyệt đủ màn hình trong app thật, type-check sạch | 🟡 type-check và build sạch; chưa duyệt từng màn hình |
| M5 | Luyện tập: đoán nghĩa, flashcard FSRS, viết theo nét, thanh điệu (chọn thanh + đường cao độ) | Test logic qua; chạy thật từng chế độ | 🟡 test logic qua (11/11); chưa chạy tay từng chế độ |
| M6 | Giọng đọc: provider system / http / pack (chưa có tool sinh gói giọng) | Phát được ít nhất 1 provider thật trên máy này | 🟡 code xong; máy này chưa có giọng zh-CN nên chưa phát thử |
| M7 | Đóng gói: bộ cài Windows (NSIS), workflow CI cho macOS/Linux, trang giấy phép | Cài từ bộ cài, autostart chạy | ⏳ |
| M8 | Mobile (sau): Android dùng overlay qua plugin Kotlin; iOS dùng widget + thông báo | — | Sau |

**Test tự động chỉ viết cho logic nhiều nhánh:** bộ lịch lộ diện, ánh xạ điểm FSRS, chuyển pinyin dấu ↔ số, ghép Hán Việt theo (chữ, pinyin) và ngoại lệ, rút gọn nghĩa CVDICT, chấm đường thanh điệu. Không viết test cho UI.

## 8. Mobile sau này

- **Android:** plugin Kotlin chạy foreground service, vẽ view nổi `TYPE_APPLICATION_OVERLAY` (cần quyền `SYSTEM_ALERT_WINDOW`; phải kiểm chính sách Google Play về quyền này). Sprite vẽ native từ cùng ma trận pixel, xuất ra PNG lúc build.
- **iOS:** không cho phép cửa sổ nổi. Thay bằng widget WidgetKit "từ của giờ này" cùng thông báo cục bộ.
- **App chính:** dùng lại nguyên `src/lib` và `src/main`. Phần thao tác chuột (hover, kéo) có thay thế cho cảm ứng: chạm giữ thay cho hover.

## 9. Rủi ro và điều chưa xác nhận

| Vấn đề | Tình trạng / hướng xử lý |
|---|---|
| RAM thật của WebView2 với 2 cửa sổ | **Chưa đo.** Đo ở M1. Nếu vượt ngân sách: đặt `MemoryUsageTargetLevel` thấp, rồi tới viết pet native. |
| Huỷ cửa sổ có trả RAM của renderer không | **Chưa xác nhận.** Đo ở M1. |
| Wayland: không luôn nổi, không đọc vị trí chuột, không tự đặt vị trí | Giới hạn của nền tảng. Gợi ý chạy với `GDK_BACKEND=x11` (chưa kiểm). |
| macOS: Tauri 2.12 luôn bật private API | Chưa rõ ảnh hưởng tới Mac App Store. Phát hành ngoài Store trước. |
| Phát hiện toàn màn hình / không làm phiền trên macOS, Linux | v1 chỉ có trên Windows. Hai hệ kia chỉ dựa vào thời gian rảnh tay. |
| Chất lượng Hán Việt và nghĩa rút gọn | Biên tập bởi AI, cần người bản ngữ duyệt. Có file `gloss-overrides.tsv` để sửa mà không đụng code. Hán Việt đã qua hai vòng duyệt từng từ (2026-11-04): vòng 1 bằng 10 agent Haiku, vòng 2 kiểm chéo bằng Sonnet. Chỉ hiện khi cả hai vòng đồng ý: 1.243/2.486 từ. Quy tắc là chưa chắc thì ẩn, nên còn sót một số từ Hán Việt hiếm nhưng có thật; muốn hiện thì sửa `word-verdicts.tsv`. |
| Kokoro tiếng Trung xếp hạng D, đọc chữ đơn có thể sai thanh | Gói giọng là tuỳ chọn; tool có danh sách ép âm cho chữ đa âm. |
| ts-fsrs v6 khai báo Node ≥ 24 | Kiểm chạy trong webview, nếu không được thì ghim v5. |
| Giấy phép Tone Perfect (MSU) | Không rõ, nên không dùng. |

## 10. Giấy phép và ghi nguồn

- **Mã nguồn:** MIT.
- **Dữ liệu sinh ra** (`src/generated`, `data/`): CC BY-SA 4.0, vì dẫn xuất từ CVDICT và CC-CEDICT, kèm phần tự biên soạn.
- **Dữ liệu nét:** Arphic Public License, kèm `ARPHICPL.TXT`.
- **Font:** OFL 1.1, kèm `OFL.txt`; bản cắt của WenKai đổi tên thành "TieuMai Kai".
- **Unihan:** Unicode License v3.
- Màn hình Giấy phép và file `THIRD_PARTY_NOTICES.md` liệt kê đủ.

## 11. Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-11-04 | Phát hành công khai, miễn phí | Bạn chọn. Nên loại mọi nguồn NC/ND. |
| 2026-11-04 | Không đóng gói giọng; giọng là plugin (system / http / pack) | Bạn chọn: app nhẹ, ai cần thì tự cài. |
| 2026-11-04 | Từ vựng v1 = HSK 3.0 cấp 1–3 + 22 chủ đề | Bạn chọn. |
| 2026-11-04 | Nhân vật pixel chibi gốc, vẽ bằng code | Bạn chọn; không có asset nào sạch giấy phép mà đủ động tác. |
| 2026-11-04 | Tauri 2 + Svelte 5 | Mục 2.2. |
| 2026-11-04 | Lưu trữ bằng plugin-store (JSON), không SQLite | Dữ liệu nhỏ; làm phần đơn giản nhất. |
| 2026-11-04 | Chữ giản thể, pinyin ghi biến điệu của 一/不 như sách HSK | Chuẩn đại lục, đúng thói quen giáo trình. |
| 2026-11-04 | Rust dùng toolchain `x86_64-pc-windows-gnu`; lib chỉ build `rlib` | Visual Studio Build Tools 2026 trên máy cài dở, thiếu Windows SDK. Linker GNU lỗi "export ordinal too large" với `cdylib`; sẽ bật lại khi làm mobile. |
| 2026-11-04 | Một nhân vật duy nhất: Rocketbox `Female_Party_02` (MIT), sửa trang phục, render sẵn | Bạn chọn: model 3D người thật, gỡ chibi/LPC/Shimeji. Render sẵn để giữ CPU/RAM thấp. |
| 2026-11-04 | Logo: tranh chibi Tiểu Mai do Codex (công cụ tạo ảnh) vẽ theo phong cách ảnh mẫu của bạn; băng tên "Tiểu Mai · Học tiếng Trung" ghép bằng font của app (`tools/logo/compose.py`), icon khay là ảnh cắt khuôn mặt | AI hay viết sai dấu tiếng Việt; icon cả tranh nhoè ở 16 px. |
| 2026-11-04 | Thay Rocketbox bằng nhân vật dựng bằng MakeHuman (MPFB2), hoạt hình đặt tay theo tốc độ thật | Bản ghép Rocketbox không giống ảnh tham chiếu, động tác nhanh và vội. MakeHuman cho chỉnh dáng, trang phục, kính, tóc; tài sản CC0/CC-BY. |
| 2026-11-04 | ts-fsrs ghim 5.4.2 | Bản 6 đổi API sang async và khai báo Node ≥ 24; bản 5 đủ dùng và chạy chắc trong webview. |
