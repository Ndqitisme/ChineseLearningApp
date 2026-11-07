# Giao diện liquid glass: tiêu chí chuẩn

Mọi thay đổi giao diện phải theo tài liệu này. Agent làm hoặc thẩm định giao diện đọc nó trước.

Nguồn kỹ thuật: [Liquid Glass in the Browser: Refraction with CSS and SVG](https://kube.io/blog/liquid-glass-css-svg/) (kube.io). Các con số dưới đây lấy từ bài đó, trừ khi ghi khác.

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
- `scale` bằng độ dịch lớn nhất, tính theo px.
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

- **Khúc xạ thật chỉ chạy trên Chromium.** Windows (WebView2) có; macOS (WKWebView) và Linux (WebKitGTK) thì không. Ở đó dùng bản thay thế: `backdrop-filter: blur() saturate()` cùng lớp viền sáng vẽ bằng gradient. Bản thay thế phải trông đúng là kính, không được vỡ bố cục.
- **Ảnh dịch chuyển phải đúng kích thước phần tử,** vì `backdrop-filter` không tự co giãn ảnh.
  - Tạo ảnh khi gắn phần tử; tạo lại khi kích thước đổi (ResizeObserver, có debounce).
  - Lưu cache theo (rộng, cao, bán kính, mép).
  - Không đổi kích thước hay hình dạng kính trong lúc chạy hiệu ứng: mỗi lần đổi là tạo lại ảnh.
- **Chỉ tạo hiệu ứng động bằng `scale`** của bộ lọc. Cách này rẻ và không phải tạo lại ảnh.
- **Kính chỉ khúc xạ được thứ nằm trong trang.**
  - Cửa sổ trợ lý trong suốt không thấy desktop phía sau. Ở đó bong bóng là kính mờ tự có màu: nền đục từ 0,82 trở lên, có viền sáng và bóng trong. Mục đích là chữ luôn đọc được trên mọi hình nền desktop.
  - Cửa sổ chính cần một nền có màu và đường nét (mảng màu mềm theo theme) để kính có cái mà bẻ cong. Nền phẳng một màu làm kính trông như không có.

## 3. Quy tắc thiết kế cho Tiểu Mai

- **Kính có thứ bậc.**
  - Khúc xạ thật dành cho phần tử nổi và tương tác: thanh bên, nút dạng viên thuốc, công tắc, thanh trượt, ô tìm kiếm, thẻ đang chọn, hộp thoại.
  - Lưới thẻ dày đặc (22 thẻ chủ đề) dùng kính rẻ hơn (blur, viền sáng); nếu đo thấy chịu được thì thẻ chỉ khúc xạ khi hover.
- **Màu mang ý nghĩa.** Màu nhóm chủ đề, trạng thái bật, tiến độ và màu thanh điệu của pinyin giữ nguyên ý nghĩa. Kính nhuốm màu nhóm bằng token, không viết màu cứng.
- **Chữ trên kính đọc được.**
  - Tương phản chữ thường từ 4,5:1, chữ lớn và icon từ 3:1.
  - Đo trên vùng nền khó nhất phía sau kính, ở cả 5 theme, sáng và tối.
- **Một hướng sáng cho cả app** (−60°). Không phần tử nào có viền sáng ngược hướng.
- **Bo góc thống nhất,** theo `--radius` của theme. Kính lồng trong kính thì bán kính trong bằng bán kính ngoài trừ khoảng đệm.
- **Bóng nằm trọn trong cửa sổ.** Đặc biệt ở cửa sổ trợ lý (xem `SHADOW_PAD` trong `src/pet/geometry.ts`).
- **Trạng thái rõ ràng:** hover, nhấn, focus (viền focus nhìn thấy được), tắt (disabled). Nhấn thì kính lún nhẹ: giảm `scale` và đổi viền sáng.
- **Tôn trọng tuỳ chọn của hệ điều hành:**
  - `prefers-reduced-transparency`: thay kính bằng nền đặc cùng màu;
  - `prefers-reduced-motion`: bỏ hiệu ứng động.
- **Hiệu năng:**
  - Trang đứng yên thì không vẽ lại gì.
  - Ngân sách RAM của cửa sổ chính là 300 MB, của trợ lý là 150 MB (`docs/PLAN.md` mục 6). Đo bằng `pnpm perf` trước và sau.
  - Cuộn trang chính phải mượt trên Intel HD 4600.

## 4. Thẩm định (bắt buộc trước khi coi là xong)

Theo cách làm pStack: chứng minh trên sản phẩm thật, ở kích thước thật, mỗi con số kèm cách đo.

**Ảnh chụp:**
- Mọi trang của cửa sổ chính và bong bóng trợ lý.
- Theme Biển (sáng và tối), Hoa anh đào (sáng), Đêm sao (tối); thêm theme khác nếu thành phần dùng màu riêng của theme.
- Kích thước cửa sổ nhỏ nhất (860×600) và một kích thước lớn.

**Danh sách kiểm từng thành phần:**
- mép kính và khúc xạ thấy được nhưng không làm méo chữ;
- viền sáng đúng hướng;
- mép không răng cưa, không viền trắng hay đen lạ;
- bóng không bị cắt;
- tương phản chữ đạt (ghi số đo);
- bo góc và khoảng cách thống nhất;
- đủ các trạng thái (hover, nhấn, focus, tắt);
- không nhảy bố cục;
- bản thay thế cho WebKit vẫn đúng.

**Vòng thẩm định:**
- Người thẩm định là agent mới, không phải agent đã làm, xem từng ảnh ở 100% và phóng to vào mép kính.
- Liệt kê mọi lỗi theo trang, thành phần và trạng thái.
- Người làm sửa, rồi thẩm định lại, cho tới khi một vòng không còn lỗi nào.
- Có số đo CPU/RAM trước và sau.
