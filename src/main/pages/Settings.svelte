<script lang="ts">
  import { onMount } from 'svelte';
  import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { settings, updateSettings, type Settings, type SpeechSettings, type VoiceSlot } from '../../lib/settings.svelte.ts';
  import { chineseSystemVoices, speak, whenVoicesReady, type VoiceInfo } from '../../lib/speech/index.ts';
  import { packInfo } from '../../lib/speech/native.ts';
  import { theme } from '../../lib/theme/apply.svelte.ts';
  import { THEMES, type ThemeId } from '../../lib/theme/themes.ts';

  /** Section to scroll to, e.g. "voice" when opened from the bubble's speaker button. */
  let { section }: { section?: string } = $props();
  let autostart = $state(false);
  let voices = $state<VoiceInfo[]>([]);
  let speechMsg = $state('');
  let packMsg = $state('');

  onMount(async () => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
    autostart = await autostartEnabled().catch(() => false);
    await whenVoicesReady();
    voices = chineseSystemVoices();
  });

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const setSpeech = (patch: Partial<SpeechSettings>) => updateSettings({ speech: { ...settings.speech, ...patch } });
  const setVoice = (slot: VoiceSlot, id: string) => setSpeech({ voices: { ...settings.speech.voices, [slot]: id } });

  async function toggleAutostart(on: boolean) {
    await (on ? enableAutostart() : disableAutostart());
    autostart = await autostartEnabled();
  }
  async function test(slot: VoiceSlot) {
    speechMsg = '';
    try { await speak('你好，我是小梅。', slot); speechMsg = '✓ Đang phát…'; }
    catch (e) { speechMsg = String((e as Error).message ?? e); }
  }
  async function pickPack() {
    const dir = await openDialog({ directory: true, title: 'Chọn thư mục gói giọng' });
    if (typeof dir !== 'string') return;
    try {
      const info = await packInfo(dir);
      setSpeech({ packDir: dir, provider: 'pack' });
      packMsg = `✓ ${info.name} · ${info.license}`;
    } catch (e) { packMsg = String(e); }
  }

  const TOKEN_EDITS = [
    { name: 'primary', label: 'Màu chính' },
    { name: 'accent', label: 'Màu nhấn' },
    { name: 'bg', label: 'Nền' },
    { name: 'bubble-border', label: 'Viền bong bóng' },
  ];
  const currentToken = (name: string) =>
    settings.tokenOverrides[name] ?? (theme.dark ? theme.current.dark : theme.current.light)[name as 'bg'];
  function setToken(name: string, value: string | null) {
    const next = { ...settings.tokenOverrides };
    if (value === null) delete next[name]; else next[name] = value;
    set({ tokenOverrides: next });
  }
</script>

