# Lộ trình tính năng học nhanh

> Tính năng tiếp theo, theo thứ tự ưu tiên. Thiết kế chung: [PLAN.md](PLAN.md).

## 0. Mục tiêu

**Mục tiêu:** người học đã có trợ lý cho xem từ cả ngày và các chế độ luyện trong app chính. Bước tiếp theo không phải thêm nhiều chế độ, mà làm cho vòng học chính (thấy từ → nhớ lại → ôn đúng lúc) chắc hơn, và nhắm vào chỗ người Việt hay vấp: thanh 2 với thanh 3, từ Hán Việt "giống mà khác nghĩa", lượng từ.

**Cách chọn thứ tự:** bằng chứng mạnh và tác động vào vòng học chính đứng trước; dễ làm chỉ là tiêu chí phụ. Mỗi mục chỉ làm khi mục trước đã qua hết các ca kiểm thử của nó.

**Ghi nhãn:** [đo] là có trong nguồn đã đọc hoặc trong code; [suy luận] là suy ra, chưa kiểm; [đoán] là chưa có căn cứ.

## 1. Đã có

- **Khoá HSK 4–6:** mặc định mở HSK 1–3; người học tự mở 4 → 5 → 6 trong app. Mỗi cấp chia bài 25 từ theo tần suất. Gói từ nạp khi mở khoá (`src/generated/hsk4.json`…); `settings.hskOpen` mặc định 3.
- **Hai bộ từ HSK 3.0:** bản 2025 (`newest-1..6`, đề cương công bố tháng 11/2025) và bản 2021 (`new-1..6`). Chọn ở trang Chủ đề hoặc Cài đặt (`settings.hskEdition`, mặc định 2025). Đổi bộ không làm mất từ ở Ôn tập, Sổ tay, Tra cứu và trang từ. Nguồn chưa thống nhất về ngày kỳ thi chuyển sang bản mới, nên app không ghi ngày thi.
- **Tab "Ủng hộ tác giả"** (`#/support`): một câu ngắn và mã QR "Số tài khoản ngân hàng". Không popup, không nhắc.

## 2. Các tính năng, theo thứ tự ưu tiên

Công sức: **S** = dưới một ngày, một hai file; **M** = một đến hai ngày, có dữ liệu hoặc trang mới; **L** = nhiều hơn.

### 2.1 Ôn tập hai chiều

