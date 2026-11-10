<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import Range from '../../lib/ui/Range.svelte';
  import Switch from '../../lib/ui/Switch.svelte';
  import Select from '../../lib/ui/Select.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { onMount } from 'svelte';
  import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { setHskOpen, settings, updateSettings, type Settings, type SpeechSettings, type VoiceSlot } from '../../lib/settings.svelte.ts';
  import { autoVoice, chineseSystemVoices, speak, whenVoicesReady, type VoiceInfo } from '../../lib/speech/index.ts';
  import { packInfo } from '../../lib/speech/native.ts';
  import { theme } from '../../lib/theme/apply.svelte.ts';
  import { HSK_HUE } from '../../lib/data.ts';
  import { HUE_OF, THEMES, type ThemeId } from '../../lib/theme/themes.ts';

  /** Section to scroll to, e.g. "voice" when opened from the bubble's speaker button. */
  let { section }: { section?: string } = $props();
  let autostart = $state(false);
  let voices = $state<VoiceInfo[]>([]);
  let speechMsg = $state('');
  let packMsg = $state('');
  /** Level whose pack is loading; 0 when idle. */
  let hskLoading = $state(0);
  let hskFailed = $state(false);

  onMount(async () => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
    autostart = await autostartEnabled().catch(() => false);
    await whenVoicesReady();
    voices = chineseSystemVoices();
  });

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const setSpeech = (patch: Partial<SpeechSettings>) => updateSettings({ speech: { ...settings.speech, ...patch } });
  const setVoice = (slot: VoiceSlot, id: string) => setSpeech({ voices: { ...settings.speech.voices, [slot]: id } });

  async function openHsk(level: number) {
    hskLoading = level;
    hskFailed = false;
    try { await setHskOpen(level); } catch (e) { console.error(e); hskFailed = true; } finally { hskLoading = 0; }
  }
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

  /** The fields' and the selected swatch's bezel no deeper than their 4px nested corner: deeper, the bezel folds into
   *  bright diagonal seams at the corners. */
  const NESTED_BEZEL = 4;

  const TOKEN_EDITS = [
    { name: 'primary', label: 'Màu chính' },
    { name: 'accent', label: 'Màu nhấn' },
    { name: 'bg', label: 'Nền' },
    { name: 'bubble-border', label: 'Viền bong bóng' },
  ];
  /** Colour edits apply to the look on screen now: light and dark keep their own. */
  const look = $derived(theme.dark ? 'dark' : 'light');
  const currentToken = (name: string) =>
    settings.tokenOverrides[look][name] ?? (theme.dark ? theme.current.dark : theme.current.light)[name as 'bg'];
  function setToken(name: string, value: string | null) {
    const next = { ...settings.tokenOverrides[look] };
    if (value === null) delete next[name]; else next[name] = value;
    set({ tokenOverrides: { ...settings.tokenOverrides, [look]: next } });
  }
  const COLOR_VARS = ['--primary', '--accent', '--bg', '--surface', '--text', '--bubble-bg', '--tone1…--tone5'];
  const HUE_VARS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'].map((h) => `--hue-${h}`);
</script>

