<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { dataset } from '../../lib/data.ts';

  const SOURCES = [
    { name: 'MakeHuman / MPFB2', what: 'Dựng nhân vật trợ lý 3D (tóc, giày, kính, da, biểu cảm), render sẵn thành ảnh', license: 'CC0', url: 'https://static.makehumancommunity.org/assets/assetpacks.html' },
    { name: 'Áo sơ mi “elvs_male_shirt_untucked_bd1” — Elvaerwyn', what: 'Áo của nhân vật (cắt tay ngắn, đổi màu jean)', license: 'CC-BY', url: 'https://static.makehumancommunity.org/assets/assetpacks/shirts02.html' },
    { name: 'Chân váy “mtknife_pleated_mini_skirt” — MTKnife', what: 'Chân váy của nhân vật (đổi màu xám)', license: 'CC-BY', url: 'https://static.makehumancommunity.org/assets/assetpacks/skirts02.html' },
    { name: 'CVDICT', what: 'Nghĩa tiếng Việt', license: 'CC BY-SA 4.0', url: 'https://github.com/ph0ngp/CVDICT' },
    { name: 'CC-CEDICT', what: 'Nền của CVDICT, đối chiếu pinyin', license: 'CC BY-SA 4.0', url: 'https://cc-cedict.org/wiki/' },
    { name: 'complete-hsk-vocabulary', what: 'Danh sách từ HSK 3.0', license: 'MIT', url: 'https://github.com/drkameleon/complete-hsk-vocabulary' },
    { name: 'Make Me a Hanzi / hanzi-writer-data', what: 'Dữ liệu thứ tự nét', license: 'Arphic Public License', url: 'https://github.com/chanind/hanzi-writer-data' },
    { name: 'Hanzi Writer', what: 'Hoạt hình và quiz viết chữ', license: 'MIT', url: 'https://github.com/chanind/hanzi-writer' },
    { name: 'pinyin-pro', what: 'Pinyin theo ngữ cảnh khi rê chuột', license: 'MIT', url: 'https://github.com/zh-lx/pinyin-pro' },
    { name: 'ts-fsrs', what: 'Lịch ôn tập FSRS', license: 'MIT', url: 'https://github.com/open-spaced-repetition/ts-fsrs' },
    { name: 'pitchy', what: 'Đo cao độ giọng nói', license: 'MIT', url: 'https://github.com/ianprime0509/pitchy' },
    { name: 'LXGW WenKai Lite (bản cắt: “TieuMai Kai”)', what: 'Font chữ Hán kiểu Khải', license: 'SIL OFL 1.1', url: 'https://github.com/lxgw/LxgwWenKai-Lite' },
    { name: 'Nunito', what: 'Font giao diện', license: 'SIL OFL 1.1', url: 'https://github.com/googlefonts/nunito' },
    { name: 'Tauri, Svelte', what: 'Nền tảng ứng dụng', license: 'MIT / Apache-2.0', url: 'https://tauri.app' },
  ];
</script>

<div class="page">
  <img class="logo" src="/logo/logo.webp" alt="Tiểu Mai — học tiếng Trung" width="180" height="180" />
  <h1>💌 Giới thiệu</h1>
  <p class="lead">Tiểu Mai (小梅) là app mã nguồn mở, miễn phí, giúp người Việt làm quen từ vựng tiếng Trung mỗi ngày mà không cần “ngồi vào học”.</p>

  <div class="card stack">
    <div><b>{dataset.words.length}</b> từ · <b>{dataset.topics.length}</b> chủ đề · HSK 3.0 cấp 1–3</div>
    <div class="muted">
      Nghĩa ngắn, câu ví dụ, âm Hán Việt và bộ chủ đề được biên soạn riêng cho app (có AI hỗ trợ) và phát hành theo CC BY-SA 4.0.
      Rất mong người bản ngữ góp ý chỗ chưa chuẩn.
    </div>
    <div class="muted">Mã nguồn: MIT. Dữ liệu từ vựng: CC BY-SA 4.0. Dữ liệu nét chữ: Arphic Public License. Font: SIL OFL 1.1.</div>
  </div>

  <h2 class="section-title">Nguồn dữ liệu và thư viện</h2>
  <div class="card">
    <table>
      <thead><tr><th>Nguồn</th><th>Dùng cho</th><th>Giấy phép</th></tr></thead>
      <tbody>
        {#each SOURCES as s (s.name)}
          <tr>
            <td><button class="link" onclick={() => openUrl(s.url)}>{s.name}</button></td>
            <td>{s.what}</td>
            <td><span class="chip">{s.license}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .logo { display: block; width: 180px; height: 180px; margin: 4px 0 8px; }
  .stack { display: flex; flex-direction: column; gap: 10px; line-height: 1.55; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--text-2); font-size: 12.5px; padding: 6px 8px; }
  td { padding: 8px; border-top: 1px solid var(--border); }
  .link { border: 0; background: none; color: var(--primary); font-weight: 800; padding: 0; text-align: left; }
</style>
