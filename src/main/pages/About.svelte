<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { dataset, words } from '../../lib/data.ts';
  import { isOpen, settings } from '../../lib/settings.svelte.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';

  const SOURCES = [
    { name: 'Nhân vật Tiểu Mai', what: 'Bản vẽ nhân vật do AI tạo riêng cho app', license: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    { name: 'CVDICT', what: 'Nghĩa tiếng Việt', license: 'CC BY-SA 4.0', url: 'https://github.com/ph0ngp/CVDICT' },
    { name: 'CC-CEDICT', what: 'Nền của CVDICT, đối chiếu pinyin', license: 'CC BY-SA 4.0', url: 'https://cc-cedict.org/wiki/' },
    { name: 'complete-hsk-vocabulary', what: 'Danh sách từ HSK 3.0 (bản 2021, cấp new-1…new-6; bản 2025, cấp newest-1…newest-6)', license: 'MIT', url: 'https://github.com/drkameleon/complete-hsk-vocabulary' },
    { name: 'hanviet-pinyin-wordlist', what: 'Âm Hán Việt cho chữ HSK 4–6 (theo cặp chữ và pinyin)', license: 'MIT', url: 'https://github.com/ph0ngp/hanviet-pinyin-wordlist' },
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
  <h1><Icon name="nav-about" hue={HUE_OF.about} /> Giới thiệu</h1>
  <p class="lead">Tiểu Mai (小梅) là ứng dụng mã nguồn mở giúp người Việt học từ vựng tiếng Trung hằng ngày qua một trợ lý trên&nbsp;màn&nbsp;hình.</p>

  <div class="card glass stack">
    <ul class="counts">
      <li><b>{words.filter(isOpen).length}</b> từ</li>
      <li><b>{dataset.topics.length}</b> chủ đề</li>
      <li>HSK 3.0 cấp 1–{settings.hskOpen}, bộ từ bản {settings.hskEdition}</li>
    </ul>
    <div class="muted">Nghĩa ngắn, câu ví dụ, âm Hán Việt và các chủ đề được biên soạn riêng cho app, một phần do AI viết, chưa có người bản ngữ duyệt.</div>
    <ul class="licenses muted">
      <li>Mã nguồn: MIT</li>
      <li>Dữ liệu từ vựng: CC BY-SA 4.0</li>
      <li>Dữ liệu nét chữ: Arphic Public License</li>
      <li>Font: SIL OFL 1.1</li>
      <li>Icon: CC0 1.0</li>
      <li>Nhân vật: CC0 1.0</li>
    </ul>
  </div>

  <h2 class="section-title">Nguồn dữ liệu và thư viện</h2>
  <div class="card glass glass">
    <table>
      <thead><tr><th>Nguồn</th><th>Dùng cho</th><th>Giấy phép</th></tr></thead>
      <tbody>
        {#each SOURCES as s (s.name)}
          <tr>
            <td><button class="link" onclick={() => openUrl(s.url)}>{s.name}</button></td>
            <td>{s.what}</td>
            <td><span class="chip glass-soft glass-press">{s.license}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .logo { display: block; width: 180px; height: 180px; margin: 4px 0 8px; }
  .stack { display: flex; flex-direction: column; gap: 10px; line-height: 1.55; }
  .licenses, .counts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--text-2); font-size: 12.5px; padding: 6px 8px; }
  td { padding: 8px; border-top: 1px solid var(--border); }
  .link { border: 0; background: none; color: var(--primary-ink); font-weight: 800; padding: 0; text-align: left; }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
</style>