<div class="page">
  <h1><Icon name="nav-settings" /> Cài đặt</h1>

  <h2 class="section-title"><Icon name="brush" hue="orange" /> Giao diện</h2>
  <div class="card glass stack">
    <div class="themes">
      {#each THEMES as t (t.id)}
        <!-- A swatch keeps its own theme's colours; the selected one is refracting glass over the card. -->
        <button class="theme glass glass-press glass-arc" class:on={settings.theme === t.id} use:glass={{ when: settings.theme === t.id, bezel: NESTED_BEZEL }} onclick={() => set({ theme: t.id as ThemeId })}
          style:background="color-mix(in srgb, {(theme.dark ? t.dark : t.light).bg} 64%, transparent)" style:color={(theme.dark ? t.dark : t.light).text}
          style:--sw={(theme.dark ? t.dark : t.light).primary}>
          <span class="ti"><Icon name={t.icon} /></span><span class="tn">{t.name}</span>
          <span class="sw" style:background={(theme.dark ? t.dark : t.light).primary}></span>
        </button>
      {/each}
    </div>
    <div class="row">
      <span class="lbl">Chế độ</span>
      {#each [['system', 'Theo hệ thống'], ['light', 'Sáng'], ['dark', 'Tối']] as const as [v, label] (v)}
        <button class="chip glass glass-press" class:on={settings.mode === v} use:glass={{ when: !(settings.mode === v) }} onclick={() => set({ mode: v as Settings['mode'] })}>{label}</button>
      {/each}
    </div>
    <div class="row top">
      <span class="lbl">Tự chỉnh màu</span>
      <div class="pairs colors">
        {#each TOKEN_EDITS as tk (tk.name)}
          <label class="color">
            <input type="color" class="glass-rim glass-press glass-focus" value={currentToken(tk.name)} oninput={(e) => setToken(tk.name, e.currentTarget.value)} />{tk.label}
          </label>
        {/each}
        {#if Object.keys(settings.tokenOverrides[look]).length}<button use:glass class="btn glass glass-press ghost" onclick={() => set({ tokenOverrides: { ...settings.tokenOverrides, [look]: {} } })}>Về mặc định</button>{/if}
      </div>
    </div>
    <p class="muted small">Màu tự chỉnh chỉ áp dụng cho chế độ {look === 'dark' ? 'tối' : 'sáng'}.</p>
    <details>
      <summary class="glass-row">CSS riêng (tuỳ biến mọi thành phần)</summary>
      <textarea class="glass" use:glass={{ bezel: NESTED_BEZEL }} rows="6" placeholder={'.bubble { border-radius: 4px; }\n:root { --font-ui: "Comic Sans MS"; }'} value={settings.customCss}
        onchange={(e) => set({ customCss: e.currentTarget.value })}></textarea>
      <p class="muted small">Áp dụng cho cả app chính và bong bóng của Tiểu Mai.<br />Biến màu: {#each COLOR_VARS as v, i (v)}<span class="var">{v}</span>{i < COLOR_VARS.length - 1 ? ', ' : '.'}{/each}<br />Màu phân loại: {#each HUE_VARS as v, i (v)}<span class="var">{v}</span>{i < HUE_VARS.length - 1 ? ', ' : '.'}{/each}</p>
    </details>
  </div>

  <h2 class="section-title"><Icon name="pet-show-character" hue="teal" /> Bảng gợi ý và trợ lý</h2>
  <div class="card glass stack">
    <label class="row"><Switch checked={settings.petEnabled} onchange={(on) => set({ petEnabled: on })} /> Hiện bảng gợi ý trên màn hình</label>
    <!-- The character lives on the panel: without the panel the switch is disabled and keeps its value. -->
    <label class="row" class:off={!settings.petEnabled}><Switch checked={settings.petCharacter} disabled={!settings.petEnabled} onchange={(on) => set({ petCharacter: on })} /> Hiện trợ lý</label>
    <div class="row">
      <span class="lbl">Kích thước</span>
      {#each [2, 3, 4] as s (s)}<button class="chip glass glass-press" class:on={settings.petScale === s} use:glass={{ when: !(settings.petScale === s) }} onclick={() => set({ petScale: s })}>{['Nhỏ', 'Vừa', 'Lớn'][s - 2]}</button>{/each}
    </div>
    <label class="row"><span class="lbl">Mỗi từ hiện trong</span>
      <Range min={8} max={60} value={settings.wordSec} oninput={(v) => set({ wordSec: v })} />
      <b>{settings.wordSec} giây</b></label>
    <label class="row"><Switch checked={settings.guessFirst} onchange={(on) => set({ guessFirst: on })} /> Với từ đã gặp: hiện chữ trước, vài giây sau mới hiện nghĩa (để tự đoán)</label>
    <label class="row"><Switch checked={settings.showHanviet} onchange={(on) => set({ showHanviet: on })} /> Hiện âm Hán Việt</label>
    <label class="row"><Switch checked={settings.showExample} onchange={(on) => set({ showExample: on })} /> Hiện câu ví dụ trong bong bóng</label>
    <label class="row"><Switch checked={settings.hideOnFullscreen} onchange={(on) => set({ hideOnFullscreen: on })} /> Ẩn khi có ứng dụng toàn màn hình (xem phim, chơi game, trình chiếu)</label>
    <div class="row fields"><span class="lbl">Ngủ khi máy rảnh</span>
      <Select label="Ngủ khi máy rảnh" value={settings.idlePauseMin} options={[0, 1, 3, 5, 10, 30].map((m) => ({ value: m, label: m ? `${m} phút` : 'Không bao giờ' }))} onchange={(v) => set({ idlePauseMin: v })} /></div>
    <div class="row wrap fields">
      <label class="row lbl"><Switch checked={settings.quietEnabled} onchange={(on) => set({ quietEnabled: on })} /> Giờ yên lặng từ</label>
      <input class="glass" use:glass={{ bezel: NESTED_BEZEL }} type="time" value={settings.quietFrom} onchange={(e) => set({ quietFrom: e.currentTarget.value })} /> đến
      <input class="glass" use:glass={{ bezel: NESTED_BEZEL }} type="time" value={settings.quietTo} onchange={(e) => set({ quietTo: e.currentTarget.value })} />
    </div>
    <p class="muted small">Chọn chủ đề và cấp HSK để Tiểu Mai nhắc ở trang <a href="#/topics">Chủ đề</a> (nút <Icon name="bell" />).</p>
  </div>

  <h2 class="section-title" id="hsk"><Icon name="course" hue={HSK_HUE} /> Khoá học HSK</h2>
  <div class="card glass stack">
    <div class="row wrap">
      <span class="lbl">Đang mở</span>
      {#each [3, 4, 5, 6] as n (n)}
        <button class="chip glass glass-press" class:on={settings.hskOpen === n} use:glass={{ when: !(settings.hskOpen === n) }} disabled={!!hskLoading} onclick={() => openHsk(n)}>HSK 1–{n}</button>
      {/each}
      {#if hskLoading}<span class="muted small">Đang tải HSK {hskLoading}…</span>{/if}
    </div>
    <div class="row wrap">
      <span class="lbl">Bộ từ</span>
      {#each [2025, 2021] as const as e (e)}
        <button class="chip glass glass-press" class:on={settings.hskEdition === e} use:glass={{ when: !(settings.hskEdition === e) }} onclick={() => set({ hskEdition: e })}>Bản {e}</button>
      {/each}
    </div>
    <p class="muted small">
      Bản 2025: danh sách chính, theo đề cương của kỳ thi HSK mới.<br />
      Bản 2021: dành cho người học theo giáo trình cũ.<br />
      Bảng gợi ý và các khoá HSK dùng bản đang chọn.<br />
      Ôn tập, sổ tay và tra cứu giữ từ của cả hai bản.
    </p>
    <p class="muted small">
      Chọn mức thấp hơn thì từ của các cấp cao hơn tạm ẩn ở mọi trang, kể cả ôn tập và sổ tay.<br />
      Bảng gợi ý ngừng nhắc các cấp đó.<br />
      Từ trong chủ đề vẫn hiện đủ, kể cả từ thuộc cấp cao hơn.<br />
      Tiến độ ôn tập vẫn được giữ.
    </p>
    {#if hskFailed}<p class="small bad">Không mở khoá được. Hãy thử lại.</p>{/if}
  </div>

  <h2 class="section-title" id="voice"><Icon name="speaker" hue={HUE_OF.listen} /> Giọng đọc (tuỳ chọn)</h2>
  <div class="card glass stack">
    <div class="row top">
      <span class="lbl">Nguồn</span>
      <div class="pairs">
        {#each [['none', 'Tắt'], ['system', 'Giọng hệ thống'], ['http', 'API giọng đọc'], ['pack', 'Gói giọng']] as [v, label] (v)}
          <button class="chip glass glass-press" class:on={settings.speech.provider === v} use:glass={{ when: !(settings.speech.provider === v) }} onclick={() => setSpeech({ provider: v as SpeechSettings['provider'] })}>{label}</button>
        {/each}
      </div>
    </div>
    <p class="muted small">App không kèm sẵn giọng đọc.<br />Nguồn có thể dùng: giọng của hệ điều hành, API giọng đọc (online hoặc server chạy trên máy), hoặc gói giọng tải về.</p>

    {#snippet installHint(missing: string)}
      <div class="hint">
        {missing}<br />
        Windows: <b>Cài đặt → Thời gian & ngôn ngữ → Giọng nói → Thêm giọng nói</b>, chọn “Chinese (Simplified, China)” (giọng nữ Huihui, giọng nam Kangkang).<br />
        macOS: <b>Cài đặt hệ thống → Trợ năng → Nội dung được đọc</b>.<br />
        Cài xong thì mở lại trang này.
      </div>
    {/snippet}
    {#if settings.speech.provider === 'system'}
      {#if voices.length}
        {#each [['female', 'Giọng nữ', 'nữ'], ['male', 'Giọng nam', 'nam']] as [slot, label, gender] (slot)}
          <div class="row"><span class="lbl">{label}</span>
            <Select label={label} value={settings.speech.voices[slot as VoiceSlot] ?? ''} options={[{ value: '', label: 'Tự chọn' }, ...voices.map((v) => ({ value: v.id, label: v.label }))]} onchange={(v) => setVoice(slot as VoiceSlot, v)} />
            <button use:glass class="btn glass glass-press" onclick={() => test(slot as VoiceSlot)}><Icon name="play" /> Thử</button></div>
          {#if !settings.speech.voices[slot as VoiceSlot] && !autoVoice(voices, slot as VoiceSlot)}
            {@render installHint(`Máy chưa có giọng ${gender} tiếng Trung, đang đọc bằng ${voices[0].name}.`)}
          {/if}
        {/each}
      {:else}
        {@render installHint('Máy chưa có giọng tiếng Trung.')}
      {/if}
    {:else if settings.speech.provider === 'http'}
      <div class="row wrap">
        <span class="lbl">Kiểu API</span>
        {#each [['openai', 'OpenAI-compatible'], ['azure', 'Azure Speech'], ['custom', 'URL tuỳ chỉnh']] as [v, label] (v)}
          <button class="chip glass glass-press" class:on={settings.speech.http.preset === v} use:glass={{ when: !(settings.speech.http.preset === v) }} onclick={() => setSpeech({ http: { ...settings.speech.http, preset: v as 'openai' } })}>{label}</button>
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
          <button use:glass class="btn glass glass-press" onclick={() => test(slot as VoiceSlot)}><Icon name="play" /> Thử</button></label>
      {/each}
      <p class="muted small">
        {#if settings.speech.http.preset === 'custom'}URL dạng GET trả về file âm thanh; dùng {'{text}'} và {'{voice}'} làm chỗ điền.
        {:else if settings.speech.http.preset === 'openai'}Chạy giọng offline trên máy: ví dụ server Kokoro-FastAPI ở http://localhost:8880/v1/audio/speech (giọng zf_xiaoyi, zm_yunjian…).
        {:else}Dùng key của dịch vụ Azure AI Speech của bạn.<br />API key chỉ lưu trên máy này.{/if}
      </p>
    {:else if settings.speech.provider === 'pack'}
      <div class="row wrap">
        <button use:glass class="btn glass glass-press" onclick={pickPack}><Icon name="folder" /> Chọn thư mục gói giọng…</button>
        <span class="muted small">{settings.speech.packDir || 'Chưa chọn'}</span>
      </div>
      {#if packMsg}<p class="small">{packMsg}</p>{/if}
      <div class="row">
        <button use:glass class="btn glass glass-press" onclick={() => test('female')}><Icon name="play" /> Thử giọng nữ</button>
        <button use:glass class="btn glass glass-press" onclick={() => test('male')}><Icon name="play" /> Thử giọng nam</button>
      </div>
      <p class="muted small">Gói giọng là thư mục có manifest.json và các file MP3 đặt tên theo chữ Hán.<br />Có thể tự tạo bằng tools/voicepack (sherpa-onnx + Kokoro, giấy phép Apache-2.0).</p>
    {/if}

    {#if settings.speech.provider !== 'none'}
      <div class="row wrap">
        <span class="lbl">Giọng mặc định</span>
        <button class="chip glass glass-press" class:on={settings.speech.slot === 'female'} use:glass={{ when: !(settings.speech.slot === 'female') }} onclick={() => setSpeech({ slot: 'female' })}><Icon name="voice-female" /> Giọng nữ</button>
        <button class="chip glass glass-press" class:on={settings.speech.slot === 'male'} use:glass={{ when: !(settings.speech.slot === 'male') }} onclick={() => setSpeech({ slot: 'male' })}><Icon name="voice-male" /> Giọng nam</button>
      </div>
      <label class="row"><span class="lbl">Tốc độ</span>
        <Range min={0.6} max={1.3} step={0.05} value={settings.speech.rate} oninput={(v) => setSpeech({ rate: v })} />
        <b>{settings.speech.rate.toFixed(2)}×</b></label>
      <label class="row"><Switch checked={settings.speech.autoplayInPet} onchange={(on) => setSpeech({ autoplayInPet: on })} /> Tiểu Mai tự đọc mỗi từ mới</label>
      {#if speechMsg}<p class="small">{speechMsg}</p>{/if}
    {/if}
  </div>

  <h2 class="section-title"><Icon name="play" hue="green" /> Khởi động</h2>
  <div class="card glass stack">
    <label class="row"><Switch checked={autostart} onchange={(on) => toggleAutostart(on)} /> Mở Tiểu Mai cùng máy tính</label>
    <p class="muted small">Khi mở cùng máy tính, chỉ hiện bảng gợi ý, không mở cửa sổ chính.<br />Đóng cửa sổ này thì Tiểu Mai vẫn chạy ngầm ở khay hệ thống.<br />Muốn thoát hẳn: chuột phải icon ở khay → Thoát.</p>
  </div>
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  /* The idle select and the quiet-hours fields share one width, so their right edges line up in the control column. */
  .fields :global(.select-trigger), .fields input[type='time'] { min-width: 152px; }
  /* One label column, so every control on a card starts at the same x; a long label wraps inside it. */
  .lbl { font-weight: 800; flex: 0 0 172px; text-wrap: balance; }
  /* A wrapping row keeps its controls in the control column: the row is indented by the label column and the label
     sits in that indent, so a wrapped chip starts under the first chip, not under the label. */
  .row.wrap:has(> .lbl:first-child) { padding-left: 182px; }
  .row.wrap > .lbl:first-child { margin-left: -182px; }
  /* Wide windows: a wider label column. */
  @media (min-width: 1100px) { .lbl { flex-basis: 220px; } .row.wrap:has(> .lbl:first-child) { padding-left: 230px; } .row.wrap > .lbl:first-child { margin-left: -230px; } }
  .wrap { flex-wrap: wrap; }
  .grow { flex: 1; }
  .small { font-size: 12.5px; margin: 0; }
  .themes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  /* Theme swatches keep their own theme's colours (inline styles), so they are not glass; only the rim and lift match. */
  /* Unselected: the border at half strength. Selected: full border plus a 3px ring in its own hue, in every glass mode, without moving. */
  /* Corners nested in the card's (card radius less its 20px padding, 4px at least): the swatches and the rounded-rect
     fields on the cards; pill chips stay round. Outline focus rings follow the radius, so they stay concentric. */
  .page { --nested-r: max(4px, calc(var(--radius) - 20px)); }
  .page :global(:is(.select-trigger, input[type='time'], input[type='text'], input[type='color'], textarea)) { border-radius: var(--nested-r); }
  /* The selected ring stays concentric. */
  .theme { --sw-r: var(--nested-r); position: relative; border: 2.5px solid color-mix(in srgb, var(--sw) 45%, transparent); border-radius: var(--sw-r); padding: 14px 10px; font-weight: 800; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  /* The selected ring is its own layer, 2px out and 3px wide, pulled toward the text colour to reach 3:1 on the page
     (Hoa anh đào's pink was 2.6:1). */
  .theme.on { border-color: var(--sw); --glass-shadow: var(--shadow); }
  .theme.on::after { content: ''; position: absolute; inset: -7.5px; border: 3px solid color-mix(in srgb, var(--sw) 70%, var(--text)); border-radius: calc(var(--sw-r) + 7.5px); pointer-events: none; }
  .theme { --arc-r: calc(var(--sw-r) - 2.5px); --arc-tint: var(--sw); }
  .theme.on, .theme.on:hover, .theme.on:active { transform: none; }
  /* It does not move (its ring would shift), so its press is the inner shadow alone. */
  .theme.on:active { --glass-shadow: inset 0 2px 5px rgb(var(--glass-black) / .22), 0 1px 1px rgb(var(--glass-black) / .08); }
  /* Two lines reserved for every name, so a one-line name sits level with "Hoa anh đào". */
  .tn { min-height: 2.6em; line-height: 1.3; display: flex; align-items: center; text-align: center; }
  /* At 860 px a swatch is 102 px wide: a smaller label keeps "Hoa anh đào" on one line like the others. */
  @media (max-width: 1000px) { .tn { font-size: 12.5px; } .theme { padding-inline: 6px; } }
  /* Disabled rows: the label greys with the switch (200 ms). */
  .row.off { color: var(--text-2); transition: color .2s ease; }
  @media (prefers-reduced-motion: reduce) { .row.off { transition: none; } }
  /* The colour bar sits at the bottom of every swatch, whether its name takes one line or two. */
  .theme .sw { margin-top: auto; }
  .theme:focus-visible { outline: 2px solid var(--primary-ink); outline-offset: 2px; }
  /* The selected swatch's ring holds the space outside it, so its focus ring goes inside the border: in the selection
     ring's place it was only a swap between two shades of the same colour. */
  .theme.on:focus-visible { outline-offset: -7px; }
  .ti { font-size: 26px; }
  .sw { width: 40px; height: 6px; border-radius: 99px; }
  .top { align-items: flex-start; }
  .top .lbl { padding-top: 4px; }
  /* The colour items and the voice sources wrap inside their own column, never under the row label. */
  .pairs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; flex: 1; min-width: 0; }
  .color { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
  /* Between pairs at least three times the gap inside one, so each label reads with its own swatch. */
  .pairs.colors { column-gap: 20px; }
  /* Four items in a column of about 370px: three fit, the fourth would sit alone on a second line. */
  @media (max-width: 1099px) {
    .pairs { display: grid; grid-template-columns: repeat(2, max-content); justify-items: start; }
    .pairs > .ghost { grid-column: 1 / -1; }
  }
  /* A variable name never breaks at its hyphens: the list wraps only after a comma. */
  .var { white-space: nowrap; }
  /* 12px under it: the focus ring (2px out, 2px wide) plus the usual 8px gap before the help text. */
  textarea { width: 100%; font-family: Consolas, monospace; font-size: 13px; margin-top: 8px; margin-bottom: 12px; }
  summary { cursor: pointer; font-weight: 800; padding: 6px 8px; margin-inline: -8px; border-radius: max(4px, calc(var(--radius) - 12px)); }
  .hint { background: color-mix(in srgb, var(--surface-2) 70%, transparent); border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.5; outline: 1px solid color-mix(in srgb, var(--border) 70%, transparent); outline-offset: -1px; }
  .row:has(> :global(.switch)) { cursor: pointer; }
</style>