<div class="page">
  <h1>⚙️ Cài đặt</h1>

  <h2 class="section-title">Giao diện</h2>
  <div class="card stack">
    <div class="themes">
      {#each THEMES as t (t.id)}
        <button class="theme" class:on={settings.theme === t.id} onclick={() => set({ theme: t.id as ThemeId })}
          style:background={(theme.dark ? t.dark : t.light).bg} style:color={(theme.dark ? t.dark : t.light).text}
          style:border-color={(theme.dark ? t.dark : t.light).primary}>
          <span class="ti">{t.icon}</span>{t.name}
          <span class="sw" style:background={(theme.dark ? t.dark : t.light).primary}></span>
        </button>
      {/each}
    </div>
    <div class="row">
      <span class="lbl">Chế độ</span>
      {#each [['system', 'Theo hệ thống'], ['light', '☀️ Sáng'], ['dark', '🌙 Tối']] as [v, label] (v)}
        <button class="chip" class:on={settings.mode === v} onclick={() => set({ mode: v as Settings['mode'] })}>{label}</button>
      {/each}
    </div>
    <div class="row wrap">
      <span class="lbl">Tự chỉnh màu</span>
      {#each TOKEN_EDITS as tk (tk.name)}
        <label class="color">
          <input type="color" value={currentToken(tk.name)} oninput={(e) => setToken(tk.name, e.currentTarget.value)} />{tk.label}
        </label>
      {/each}
      {#if Object.keys(settings.tokenOverrides).length}<button class="btn ghost" onclick={() => set({ tokenOverrides: {} })}>Về mặc định</button>{/if}
    </div>
    <details>
      <summary>CSS riêng (tuỳ biến mọi thành phần)</summary>
      <textarea rows="6" placeholder={'.bubble { border-radius: 4px; }\n:root { --font-ui: "Comic Sans MS"; }'} value={settings.customCss}
        onchange={(e) => set({ customCss: e.currentTarget.value })}></textarea>
      <p class="muted small">Áp dụng cho cả app chính và bong bóng của Tiểu Mai. Biến màu: --primary, --accent, --bg, --surface, --text, --bubble-bg, --tone1…--tone5.</p>
    </details>
  </div>

  <h2 class="section-title">Trợ lý Tiểu Mai</h2>
  <div class="card stack">
    <label class="row"><input type="checkbox" checked={settings.petEnabled} onchange={(e) => set({ petEnabled: e.currentTarget.checked })} /> Hiện trợ lý trên màn hình</label>
    <label class="row"><input type="checkbox" checked={!settings.petCharacter} onchange={(e) => set({ petCharacter: !e.currentTarget.checked })} /> Ẩn nhân vật Tiểu Mai, chỉ giữ bảng từ vựng (gọn màn hình hơn; kéo bảng bằng dòng chủ đề phía trên)</label>
    <div class="row">
      <span class="lbl">Kích thước</span>
      {#each [2, 3, 4] as s (s)}<button class="chip" class:on={settings.petScale === s} onclick={() => set({ petScale: s })}>{['Nhỏ', 'Vừa', 'Lớn'][s - 2]}</button>{/each}
    </div>
    <label class="row"><span class="lbl">Mỗi từ hiện trong</span>
      <input type="range" min="8" max="60" value={settings.wordSec} oninput={(e) => set({ wordSec: +e.currentTarget.value })} />
      <b>{settings.wordSec} giây</b></label>
    <label class="row"><input type="checkbox" checked={settings.guessFirst} onchange={(e) => set({ guessFirst: e.currentTarget.checked })} /> Với từ đã gặp: hiện chữ trước, vài giây sau mới hiện nghĩa (để tự đoán)</label>
    <label class="row"><input type="checkbox" checked={settings.showHanviet} onchange={(e) => set({ showHanviet: e.currentTarget.checked })} /> Hiện âm Hán Việt</label>
    <label class="row"><input type="checkbox" checked={settings.showExample} onchange={(e) => set({ showExample: e.currentTarget.checked })} /> Hiện câu ví dụ trong bong bóng</label>
    <label class="row"><input type="checkbox" checked={settings.hideOnFullscreen} onchange={(e) => set({ hideOnFullscreen: e.currentTarget.checked })} /> Ẩn khi có ứng dụng toàn màn hình (xem phim, chơi game, trình chiếu)</label>
    <label class="row"><span class="lbl">Ngủ khi không dùng máy sau</span>
      <select value={settings.idlePauseMin} onchange={(e) => set({ idlePauseMin: +e.currentTarget.value })}>
        {#each [0, 1, 3, 5, 10, 30] as m (m)}<option value={m}>{m ? `${m} phút` : 'Không bao giờ'}</option>{/each}
      </select></label>
    <div class="row wrap">
      <label class="row"><input type="checkbox" checked={settings.quietEnabled} onchange={(e) => set({ quietEnabled: e.currentTarget.checked })} /> Giờ yên lặng từ</label>
      <input type="time" value={settings.quietFrom} onchange={(e) => set({ quietFrom: e.currentTarget.value })} /> đến
      <input type="time" value={settings.quietTo} onchange={(e) => set({ quietTo: e.currentTarget.value })} />
    </div>
    <p class="muted small">Chọn chủ đề và cấp HSK để Tiểu Mai nhắc ở trang <a href="#/topics">Chủ đề</a> (nút 🔔).</p>
  </div>

  <h2 class="section-title" id="voice">Giọng đọc (tuỳ chọn)</h2>
  <div class="card stack">
    <p class="muted small">App không kèm sẵn giọng đọc để nhẹ. Bạn có thể dùng giọng của hệ điều hành, một API giọng đọc (online hoặc server chạy trên máy), hoặc một gói giọng tải về.</p>
    <div class="row wrap">
      <span class="lbl">Nguồn</span>
      {#each [['none', 'Tắt'], ['system', 'Giọng hệ thống'], ['http', 'API giọng đọc'], ['pack', 'Gói giọng']] as [v, label] (v)}
        <button class="chip" class:on={settings.speech.provider === v} onclick={() => setSpeech({ provider: v as SpeechSettings['provider'] })}>{label}</button>
      {/each}
    </div>

    {#if settings.speech.provider === 'system'}
      {#if voices.length}
        {#each [['female', 'Giọng nữ'], ['male', 'Giọng nam']] as [slot, label] (slot)}
          <label class="row"><span class="lbl">{label}</span>
            <select value={settings.speech.voices[slot as VoiceSlot]} onchange={(e) => setVoice(slot as VoiceSlot, e.currentTarget.value)}>
              <option value="">Tự chọn</option>
              {#each voices as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
            </select>
            <button class="btn" onclick={() => test(slot as VoiceSlot)}>▶ Thử</button></label>
        {/each}
      {:else}
        <div class="hint">
          Máy chưa có giọng tiếng Trung. Trên Windows: <b>Cài đặt → Thời gian & ngôn ngữ → Giọng nói → Thêm giọng nói</b>, chọn
          “Chinese (Simplified, China)” (Huihui nữ, Kangkang nam), rồi mở lại trang này. macOS: Cài đặt hệ thống → Trợ năng → Nội dung được đọc.
        </div>
      {/if}
    {:else if settings.speech.provider === 'http'}
      <div class="row wrap">
        <span class="lbl">Kiểu API</span>
        {#each [['openai', 'OpenAI-compatible'], ['azure', 'Azure Speech'], ['custom', 'URL tuỳ chỉnh']] as [v, label] (v)}
          <button class="chip" class:on={settings.speech.http.preset === v} onclick={() => setSpeech({ http: { ...settings.speech.http, preset: v as 'openai' } })}>{label}</button>
        {/each}
      </div>
      {#if settings.speech.http.preset !== 'azure'}
        <label class="row"><span class="lbl">URL</span><input class="grow" type="url" value={settings.speech.http.url}
          onchange={(e) => setSpeech({ http: { ...settings.speech.http, url: e.currentTarget.value } })} /></label>
      {:else}
        <label class="row"><span class="lbl">Region</span><input type="text" placeholder="eastasia" value={settings.speech.http.region}
          onchange={(e) => setSpeech({ http: { ...settings.speech.http, region: e.currentTarget.value } })} /></label>
      {/if}
      {#if settings.speech.http.preset === 'openai'}
        <label class="row"><span class="lbl">Model</span><input type="text" value={settings.speech.http.model}
          onchange={(e) => setSpeech({ http: { ...settings.speech.http, model: e.currentTarget.value } })} /></label>
      {/if}
      {#if settings.speech.http.preset !== 'custom'}
        <label class="row"><span class="lbl">API key</span><input class="grow" type="password" value={settings.speech.http.apiKey}
          onchange={(e) => setSpeech({ http: { ...settings.speech.http, apiKey: e.currentTarget.value } })} /></label>
      {/if}
      {#each [['female', 'Giọng nữ'], ['male', 'Giọng nam']] as [slot, label] (slot)}
        <label class="row"><span class="lbl">{label}</span>
          <input type="text" placeholder={settings.speech.http.preset === 'azure' ? (slot === 'female' ? 'zh-CN-XiaoyiNeural' : 'zh-CN-YunjianNeural') : slot === 'female' ? 'zf_xiaoyi' : 'zm_yunjian'}
            value={settings.speech.voices[slot as VoiceSlot]} onchange={(e) => setVoice(slot as VoiceSlot, e.currentTarget.value)} />
          <button class="btn" onclick={() => test(slot as VoiceSlot)}>▶ Thử</button></label>
      {/each}
      <p class="muted small">
        {#if settings.speech.http.preset === 'custom'}URL dạng GET trả về file âm thanh; dùng {'{text}'} và {'{voice}'} làm chỗ điền.
        {:else if settings.speech.http.preset === 'openai'}Chạy giọng offline trên máy: ví dụ server Kokoro-FastAPI ở http://localhost:8880/v1/audio/speech (giọng zf_xiaoyi, zm_yunjian…).
        {:else}Dùng key của dịch vụ Azure AI Speech của bạn. API key lưu trong máy (settings.json).{/if}
        Mỗi câu chỉ gọi API một lần rồi lưu cache.
      </p>
    {:else if settings.speech.provider === 'pack'}
      <div class="row wrap">
        <button class="btn" onclick={pickPack}>📁 Chọn thư mục gói giọng…</button>
        <span class="muted small">{settings.speech.packDir || 'Chưa chọn'}</span>
      </div>
      {#if packMsg}<p class="small">{packMsg}</p>{/if}
      <div class="row">
        <button class="btn" onclick={() => test('female')}>▶ Thử giọng nữ</button>
        <button class="btn" onclick={() => test('male')}>▶ Thử giọng nam</button>
      </div>
      <p class="muted small">Gói giọng là thư mục có manifest.json và các file MP3 đặt tên theo chữ Hán. Có thể tự tạo bằng tools/voicepack (sherpa-onnx + Kokoro, giấy phép Apache-2.0).</p>
    {/if}

    {#if settings.speech.provider !== 'none'}
      <div class="row wrap">
        <span class="lbl">Giọng mặc định</span>
        <button class="chip" class:on={settings.speech.slot === 'female'} onclick={() => setSpeech({ slot: 'female' })}>👩 Nữ dễ thương</button>
        <button class="chip" class:on={settings.speech.slot === 'male'} onclick={() => setSpeech({ slot: 'male' })}>👨 Nam trầm ấm</button>
      </div>
      <label class="row"><span class="lbl">Tốc độ</span>
        <input type="range" min="0.6" max="1.3" step="0.05" value={settings.speech.rate} oninput={(e) => setSpeech({ rate: +e.currentTarget.value })} />
        <b>{settings.speech.rate.toFixed(2)}×</b></label>
      <label class="row"><input type="checkbox" checked={settings.speech.autoplayInPet} onchange={(e) => setSpeech({ autoplayInPet: e.currentTarget.checked })} /> Tiểu Mai tự đọc mỗi từ mới</label>
      {#if speechMsg}<p class="small">{speechMsg}</p>{/if}
    {/if}
  </div>

  <h2 class="section-title">Khởi động</h2>
  <div class="card stack">
    <label class="row"><input type="checkbox" checked={autostart} onchange={(e) => toggleAutostart(e.currentTarget.checked)} /> Mở Tiểu Mai cùng máy tính (chỉ hiện trợ lý, không mở cửa sổ này)</label>
    <p class="muted small">Đóng cửa sổ này thì Tiểu Mai vẫn chạy ngầm ở khay hệ thống. Muốn thoát hẳn: chuột phải icon ở khay → Thoát.</p>
  </div>
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .lbl { font-weight: 800; min-width: 150px; }
  .wrap { flex-wrap: wrap; }
  .grow { flex: 1; }
  .small { font-size: 12.5px; margin: 0; }
  .themes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  .theme { border: 2.5px solid; border-radius: 16px; padding: 14px 10px; font-weight: 800; display: flex; flex-direction: column; align-items: center; gap: 6px; opacity: .8; }
  .theme.on { opacity: 1; box-shadow: var(--shadow); transform: translateY(-2px); }
  .ti { font-size: 26px; }
  .sw { width: 40px; height: 6px; border-radius: 99px; }
  .color { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
  .color input { width: 34px; height: 26px; border: 0; padding: 0; background: none; }
  textarea { width: 100%; font-family: Consolas, monospace; font-size: 13px; margin-top: 8px; }
  summary { cursor: pointer; font-weight: 800; }
  .hint { background: var(--surface-2); border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.5; }
</style>