- **Giá trị cho người học:** hôm nay thẻ ôn chỉ hỏi một chiều: thấy chữ → nhớ nghĩa [đo, `src/main/pages/Review.svelte`]. Người học nhận ra chữ nhưng không tự nghĩ ra được chữ khi cần nói hay viết. Thêm chiều ngược: thấy nghĩa → tự nhớ chữ và cách đọc.
- **Bằng chứng:** mạnh nhất trong các mục. Nhớ lại có phản hồi thắng đọc lại sau 2 ngày và 1 tuần (Roediger & Karpicke 2006); ôn giãn cách có meta-analysis lớn (Cepeda et al. 2006); trộn chiều hỏi giúp nhớ chiều khó hơn sau 24 giờ (Soderstrom 2026). Xem thêm [Testing effect](https://en.wikipedia.org/wiki/Testing_effect) và [Spaced repetition](https://en.wikipedia.org/wiki/Spaced_repetition).
- **Thiết kế:** không thêm dữ liệu. Vẫn một thẻ FSRS mỗi từ trong `progress.srs` (các chỗ khác như `Pet.svelte`, `Practice.svelte` coi khoá của `progress.srs` là id từ, nên không tách thẻ riêng). Chiều hỏi lấy từ thẻ: `reps` chẵn → chữ → nghĩa như cũ; `reps` lẻ → mặt trước hiện `vi` (không hiện Hán Việt vì nó lộ cách đọc), mặt sau hiện chữ, pinyin, ví dụ. Một nhãn nhỏ cho biết chiều đang hỏi. Chỉ sửa `src/main/pages/Review.svelte`.
- **Công sức:** S.
- **Rủi ro:** hai kỹ năng chung một lịch, nên FSRS có thể hẹn hơi sớm hoặc hơi muộn cho một chiều [suy luận]; chấp nhận vì nhỏ hơn nhiều so với tách thẻ. Một số nghĩa Việt trùng nhau giữa nhiều từ; người học tự chấm nên không sai điểm, nhưng mặt trước cần đủ gợi ý (chủ đề hoặc cấp HSK).
- **Ca kiểm thử:**
  1. Thẻ mới (chưa có `reps`) mở ra ở chiều chữ → nghĩa.
  2. Chấm "Nhớ" xong, lần sau thẻ đó hiện chiều nghĩa → chữ.
  3. Ở chiều nghĩa → chữ, mặt trước không lộ chữ Hán, pinyin hay Hán Việt; rê chuột không hiện tooltip pinyin.
  4. Lật thẻ bằng Space, chấm bằng phím 1–4 vẫn chạy ở cả hai chiều.
  5. Chấm "Quên": thẻ quay lại cuối hàng trong phiên, không treo, đếm "đã xong" không tăng.
  6. Thẻ của từ thuộc cấp đã khoá lại (ví dụ HSK 5 sau khi hạ `hskOpen` về 4) bị bỏ qua, trang không lỗi.
  7. Từ hai chữ trở lên và từ có ví dụ hiển thị đủ, không tràn khung ở cửa sổ nhỏ nhất.

### 2.2 Gõ pinyin từ trí nhớ

- **Giá trị:** chọn đáp án trong 4 lựa chọn dễ đoán mò; tự gõ buộc phải nhớ ra cả âm lẫn thanh. Đây là chiều "sản xuất" rẻ nhất, không cần micro hay giọng.
- **Bằng chứng:** gián tiếp. Giả thuyết pinyin định hình cách nhớ thanh (Taft 2026); một nghiên cứu thử 30 học sinh cho thấy viết tay rồi gõ tốt hơn chỉ viết tay (Guo et al. 2026). Chủ yếu dựa vào hiệu ứng nhớ lại ở mục 2.1.
- **Thiết kế:** thêm chế độ `type` vào `src/main/pages/Quiz.svelte` (đang có `meaning | hanzi | listen`), một thẻ chế độ trong `src/main/pages/Practice.svelte`. Hiện chữ và nghĩa, ô nhập pinyin; chấp nhận dấu thanh hoặc số (`mi3fan4`). Thêm một hàm thuần `matchPinyin(input, word)` trong `src/lib/pinyin.ts` dùng lại `numericToMarked` và `searchKey`: đúng cả thanh → Good, đúng âm sai thanh → Hard và tô đỏ âm tiết sai thanh, sai âm → Again. Có vitest cho hàm này (nhiều nhánh: ü/v, dấu nháy, khoảng trắng, thanh nhẹ số 5 hoặc 0).
- **Công sức:** S–M.
- **Rủi ro:** từ có nhiều cách đọc (多音字) và thanh nhẹ ghi không thống nhất; chỉ so với `word.syllables` đã có. Bộ gõ tiếng Việt kiểu VNI biến số thành dấu ("a1" → "á") [đoán, chưa thử]; cần thử thật trên Windows có bật Unikey.
- **Ca kiểm thử:**
  1. Gõ `mifan` (không thanh), `mi3fan4`, `mǐfàn`, `mi3 fan4` cho 米饭: lần lượt Hard, Good, Good, Good.
  2. Gõ `nü3` và `nv3` cho 女: cả hai Good.
  3. Gõ sai âm: Again, hiện đáp án đúng có tô màu thanh.
  4. Ô trống bấm Enter: không chấm, không ghi FSRS.
  5. Bật Unikey kiểu VNI rồi gõ `mi3fan4`: kết quả vẫn đúng, hoặc trang nói rõ cần tắt bộ gõ.
  6. Trong vùng câu hỏi, rê chuột lên chữ Hán không hiện pinyin (đó là đáp án).
  7. Hết 10 câu: màn tổng kết giống các chế độ Quiz khác, nút làm lại chạy.

### 2.3 Cảnh báo "bẫy Hán Việt"

- **Giá trị:** với người Việt, Hán Việt là cầu nối lớn nhất, và cũng là chỗ hiểu sai nặng nhất: 困难 là "khó khăn" chứ không phải "khốn nạn", 工作 là "làm việc" chứ không phải "công tác", 表情 không phải "biểu tình". App đã chỉ hiện Hán Việt khi cùng nghĩa [đo, PLAN mục 8], nhưng chưa nói gì khi một từ hay bị hiểu nhầm.
- **Bằng chứng:** bài khảo sát lỗi chuyển di của sinh viên (Lê Văn Trung 2012, Tạp chí Khoa học ĐHSP TP.HCM số 35) và danh sách từ "giống mà khác" ở [Sino-Vietnamese vocabulary](https://en.wikipedia.org/wiki/Sino-Vietnamese_vocabulary). Là mô tả, không phải thử nghiệm đối chứng.
- **Thiết kế:** file tay `data/hanviet/false-friends.tsv` gồm `hanzi`, `hanviet`, `nghĩa dễ nhầm`, `nghĩa thật`, `nguồn`. `tools/data/build.ts` gắn vào từ thành trường tuỳ chọn `Word.trap?: { vi: string }` và báo lỗi nếu chữ không có trong dữ liệu hoặc ô trống. Hiện một chip "Dễ nhầm" trên `src/main/pages/Word.svelte` và ở mặt sau thẻ ôn. Bắt đầu với 20–40 dòng, mỗi dòng có người kiểm. Theo luật "chưa chắc thì ẩn".
- **Công sức:** M (phần lớn là biên soạn và duyệt dữ liệu).
- **Rủi ro:** nội dung sai gây hại hơn không có gì; không để AI tự thêm dòng mà không ai duyệt. Từ HSK 4–6 nằm trong gói lười nên bước build phải gắn trường vào cả gói.
- **Ca kiểm thử:**
  1. `pnpm data:build` báo lỗi khi một dòng có chữ không tồn tại hoặc thiếu cột.
  2. Vitest: mọi `trap` gắn đúng từ có trong dataset hoặc gói, không ô trống.
  3. Trang từ 困难 hiện chip, rê vào thấy "dễ nhầm với: khốn nạn" và nghĩa thật.
  4. Từ không có trong danh sách không hiện chip, bố cục trang không đổi.
  5. Một bẫy thuộc HSK 5 chỉ hiện sau khi mở khoá HSK 5, và trang không lỗi khi khoá lại.
  6. Chip đọc được ở cả 5 theme, sáng và tối.

### 2.4 Phân biệt cặp thanh (ưu tiên thanh 2 – thanh 3)

- **Giá trị:** thanh 2 và thanh 3 là cặp khó tách nhất; luyện nghe theo cặp chỉ khác thanh (bā bá bǎ bà) nhắm đúng chỗ đó. Trang Thanh điệu hiện có chọn thanh và so đường cao độ nhưng chưa có bài nghe theo cặp [đo, `Tones.svelte`].
- **Bằng chứng:** trung bình. Meta-analysis về cảm nhận thanh tiếng Trung, 18 nghiên cứu, thanh 2 và 3 khó nhất (Cui & Zhao 2025); một nghiên cứu nhỏ trên 44 người học nói tiếng Việt: nhóm học có cử chỉ có hoạt động vỏ não trước trán trái mạnh hơn, và hoạt động đó đi cùng độ chính xác phân biệt biến thanh cao hơn; phần tóm tắt không báo khác biệt hành vi giữa hai nhóm (Cui et al. 2026). Quy tắc biến thanh 3-3, 不, 一 ở [Standard Chinese phonology](https://en.wikipedia.org/wiki/Standard_Chinese_phonology).
- **Thiết kế:** không thêm file dữ liệu. Tạo cặp lúc chạy: nhóm các từ có cùng `searchKey` nhưng khác thanh, ưu tiên cặp khác nhau ở thanh 2/3. Phát một từ, người học chọn từ nào vừa nghe. Đặt thành một phần trong `src/main/pages/Tones.svelte` (hoặc chế độ mới trong `Quiz.svelte` nếu gọn hơn khi làm). Bước sau: hàm thuần `spokenTones(word)` trong `src/lib/pinyin.ts` cho biến thanh 3-3, 不, 一, hiện "đọc thực tế" trên trang từ, có vitest.
- **Công sức:** M.
- **Rủi ro:** cần giọng đọc; máy dev đầu tiên không có giọng zh-CN [đo], nên nhiều người dùng sẽ không có tiếng. Giọng hệ thống đọc chữ đơn có thể sai thanh. Số cặp thật trong HSK 1–3 có thể ít [đoán]; đếm bằng script trước khi làm giao diện.
- **Ca kiểm thử:**
  1. Không có giọng: thẻ chế độ mờ đi và dẫn tới Cài đặt, giống "Nghe chọn chữ"; không có trang trắng.
  2. Có giọng: mỗi câu phát đúng một từ, nút nghe lại chạy.
  3. Ít nhất 6/10 câu là cặp thanh 2 – thanh 3 khi dữ liệu có đủ.
  4. Chọn sai: hiện cả hai từ với pinyin tô màu và nút nghe từng từ.
  5. Vitest `spokenTones`: 你好 → ní hǎo, 不是 → bú shì, 一个 → yí ge, 一天 → yì tiān.
  6. Gói HSK 4–6 đã mở thì cặp được lấy cả từ gói; khoá lại thì không còn từ của gói.

### 2.5 Lượng từ đi kèm danh từ

- **Giá trị:** người học hay nói 个 cho mọi thứ. Thấy lượng từ ngay cạnh danh từ (一本书, 一张纸) giúp học thành cụm.
- **Bằng chứng:** mô tả ngôn ngữ, chưa có thử nghiệm học: [Chinese classifier](https://en.wikipedia.org/wiki/Chinese_classifier) (个 là lượng từ chung; nên học các lượng từ phổ biến theo cụm).
- **Thiết kế:** file tay `data/measure-words.tsv` (`hanzi`, `lượng từ`), khoảng 40 danh từ hay gặp để bắt đầu. Build gắn `Word.mw?: string`, kiểm lượng từ cũng là một từ có trong dữ liệu. Hiện trên `Word.svelte` dạng "一 本 书" và ở mặt sau thẻ ôn. Không đưa lên bong bóng trợ lý (giữ bong bóng gọn).
- **Công sức:** S–M.
- **Rủi ro:** một danh từ có thể dùng nhiều lượng từ; chỉ ghi cái phổ biến nhất và nói rõ "thường dùng".
- **Ca kiểm thử:**
  1. `pnpm data:build` báo lỗi khi lượng từ không có trong dữ liệu.
  2. Trang từ 书 hiện "一本书" với pinyin khi rê chuột.
  3. Danh từ không có trong bảng không hiện dòng trống.
  4. Mặt sau thẻ ôn hiện lượng từ khi có, không làm tràn khung.

### 2.6 Nói đuổi theo câu ví dụ (shadowing)

- **Giá trị:** dùng lại phần ghi âm và đường cao độ đã có, áp cho câu ví dụ thay vì chỉ từ đơn.
- **Bằng chứng:** mỏng. Một nghiên cứu 4 tuần chỉ đo trí nhớ làm việc, không đo kỹ năng tiếng Trung (Takeuchi et al. 2021). Nếu làm, gọi là "gợi ý", không quảng cáo là đã chứng minh.
- **Thiết kế:** trong `Tones.svelte`, thêm lựa chọn luyện câu từ `word.ex`: phát câu, ghi âm, vẽ đường của người học chồng lên đường mẫu bằng `scoreTones` có sẵn. Không chấm điểm từng âm tiết cho câu dài.
- **Công sức:** M.
- **Rủi ro:** cần giọng; câu dài thì đường cao độ khó đọc.
- **Ca kiểm thử:**
  1. Không có giọng: vẫn ghi âm được, trang nói rõ không có tiếng mẫu.
  2. Từ chối quyền micro: hiện câu hướng dẫn hiện có, không treo.
  3. Câu 8–12 chữ vẽ đủ đường, không tràn ngang.

## 3. Đo trước khi làm

Hai việc là công cụ, không phải tính năng, và làm trước mục liên quan:

- **Script đếm cặp thanh** (cho 2.4): đếm số cặp cùng âm khác thanh theo từng cấp HSK. Nếu quá ít thì đổi thiết kế trước khi viết giao diện.
- **Script đối chiếu thanh Hán Việt với thanh phổ thông** (`tools/data/` mới, kết quả vào `.cache/reports/`): đếm trên `data/hanviet/chars.tsv` thanh Hán Việt nào hay đi với thanh nào. Chỉ khi tỉ lệ trùng cao và có người hiểu ngữ âm duyệt thì mới viết gợi ý kiểu "thanh sắc gần thanh 2". Đường nét thanh hai tiếng chỉ giống một phần (ngang 33 khác thanh 1 là 55; thanh tiếng Việt còn dùng chất giọng) [suy luận, từ [Vietnamese phonology](https://en.wikipedia.org/wiki/Vietnamese_phonology) và [Standard Chinese phonology](https://en.wikipedia.org/wiki/Standard_Chinese_phonology)].

## 4. Cố ý không làm

Bớt trước khi thêm: mỗi chế độ mới là thêm một chỗ có thể hỏng và thêm một lựa chọn người học phải nghĩ.

| Không làm | Vì sao |
|---|---|
| Truyện đọc theo cấp (graded reader) | Chưa tìm được bộ văn bản có giấy phép hợp với CC BY-SA. Lý thuyết "input" còn bị tranh cãi ([Input hypothesis](https://en.wikipedia.org/wiki/Input_hypothesis)); lộ trình [Refold](https://refold.la/roadmap) (giai đoạn 0–7 và một phần tuỳ chọn) có bài về sentence mining và học từ bằng Anki, nhưng chỉ mới đọc tên bài nên chưa rõ có dẫn nghiên cứu không [suy luận]. Dùng câu ví dụ sẵn có là đủ. |
| Câu chuyện nhớ chữ, học bộ thủ | Chưa có dữ liệu thành phần chữ có giấy phép; bằng chứng lẫn lộn (mẹo nhớ "có ích nhưng hay mau quên", người học L2 không nhạy với bộ thủ nghĩa: He et al. 2026). |
| Trang ngữ pháp HSK | Chưa có danh sách ngữ pháp có giấy phép; ngoài phạm vi v1 trong PLAN. |
| Nghe chép chính tả | Không có nguồn nào đã mở; phần lớn máy không có giọng zh-CN sẵn. Xem lại khi giọng đọc ổn định. |
| Bảng "thanh Việt = thanh Trung" | Chưa có số đo (mục 3) và chưa có người duyệt; gợi ý sai sẽ dạy sai thanh. |
| Lịch FSRS riêng cho kỹ năng viết | Giữ như PLAN 5.2; viết theo nét chỉ thống kê lỗi. Bằng chứng về viết tay mới ở mức nghiên cứu nhỏ (Cao & Perfetti 2016), không đủ để thêm một hàng thẻ ôn nữa. |
| Huy hiệu, bảng xếp hạng, thông báo nhắc học, phạt khi mất chuỗi | Trái tinh thần không gây áp lực của app. Trợ lý đã có giờ yên lặng và tự tạm dừng. |
| Đưa gõ phím, ghi âm lên bong bóng trợ lý | Bong bóng hợp với nhận mặt chữ và "đoán trước"; việc cần tập trung để ở app chính [suy luận]. |
| Cho người học tự kéo giãn lịch ôn vì "thấy dễ" | Người làm bài kiểm tra thấy kém tự tin hơn nhưng nhớ lâu hơn (Roediger & Karpicke 2006); để FSRS tự hẹn. |
| Hình minh hoạ cho từ | Chi phí giấy phép ảnh cao; pinyin tô màu và nét chữ chạy đã là kênh thứ hai ([Dual-coding theory](https://en.wikipedia.org/wiki/Dual-coding_theory)). |

## 5. Ca kiểm thử chung cho mọi tính năng mới

1. Chạy trong app thật (`pnpm tauri dev`), không chỉ xem build qua.
2. `pnpm check`, `pnpm test`, `pnpm data:build` sạch.
3. Không dùng emoji từ Emoji 13 trở lên (Windows 10 không có); test emoji qua.
4. Cửa sổ chính ở kích thước nhỏ nhất: không cuộn ngang, chữ không bị cắt.
5. Theme sáng và tối đều đọc được.
6. Người dùng mới hoàn toàn (chưa có `progress.json`) mở trang không lỗi và thấy hướng dẫn thay vì trang trống.
7. Từ thuộc cấp HSK đã khoá lại không làm trang nào lỗi.
8. Câu chữ tiếng Việt ngắn, ấm, không ép buộc, không chấm than liên tục.

## 6. Nguồn

Nguồn có đường dẫn ở trên là trang đã đọc khi tổng hợp. Các bài báo ghi theo tên tác giả và năm đã được đọc phần tóm tắt qua Europe PMC. Các nghiên cứu kinh điển chưa mở được (Dunlosky 2013, Nakanishi 2015, Hamada 2016, Wang et al. 1999) không được dùng làm bằng chứng ở đây. Trang [Hacking Chinese](https://hackingchinese.com) chỉ đọc được tiêu đề bài, nên chỉ dùng để biết chủ đề nào người học hay chia sẻ.
