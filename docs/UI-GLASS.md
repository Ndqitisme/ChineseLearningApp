# Giao diện liquid glass: tiêu chí chuẩn

Mọi thay đổi giao diện phải theo tài liệu này. Agent làm hoặc thẩm định giao diện đọc nó trước.

Nguồn kỹ thuật: [Liquid Glass in the Browser: Refraction with CSS and SVG](https://kube.io/blog/liquid-glass-css-svg/) (kube.io). Các con số ở mục 1 lấy từ bài đó, trừ khi ghi khác.

## 1. Kính được làm thế nào

Kính là một lớp phủ khúc xạ phần nằm phía sau nó, có viền sáng phản quang. Không phải chỉ làm mờ.

**Khúc xạ:**
- Theo định luật Snell: không khí n = 1, kính n = 1,5.
- Một lần khúc xạ, tia chiếu thẳng góc với nền, không có khe giữa kính và nền.

**Mép kính (bezel):**
- Độ cao mặt kính theo khoảng cách tới mép, x ∈ [0, 1].
- Dùng **convex squircle** `y = ⁴√(1 − (1 − x)⁴)`: chuyển tiếp mềm, mép trông mỏng.
- Không dùng concave: nó đẩy tia ra ngoài mép kính.
- Lip (`mix(convex, concave, smootherstep)`) chỉ dùng cho công tắc.

**Ảnh dịch chuyển (displacement map):**
1. Tính 127 tia trên một bán kính (khớp độ phân giải 8 bit).
2. Pháp tuyến tính bằng sai phân hữu hạn, delta 0,001.
3. Lưu từng điểm dạng (góc, độ lớn), chuẩn hoá theo độ dịch lớn nhất.
4. Xoay quanh hình để phủ cả phần tử. Hình chữ nhật bo góc thì kéo giãn phần giữa của hình tròn.
5. Mã hoá vào ảnh: R = 128 + x·127, G = 128 + y·127, B = 128, A = 255.

**Bộ lọc SVG:**
- `feImage` (ảnh dịch chuyển, đúng kích thước phần tử) đưa vào `feDisplacementMap`, với `xChannelSelector="R"`, `yChannelSelector="G"`.
- `scale` tính theo px (công thức ở mục 5).
- Đặt `color-interpolation-filters="sRGB"`.
- Viền sáng là một `feImage` thứ hai, phủ lên bằng `feBlend`.
- Áp lên phần tử bằng `backdrop-filter: url(#id)`.

**Viền sáng (specular):**
- Ánh sáng ở góc −60°, tức từ trên bên trái, giống nhau trên mọi phần tử của app.
- Độ sáng theo góc giữa pháp tuyến mặt kính và hướng sáng.

**Thông số tham chiếu từ bài:**

| Thành phần | Mép | Độ sáng viền | Bão hoà | Khúc xạ | Mờ |
|---|---|---|---|---|---|
| Ô tìm kiếm | convex | 0,20 | 4 | 0,70 | 1,0 |
| Công tắc | lip | 0,50 | 6 | 1,00 | 0,2 |
| Thanh trượt | convex | 0,40 | 7 | 1,00 | 0 |
| Trình phát nhạc (thẻ lớn) | convex | 0,40 | 6 | 1,00 | 1,0; nền kính đục 0,60 |

## 2. Giới hạn kỹ thuật (bắt buộc tính tới)

- **Khúc xạ thật chỉ chạy trên Chromium.**
  - Windows (WebView2) có; macOS (WKWebView) và Linux (WebKitGTK) thì không.
  - Ở đó dùng bản thay thế: `backdrop-filter: blur() saturate()` cùng lớp viền sáng vẽ bằng gradient.
  - Bản thay thế phải trông đúng là kính, không được vỡ bố cục.
- **Ảnh dịch chuyển phải đúng kích thước phần tử,** vì `backdrop-filter` không tự co giãn ảnh.
  - Tạo ảnh khi gắn phần tử; tạo lại khi kích thước đổi (ResizeObserver, có debounce).
  - Lưu cache theo (rộng, cao, bán kính, mép).
  - Không đổi kích thước hay hình dạng kính trong lúc chạy hiệu ứng: mỗi lần đổi là tạo lại ảnh.
- **Chỉ tạo hiệu ứng động bằng `scale`** của bộ lọc. Cách này rẻ và không phải tạo lại ảnh.
- **Kính chỉ khúc xạ được thứ nằm trong trang.**
  - Cửa sổ trợ lý trong suốt, không thấy desktop phía sau.
  - Bong bóng, menu và nút ngủ trong cửa sổ đó không dùng `backdrop-filter`: trang có `data-glass="none"` (`pet.html`).
  - Bong bóng đục 100 %: pinyin tô màu thanh điệu chỉ đạt 4,5:1 trên desktop đen khi nền bong bóng từ 0,96; dưới 100 % thì phần đáy đuôi đè lên thân hiện thành một vệt đục hơn.
  - Bong bóng dùng một `filter: drop-shadow` cho cả thân và đuôi.
  - Cửa sổ chính cần một nền có màu (các đốm màu mềm theo theme) để kính có cái mà bẻ cong. Nền phẳng một màu làm kính trông như không có.
  - Nền không có vạch, chấm hay hoa văn: chúng làm nền trông gắt cạnh kính.
- **Kính trên nền trắng đều không bẻ cong được gì thấy được.**
  - Trên nền mềm, độ dịch chỉ đổi nền dưới mép vài mức; trên thẻ trắng nó đổi 0 mức.
  - Vì vậy ở đó kính đọc ra qua viền sáng, mép nhuốm màu và bóng đổ, không qua độ dịch.
  - Tăng độ bẻ hay làm dốc nền để độ dịch hiện rõ hơn thì trái với nền êm: không làm.

## 3. Quy tắc thiết kế cho Tiểu Mai

- **Kính có thứ bậc.**
  - Khúc xạ thật dành cho phần tử nổi và tương tác: thanh bên, nút dạng viên thuốc, công tắc, thanh trượt, ô tìm kiếm, thẻ đang chọn, hộp thoại.
  - Lưới thẻ dày đặc (22 thẻ chủ đề) và nhóm nút dày (15 nút thanh điệu) chỉ khúc xạ khi rê chuột.
- **Màu mang ý nghĩa.**
  - Màu nhóm chủ đề, trạng thái bật, tiến độ và màu thanh điệu của pinyin giữ nguyên ý nghĩa.
  - Kính nhuốm màu nhóm bằng token, không viết màu cứng.
- **Chữ trên kính đọc được.**
  - Tương phản chữ thường từ 4,5:1, chữ lớn và icon từ 3:1.
  - Đo trên vùng nền khó nhất phía sau kính, ở cả 5 theme, sáng và tối, ở ba chế độ kính (khúc xạ, bản thay thế, giảm trong suốt).
  - Vùng nền tính theo ô 3×3 điểm ảnh.
  - Chữ dưới cỡ chữ lớn của WCAG và chữ mảnh còn phải đạt 4,5:1 trên điểm ảnh nó thực sự vẽ (lõi nét), không chỉ theo màu khai báo: nét chữ nhỏ không bao giờ đạt màu khai báo.
  - Icon mask đo theo lõi nét đã vẽ, cùng lý do.
- **Tương phản phi văn bản 3:1:** mặt tô tiến độ với rãnh và nền, rãnh công tắc bật với nền, mặt tô thanh trượt với rãnh, vòng trạng thái với nền ngoài, vòng focus với cùng chỗ khi chưa focus, nét trên bảng Viết theo nét.
- **Một hướng sáng cho cả app** (−60°). Không phần tử nào có viền sáng ngược hướng.
- **Bo góc thống nhất,** theo `--radius` của theme.
  - Kính lồng trong kính thì bán kính trong bằng bán kính ngoài trừ khoảng đệm, tối thiểu 4 px (`--nested-r`).
- **Bóng nằm trọn trong cửa sổ.** Đặc biệt ở cửa sổ trợ lý (xem `SHADOW_PAD` trong `src/pet/geometry.ts`).
- **Trạng thái rõ ràng:** hover, nhấn, focus (viền focus nhìn thấy được), tắt (disabled). Luật đo ở mục 5, "Trạng thái".
- **Tôn trọng tuỳ chọn của hệ điều hành:**
  - `prefers-reduced-transparency`: thay kính bằng nền đặc cùng màu, giữ viền theo hướng sáng;
  - `prefers-reduced-motion`: bỏ hiệu ứng động.
- **Hiệu năng:**
  - Trang đứng yên thì không vẽ lại gì.
  - Ngân sách RAM ở `docs/PLAN.md` mục 6. Đo bằng `pnpm perf` trước và sau.
  - Cuộn trang chính phải mượt trên Intel HD 4600.
  - Mỗi bộ lọc khúc xạ là một lượt vẽ lại nền khi cuộn: lưới nhiều phần tử dùng kính vẽ bằng CSS.

## 4. Thẩm định (bắt buộc trước khi coi là xong)

Chứng minh trên sản phẩm thật, ở kích thước thật, mỗi con số kèm cách đo.

**Ảnh chụp:**
- Mọi trang của cửa sổ chính và bong bóng trợ lý.
- Theme Biển xanh (sáng và tối), Hoa anh đào (sáng), Đêm sao (tối); thêm theme khác nếu thành phần dùng màu riêng của theme.
- Kích thước cửa sổ nhỏ nhất (860×600) và một kích thước lớn.

**Danh sách kiểm từng thành phần:**
- mép kính và khúc xạ thấy được nhưng không làm méo chữ;
- viền sáng đúng hướng;
- mép không răng cưa, không viền trắng hay đen lạ;
- bóng không bị cắt;
- tương phản chữ và phi văn bản đạt (ghi số đo);
- bo góc và khoảng cách thống nhất;
- đủ các trạng thái (hover, nhấn, focus, tắt);
- không nhảy bố cục;
- bản thay thế cho WebKit vẫn đúng.

**Vòng thẩm định:**
- Người thẩm định là agent mới, không phải agent đã làm, xem từng ảnh ở 100 % và phóng to vào mép kính.
- Liệt kê mọi lỗi theo trang, thành phần và trạng thái.
- Người làm sửa, rồi thẩm định lại, cho tới khi một vòng không còn lỗi nào.
- Có số đo CPU/RAM trước và sau.

**Bộ đo:** chụp ảnh (`shoot.mjs`), tương phản chữ (`contrast.mjs`), phi văn bản (`nontext.mjs`), trạng thái (`states.mjs`), khúc xạ và hướng sáng (`prove.mjs`), tải lúc nhàn rỗi (`idle.mjs`), gom lại bằng `gate.sh`. Bộ này nằm ở `tools/glass`; kết quả ghi vào `.cache/glass`.
- Mỗi script mở Chrome qua `tools/chrome-profile.ts`; lý do ở `tools/e2e/README.md`.
- Ép `prefers-reduced-motion: no-preference`: Chrome headless theo cài đặt hiệu ứng của Windows.
- Ép bản thay thế trong Chrome bằng `?glass=fallback` trên URL của cửa sổ.

## 5. Trong code

### Bộ lọc và action

- `src/lib/ui/glass/maps.ts`: ảnh dịch chuyển và ảnh viền sáng cho một phần tử, cache theo (rộng, cao, bán kính, mép). 127 tia một bán kính, Snell n = 1,5, mặt kính cao 1,6 lần bề rộng mép.
- `feDisplacementMap` dịch điểm lấy mẫu `scale × (R/255 − 0,5)`, nên `scale` = độ dịch lớn nhất × 255/127 để độ dịch vẽ ra bằng bảng tia. `maps.test.ts` giải mã ảnh bằng đúng công thức đó.
- Chặn độ dốc: đi vào trong, mỗi tia giảm dịch chuyển không quá 0,7 px cho mỗi px (`SLOPE`), nên điểm lấy mẫu luôn tiến vào trong và nền cong thành cung, không gập thành vòng.
  - Rê chuột nhân `scale` 1,2: 0,7 cộng một mức làm tròn 8 bit, nhân 1,2, vẫn dưới 1.
  - Độ dịch của mỗi điểm ảnh nội suy giữa hai tia, không làm tròn về tia gần nhất.
  - Mép lip (công tắc) không chặn: rãnh là mặt đục.
- Viền sáng nền (12 %) tắt dần trên mép quay khỏi nguồn sáng (phải, dưới). Viền sáng của mép lip tắt dần vào giữa rãnh.
- `src/lib/ui/glass/glass.ts`: action `use:glass`.
  - Gắn bộ lọc SVG vào `backdrop-filter`; tạo lại ảnh khi đổi kích thước (ResizeObserver, trễ 80 ms).
  - Chỉ đổi `scale`: ×1,2 khi rê chuột, ×0,5 khi nhấn.
  - Tuỳ chọn: `hover: true` chỉ bật khúc xạ khi rê chuột; `when: false` tắt; `specular` đổi theo theme; `strength` nhân độ bẻ (mặc định 1; lớn hơn 1 thì phải kiểm lại chặn độ dốc); `blur` mặc định 0, vì nền sau kính đã mềm.
  - Phần tử tắt không cong nền khi rê chuột hay nhấn.
- Độ sáng viền của bộ lọc: theme sáng 0,9 (`LIGHT_SPECULAR`, mặc định khi không truyền `specular`), theme tối 0,4, thanh bên 0,3, ô tìm 0,2. Viền trắng phủ kiểu screen lên nền gần trắng chỉ thêm vài mức, nên theme sáng cần viền mạnh hơn.
- Theme sáng: mép kính nhuốm `--primary-fill` 18 % (`BEZEL_TINT`), đậm nhất ở mép ngoài, tắt dần theo bình phương độ nghiêng, nằm trong 5–6 px ngoài cùng, không chạm nhãn.
  - Mặt nạ là kênh B của ảnh dịch chuyển (`feDisplacementMap` chỉ đọc R và G); màu đi theo theme qua biến CSS trong `flood-color`.
  - Công tắc không nhuốm.
- Chế độ ghi ở `<html data-glass>`: `refract` (Chromium, có `navigator.userAgentData` và `backdrop-filter: url()`), `fallback` (WebKit: blur, bão hoà, viền gradient), `none` (cửa sổ trợ lý).
- Theme ghi ở `<html data-theme-id>`.

### Các lớp kính (`src/lib/ui/glass/glass.css`)

- `.glass`: mờ và viền sáng; action nâng lên khúc xạ.
- `.glass-soft`: không lọc nền.
- `.glass-solid`: kính gần đặc, cho bong bóng.
- `.glass-press` (nút), `.glass-lift` (thẻ là liên kết hay đáp án), `.glass-row` (dòng trong thẻ, mục thanh bên): một bộ quy tắc tương tác chung.
- `.glass-arc` (theme tối: bong bóng, menu, nút ngủ, mẫu theme, thẻ chủ đề và thẻ HSK đang chọn): viền trên và trái gần như tắt, thay bằng một vòng 1,5 px ngay trong mép, sáng nhất ở cung trên trái. Thẻ đang chọn co cung về góc (`--arc-size`) và nhuốm màu nhóm (`--arc-tint`).
- Viền sáng theo pháp tuyến từng mép (`--glass-rim`, bốn `box-shadow` lõm theo bo góc, dày `--glass-rim-w`):
  - mép trên trắng 0,95, mép trái trắng 0,55;
  - mép dưới vạch tối (`--text` 16 % ở theme sáng, `--bg` 60 % ở theme tối, vì `--text` của theme tối là màu sáng);
  - mép phải vạch tối nhạt hơn;
  - một gradient tuyến tính qua cả hộp làm tấm rộng sáng từ bên trái.
- Phần tử có vòng màu 2 px đè lên mép (bong bóng, menu, nút ngủ, trạng thái chọn, đúng, sai) có viền sáng dày 3 px để viền hiện ngay bên trong vòng.
- `--glass-shadow` không bao giờ là `none`: trong danh sách `box-shadow` có `none` thì cả khai báo bị bỏ, mất luôn viền sáng. Dùng `0 0 transparent`.
- Ô nhập (input không có `::before`) vẽ viền bằng box-shadow, cùng viền chung.
- Đĩa tròn nhỏ tô kín màu (chuông đang bật) không dùng viền theo từng mép: một vòng 1 px ở giữa và vệt sáng hướng tâm.

### Độ đục và màu

- Độ đục kính: thẻ 86 % màu `--surface`, thẻ đang chọn 64 %, thanh bên 36 %, nút viên thuốc, nút quay lại, ô tìm, ô ghép câu và nút thanh điệu 30 %, ô chọn, ô giờ và ô CSS riêng 26 %.
- Mặt tô màu chính (nút primary, chip đang bật, mục đang chọn ở thanh bên) đục 100 %: chỉ 6 % nền lọt qua đã kéo chữ trắng xuống dưới 4,5:1.
- Nền kính theme sáng pha 5 % `--primary` để viền trắng hiện được.
- Bên trong mặt thẻ có hai mảng màu mờ ở hai góc trên (`--primary`, `--accent`), không vạch: điều khiển trên thẻ có một dải màu để bẻ. Đáy thẻ không sáng hơn giữa thẻ (ngược hướng sáng).
- Nền phía sau: các đốm màu lớn, mềm trên `--bg`, gắn với cửa sổ (`.shell` không cuộn, trang cuộn bên trong).
  - Mọi đốm lấy màu của chính theme: màu lạ ở độ đục thấp pha với màu theme thành xám.
  - Có một đốm sau dải đầu trang, để nút quay lại, tiêu đề và viên thuốc chế độ có dải màu để bẻ.
  - Mỗi đốm mờ dần theo năm điểm dừng: mờ tuyến tính để lại một điểm sáng ở tâm.
  - Không thêm nhiễu chống phân dải: Chrome đã dither gradient.
  - Bản giảm trong suốt dùng cùng nền.
- `--primary-fill` là màu chính dùng làm mặt tô (công tắc bật, thanh trượt, thanh tiến độ, nét trên bảng Viết theo nét).
  - Bằng `--primary`, trừ Hoa anh đào sáng: hồng nhạt pha 28 % `--text` để đạt 3:1.
  - Theme tối: màu sáng (pha 45 % trắng); núm trên nó đổi sang tối (`--bg`).
- Theme sáng: `--text-2` ở độ chói L ≈ 0,125 (6:1 trên trắng); màu thanh điệu, `--good`, `--bad` và các `--hue-*` ở 5:1 trên trắng.
- Chữ mờ nằm thẳng trên nền dùng `--text-2-strong`. `--hue-*` là màu chữ, không dùng làm nền.
- Chữ mờ cỡ nhỏ và chữ phụ trên thẻ nhuốm màu pha thêm `--text` và tăng weight để lõi nét đạt 4,5:1 (luật chung trong `src/main/app.css`).
- Pinyin weight 600 ở mọi theme: mặt Kai chỉ có một weight nên đây là đậm giả; màu thanh điệu giữ nguyên.
- Icon có màu nhóm ở theme sáng dùng mực của màu đó (40 % màu nhóm pha màu chữ).
- Vòng trạng thái (thẻ chủ đề đang chọn, nút chấm mức nhớ) đủ màu, không pha trong suốt, để đạt 3:1 với nền ngoài.
- Rãnh thanh tiến độ đục: `--text` 14 % pha với `--surface`, không pha trong suốt.
- Bóng của theme sáng 10 %. Nút nhỏ dùng bóng sát, vì bóng rộng của nhiều nút cạnh nhau đọng thành vệt tối.
- Chữ Hán trong chữ giao diện tiếng Việt dùng Kai như pinyin (`--font-ui`): một mặt chữ Hán cho cả app.

### Trạng thái

- Rê chuột: viền trên sáng hơn (`--rim-hover`), mặt nhuốm màu chính.
  - Viên thuốc, chip, ô chọn, ô tìm, ô giờ: `--pill-hover-tint`; trên thẻ gần trắng chỉ đục hơn thì không thấy khác.
  - Thẻ: nổi 2 px và nhuốm `--lift-tint`. Thẻ ở theme sáng chỉ đổi khoảng 4 mức khi rê chuột, vì nhuốm đủ 6 mức thì pinyin trên thẻ xuống dưới 4,5:1 (ngoại lệ có chủ ý).
  - Dòng trong thẻ ở theme sáng nhuốm 8 % (14 % làm pinyin thanh 1 xuống dưới 4,5:1), theme tối 10 %.
  - Theme tối không có viền trên trắng tinh khi rê chuột.
- Nhấn: co 0,96 (dòng 0,98), viền tối (`--rim-press`), bóng trong.
  - Theme tối: mặt lúc nhấn tối hơn lúc nghỉ ít nhất 6 mức, bằng bóng trong màu `--bg` và một lớp đen phủ cả mặt; thẻ và nút trả màu rê chuột về màu nghỉ khi nhấn (`:not(:active)`).
  - Công tắc, nút "Đoán nghĩa" của bong bóng và thẻ không co khi nhấn mà chỉ lún (viền tối, bóng trong, xuống 1 px): lớp khúc xạ hay lớp `will-change: transform` bị co được vẽ lại mờ.
  - Thẻ không lún khi đang nhấn một nút bên trong nó: cú nhấn thuộc về nút.
- Focus: một kiểu vòng cho mọi điều khiển kính, `--primary-ink`, 2 px, cách mép 2 px ra ngoài, chỉ khi focus bằng bàn phím (`:focus-visible`, và `:has(:focus-visible)` cho công tắc và thanh trượt bọc input).
  - Dòng trong thẻ và nút trong nhóm sát nhau (nút thanh điệu, chuông) có vòng bên trong.
  - Không dùng `outline` cho trạng thái chọn: nó che viền sáng.
- Tắt: mỏng hơn, chữ `--text-2`, không dùng opacity, không phản ứng khi rê chuột hay nhấn.
- Chọn, đúng, sai vẫn là kính: màu nhạt trong nền, một vòng 2 px màu trạng thái đè lên mép.
  - Kết quả kiểm có dấu và nhãn, không chỉ màu: màu thanh điệu trên pinyin trùng sắc với màu đúng sai.
  - Dấu tròn 14 px (`check-disc`, `cross-disc`) đặt trên vòng ở góc trên phải; trắc nghiệm đặt cùng dấu trong phần đệm của thẻ đáp án.
  - Nút thanh điệu đã chọn có vạch `--primary-ink` dưới nút, không có vòng, để không nhầm với vòng focus.
- Luật đo trạng thái (`states.mjs`): rê chuột đổi trung vị mặt ít nhất 6 mức; nhấn khác rê chuột; theme tối, nhấn tối hơn nghỉ ít nhất 6 mức; focus bằng phím Tab thật có đúng một vòng nhìn thấy được, không cắt mép thẻ hay chạm điều khiển bên cạnh; phần tử tắt không phản ứng.
  - Ngoại lệ ghi trong `EXEMPT` của tool: liên kết trong đoạn chữ, nút tiêu đề Windows, nhân vật trợ lý, mẫu theme khi rê chuột, ô màu tự chỉnh, thanh trượt khi nhấn, thẻ ở theme sáng khi rê chuột.

### Thành phần

- Danh sách chọn: `src/lib/ui/Select.svelte`, thay `<select>` gốc (danh sách của trình duyệt vuông, đặc, màu hệ thống).
  - Nút và bảng `role=listbox` trên `.glass` đục 100 %; phím mũi tên, Home/End, Enter, Esc, gõ chữ để nhảy, đóng khi bấm ra ngoài hay mất focus.
  - Nút rộng bằng lựa chọn dài nhất, nên bảng mở ra rộng đúng bằng nút.
  - Thẻ đang mở danh sách nổi lên trên các thẻ sau nó.
- Công tắc: `src/lib/ui/Switch.svelte`. Thanh trượt: `src/lib/ui/Range.svelte`.
- Ô chọn, ô giờ, ô CSS riêng và mẫu theme đang chọn có mép khúc xạ 4 px: mép sâu hơn bán kính góc gập thành vệt sáng chéo ở bốn góc.
- Hai công tắc cuối thanh bên ("Bảng gợi ý", "Skin"): nhãn thẳng cột icon của các mục thanh bên, công tắc sát lề phải của chúng. Công tắc "Skin" chỉ bấm được khi bảng gợi ý đang bật; tắt bảng thì nó xám đi và giữ nguyên giá trị (tên gọi ở `docs/PLAN.md` mục 3).
- Một cột nội dung cho mọi trang (`.page`, tối đa 1080 px): nút quay lại, tiêu đề và mép thẻ không xê dịch khi chuyển trang.
- Tên chủ đề và nghĩa trong đáp án xuống dòng giữa các cụm (`src/lib/ui/Phrases.svelte`), để từ hai âm tiết không bị tách.
- Pinyin viết liền (câu ví dụ, câu chuẩn ghép câu) tách âm tiết bằng `splitWritten` (`src/lib/pinyin.ts`) để tô màu từng âm tiết.
- Nút "Tiếp →" ở các bài luyện nằm dưới bài, canh phải, có chỗ sẵn trước khi kiểm.
  - Khung cuộn có `scroll-padding-block: 24px`.
  - Trang chỉ cuộn khi hàng bị cắt hay cách mép dưới chưa tới 8 px, và chỉ cuộn đủ để còn 8 px (`revealRow`, `src/lib/ui/reveal.ts`), đo sau khi font đã tải.
- Chú thích pinyin khi rê chuột đặt giữa từ được tô (CSS Highlight 16 % màu chính, không đổi DOM), không tràn sang thanh bên; trên điều khiển thì không tô từ.
- Chuông chưa bật ở theme sáng không có bộ lọc (22 thẻ một lưới); dáng kính vẽ bằng CSS cùng `BEZEL_TINT` và `LIGHT_SPECULAR`.
- Nút tròn ở góc thẻ đồng tâm với góc thẻ khi bán kính theme cho phép; theme bán kính 14 px (Biển xanh) lùi 4 px, không đồng tâm hẳn (ngoại lệ có chủ ý).
- Bảng Viết theo nét (hanzi-writer): nét bộ thủ và nét gợi ý tô `--primary-fill`, nét đang kéo tô `--primary-ink`; màu đổi sang `rgb()` vì hanzi-writer chỉ đọc hex và rgb.
- Đồ thị cao độ (Thanh điệu) vẽ theo đúng bề rộng khung; đường thanh chuẩn chỉ vẽ sau khi kiểm (trước đó nó là đáp án).
- Ảnh QR ở trang Ủng hộ: `clip-path` cắt khung ngoài của ảnh gốc, giữ tấm sáng chứa mã với đủ vùng trắng quanh mã cho máy quét.
- Thanh bên, tiêu đề, nút, chip, công tắc, thẻ lật không chọn được như chữ (`user-select: none`).

### Cửa sổ trợ lý

- Mặt kính ở theme sáng pha 15 % `--primary` (Hoa anh đào 20 %), theme tối 6 % (`--pet-tint`), vì viền trắng chỉ nổi lên được trên nền thấp hơn trắng; một quầng trắng mềm dọc mép trên (`--pet-glow`).
- Bong bóng, menu và nút ngủ có mép trên dày 4 px (2 px hiện bên trong vòng màu).
- Đáy đuôi đè lên thân 4 px, che cả vòng màu và viền sáng. Đuôi bắt đầu dưới cung góc trên ít nhất `--radius` + 12 px.
- Bong bóng có lớp riêng từ lúc nghỉ (`will-change: transform`), để chữ không đổi kiểu khử răng cưa khi nút trong đó có lớp riêng.
- Hiệu ứng bật lên (scale 0,6 → 1) không vượt quá 1: vượt quá thì lớp `will-change: transform` giữ tỉ lệ raster của lúc bật lên và cả bong bóng mềm đi.
- Huy hiệu HSK pha 14 % màu tím vào chính mặt bong bóng, có viền 1 px.
- Viền hoa lá (id `leaf`):
  - Một luống hoa lá thấp dọc đáy bong bóng: celandine, bồ công anh, empodium, sorrel.
  - Dừa cạn và cành lá mọc men lên hai góc dưới.
  - Lớp hoa lá nằm sau bong bóng: phần chạm mép bong bóng bị mặt kính che.
  - Mỗi cây nhận chuột trên phần nhìn thấy của nó (khung bao đường bao trong `meadow.json`); các khung này được báo thêm vào vùng nhận chuột, ngoài đó chuột vẫn xuyên qua cửa sổ.
  - Bấm vào hoa lá: sang từ tiếp theo, như bấm vào nhân vật Trợ lý; nhấn rồi kéo: kéo bảng; chuột phải: menu.
  - Rê chuột qua: cây dưới chuột bị gạt theo hướng chuột đi, mạnh theo tốc độ ngang của chuột, rồi về chậm.
- Hình của Viền hoa lá:
  - Render bằng Blender từ mô hình CC0 của Poly Haven (`tools/skins/meadow/`), ghim sha256, thành atlas `src/pet/frames/meadow@1x.png`, `@2x`, `@3x`.
  - Render ở 6 lần cỡ hiển thị rồi lọc xuống từng cỡ, để nét ở mọi tỉ lệ màn hình.
  - Giữ màu tự nhiên của cây, không pha theo theme.
  - App chọn atlas theo `devicePixelRatio` (làm tròn lên, từ 1 đến 3) và chọn lại khi cửa sổ sang màn hình khác.
  - `meadow.json` ghi lề cửa sổ (trên, hai bên, dưới) và từng hình: góc neo, vị trí, cỡ, điểm gốc, ô trong atlas, mức lay, đường bao phần nhìn thấy.
  - Cửa sổ rộng 264 px cộng hai lề bên, cao bằng bong bóng cộng lề trên và dưới.
  - Bộ dựng đẩy cây sát mép cửa sổ vào trong và giới hạn mức lay của từng hình, để không hình nào bị mép cửa sổ cắt kể cả khi ngả hết mức; `meadow.test.ts` kiểm điều đó trên đường bao.
- Hoa lá lay (`src/pet/frames/sway.ts`):
  - Chậm và mượt: mỗi hình là một lò xo khoảng 0,45 Hz, tắt dần 0,7; ngả một nhịp rồi về, không lắc qua lại.
  - Gió đến theo đợt khi đổi từ và khi rê chuột vào bảng, lên xuống mượt (sin²), trôi từ trái sang phải; hình đứng yên sau vài giây.
  - Hình nghiêng bằng phép xô (skew) quanh điểm gốc, không xoay: gốc đứng yên, ngọn ngả.
  - Mức lay của từng hình nhân với góc của lò xo (tối đa ±25°, `SWAY_MAX`): hoa lay nhiều, lá thấp ít.
  - Kéo bảng: hoa lá ngả ngược hướng kéo suốt lúc cửa sổ di chuyển (lực cản gió theo vận tốc: kéo đều 600 px/s nghiêng khoảng 20°), cộng thêm cú hích quán tính lúc bắt đầu và dừng; lực bão hoà mềm ở 22°.
  - Vị trí cửa sổ lúc kéo đọc từ `window.screenX/screenY` mỗi khung hình: Windows ngừng chuyển sự kiện Moved vào trang sau khoảng 0,3 giây kéo.
  - Bảng coi là đã thả khi vị trí và sự kiện Moved cùng đứng yên (300 ms nếu đã thấy chuột nhả, 1,5 giây nếu chưa); chỉ khi đó mới hít mép.
  - Vòng vẽ chỉ chạy khi có hình đang động, có đồng hồ dự phòng khi Windows giữ lại khung hình lúc kéo cửa sổ; không chạy liên tục vì cửa sổ trợ lý đang vượt ngân sách CPU (`docs/PLAN.md` mục 6).
  - `prefers-reduced-motion` tắt chuyển động.
  - Còn phải đo `pnpm perf` với skin Viền hoa lá trên máy yếu.
- Câu ví dụ chữ Hán ở theme tối trông đậm hơn theme sáng: chấp nhận, đó là cách Chrome vẽ chữ sáng trên nền tối.
