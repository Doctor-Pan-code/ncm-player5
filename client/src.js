// ncm-player5 client half：网易云音乐浮窗 UI。
// 在 ncm-player4 基础上唯一新增的功能：**自动跳过不可播放的歌曲**——
// 因下架 / 无版权 / 音源失效而放不出来的歌，自动按当前播放模式跳到下一首；
// 连续跳完整个队列仍无可播歌曲时停止播放并只提示一次（防死循环）。
// 该行为可在「设置 → 播放」里关闭，关闭后与 ncm-player4 完全一致。
// 继承 ncm-player4 的两项功能：
//   1) 右下角音符按钮的动效由「固定心跳」升级为「随音乐节奏跳动」——用 Web Audio
//      AnalyserNode 取低频（贝斯/底鼓）能量，检测起音（onset）后触发一次「咚」的
//      缩放 + 光环脉冲；拍点由真实音频驱动，不同歌曲的节奏/强弱各不相同。
//      另用帧间隔估计 BPM，无低频起音的段落（纯人声/弦乐）按 BPM 补拍，避免静默。
//      Web Audio 不可用时退回 ncm-player3 的固定心跳（兜底，功能不丢）。
//   2) 右下角音符按钮支持**左键长按拖动**——按住约 180ms 进入拖动，位置持久化；
//      未加长按限制的快速点击仍是打开播放窗口。
// 继承 ncm-player3 的两项功能：点击窗口外收起为迷你条、迷你条无操作 3 秒自动退出。
// 通过 slots 注册到 shell.overlay；与 host 用 fetch('/ncm/api') JSON API 通信。
// 纯 JS（无 JSX/TS），构建时仅做简单拼接包装；react 由 client 运行时注入。
const React = require('react')

const name = 'ncm-player-client'
const inject = ['slots', 'timer']

// 无操作自动退出的判定参数：窗口打开期间，超过这段时间没有任何鼠标
// 点击/移动（键盘、滚轮同样算"有操作"）即自动点击 header「×」退出按钮。
const IDLE_AUTO_EXIT_MS = 3000
// 事件监听挂载点：既有页面也有 document.body 兜底（body 通常已存在）。
const EVENT_TARGETS = (typeof document !== 'undefined' && document.body)
  ? [typeof window !== 'undefined' ? window : document, document.body]
  : (typeof window !== 'undefined' ? [window] : [])
// 视为"有操作"的事件名：鼠标点击/移动 + 键盘 + 滚轮（用户仍在交互，就不自动退出）。
const ACTIVITY_EVENTS = [
  'pointerdown', 'pointermove', 'mousedown', 'mousemove', 'click',
  'touchstart', 'touchend', 'wheel', 'keydown', 'keyup',
]
// 右下角音符按钮「随音乐节奏跳动」的参数集中在此，便于后续调整。
// 节奏由真实音频驱动：取低频能量 → 判断起音 → 触发一次脉冲（缩放 + 光环）。
const BEAT = {
  bands: [1, 2, 3, 4],      // 参与判定的低频 bin：22050Hz 采样/2048 点 FFT 下 ≈ 22~54Hz，覆盖 40~60Hz 底鼓
  fftSize: 2048,
  t0: 2.2,                  // 起音阈值：当前低频能量 > 近 1.2s 均值的 t0 倍
  minGap: 240,              // 相邻两次判定为「拍」的最小间隔（ms），≈ 250 BPM 上限
  snap: 150,                // 帧间倒推鼓点时刻的最大回溯（ms）
  bpmMin: 60, bpmMax: 200,  // BPM 估计范围
  pulse: 520,               // 每次脉冲的视觉持续时长（ms，同时作为 CSS 动画时长）
  fps: 60,                  // 静止帧降频：无脉冲时 60fps 刷新一次状态，避免每帧重渲染
}
// 兜底：浏览器不支持 / 无法创建 Web Audio 时，退回 ncm-player3 的固定心跳。
const HEARTBEAT = {
  ring: 'ncm-beat 1.4s ease-in-out infinite',
  halo: 'ncm-halo 1.4s ease-out infinite',
  halo2: 'ncm-halo 1.4s ease-out infinite',
  haloDelay: 0.7,
}
// 右下角图标的长按拖动参数。
const DISC_DRAG = {
  holdMs: 180,   // 按住多久进入拖动；短于此视为点击（打开播放窗口）
  size: 46,      // 与 .ncm-disc 的尺寸一致
  margin: 6,     // 距视口边缘的最小距离
}
// 音符按钮位置持久化 key（与播放队列/登录态分开存，互不覆盖）。
// 沿用 ncm-player4 的 key：位置是用户自己拖出来的，升级到 v5 后不必重拖。
const DISC_POS_KEY = 'ncmply4-disc-pos'
// 自动跳过的防死循环上限：一轮里最多次数取 min(队列长度, 这个值)，
// 再大的歌单也顶多连跳这么多次，避免「全部不可播」时无休止地请求接口。
const SKIP_MAX = 30

// ---------------------------------------------------------------------------
// 节奏检测引擎（ncm-player4 新功能 1 的核心）
// ---------------------------------------------------------------------------
// 纯 JS、无 DOM 依赖：输入是每帧从 AnalyserNode 取到的低频能量，输出是
// 「拍点 / 强度 / 估计 BPM / 节拍」。拆成独立类是为了可测试、可调参。
//
// 检测思路（轻量版的 onset detection）：
//   1. 低频能量 e = 参与判定频段（BEAT.bands）的平均字节值，范围 0~255；
//   2. 起音判定用「自适应的历史均值」：mean 记录近 HIST_MS 的均值（缓慢跟随包络），
//      当 e > mean * t0 且距上次判定已过 minGap，判定为一个低频起音（鼓点）；
//   3. 用 time-domain 的 RMS 估算本帧相对最近 5s 的动态范围，把起音强度
//      归一化到 0.35~1——安静段落鼓点轻、高潮鼓点重，视觉强弱跟着音乐走；
//   4. 记录连续起音间隔，取落入 BPM 范围的中位数估计速度（约 2s 窗口）；
//   5. 检测不到起音的段落（纯人声/弦乐），按估计 BPM 的节拍格补一个弱的 0.45 拍，
//      让图标保持"跟拍"，而不是僵住。
class RhythmDetector {
  constructor (opts) {
    const o = opts || {}
    this.t0 = Number(o.t0) || BEAT.t0
    this.hi = Number(o.hi) || BEAT.hi
    this.minGap = Number(o.minGap) || BEAT.minGap
    this.bpmMin = Number(o.bpmMin) || BEAT.bpmMin
    this.bpmMax = Number(o.bpmMax) || BEAT.bpmMax
    this.reset()
  }
  reset () {
    this.mean = 0          // 低频能量历史均值（实时跟随，用来做自适应阈值）
    this.frames = 0
    this.lastE = null      // 上一帧低频能量（用来判断"起音"而非"持续"）
    this.lastMs = null
    this.lastBeatMs = null // 上一次判定为拍的时刻
    this.intervals = []    // 最近若干次起音间隔
    this.bpm = 0
    this.lastHitE = 0
    this.armed = false      // 上一帧是否已回落到阈值附近；false 表示可以触发新的起音（滞回，防连击）
  }
  // 一次判定：返回 { hit:boolean, strength, bpm, ms }
  step (e, rms, nowMs) {
    e = Number(e) || 0
    rms = Number(rms) || 0
    const ms = Number(nowMs) || 0
    this.frames += 1
    const mean = this.mean
    // 滞回：上一帧能量回落到阈值附近（< 均值的 1.15 倍）即重新武装，
    // 下一帧越过阈值就算一次新的起音。必须在判定前执行，否则会把刚打中的这一帧再武装一次。
    if (e < mean * 1.15) this.armed = false
    let hit = false
    let strength = 0
    // 首次进入判定时先落一个基准时刻，否则 lastBeatMs 为 null 永远不会触发第一拍。
    if (this.lastBeatMs === null && this.frames > 8) this.lastBeatMs = ms
    // 起音 = 这一帧能量越过自适应阈值，且上一帧还没越过（上升沿）。
    // 只要上一帧低于阈值，下一次鼓点的上升沿都能重新触发，不会被持续的高音量"盖住"。
    if (this.frames > 8 && this.lastBeatMs !== null && mean > 1) {
      const gap = ms - this.lastBeatMs
      const thr = mean * this.t0
      const rising = !this.armed
      if (e > thr && rising) {
        hit = true
        // 强度 = 起音高出阈值的倍数（1 = 刚好越过，3 倍及以上视为满分），再用 RMS 微调，
        // 这样越响的鼓点跳得越大，而不是永远顶到上限。
        const norm = Math.max(0, Math.min(1, (e / thr - 1) / 2))
        const dyn = Math.max(0, Math.min(1, rms / 255))
        strength = Math.max(0.35, Math.min(1, (0.4 + 0.6 * norm) * (0.8 + 0.2 * dyn)))
        // 帧间倒推：用相邻两帧的斜率估计真实起音时刻（顿鼓更准）
        if (this.lastMs !== null && this.lastE !== null && e > this.lastE) {
          const fr = e - this.lastE
          const dt = Math.min(BEAT.snap, Math.max(0, Math.round((thr - this.lastE) / fr * (ms - this.lastMs))))
          this.lastBeatMs = ms - Math.max(0, dt)
        } else {
          this.lastBeatMs = ms
        }
        if (gap >= (60000 / this.bpmMax) * 0.75 && gap <= (60000 / this.bpmMin) * 1.33) {
          this.intervals.push(gap)
          if (this.intervals.length > 6) this.intervals.shift()
        }
        this.bpm = this.estimateBpm()
        this.armed = true
        this.lastHitE = e
      }
    }
    this.lastE = e
    this.lastMs = ms
    // 自适应均值：起音那一帧"快抬"到当前水平（下次鼓点要重新越过阈值），
    // 其余帧缓慢跟随包络——这样阈值贴合音乐本身，安静段落也能判到轻的鼓点。
    const k = hit ? 0.25 : (meanMaxFrames(this.frames) === 8 ? 0.45 : (meanMaxFrames(this.frames) === 24 ? 0.14 : 0.05))
    this.mean = this.mean * (1 - k) + e * k
    return { hit: hit, strength: strength, bpm: this.bpm, ms: ms }
  }
  estimateBpm () {
    if (this.intervals.length < 2) return 0
    const s = this.intervals.slice().sort((a, b) => a - b)
    const median = s[Math.floor(s.length / 2)]
    const bpm = Math.round(60000 / median)
    return bpm >= this.bpmMin && bpm <= this.bpmMax ? bpm : 0
  }
  // 节拍格补拍：距上一拍已超过一个拍长则视为该补一拍
  tick (ms) {
    if (!this.bpm || this.lastBeatMs === null) return false
    const period = 60000 / this.bpm
    if (Number(ms) - this.lastBeatMs >= period * 0.96) {
      this.lastBeatMs = Number(ms)
      return true
    }
    return false
  }
}
// 自适应均值的跟随速率：前 3s（约 180 帧）快速收敛，之后缓慢跟随包络。
function meanMaxFrames (frames) {
  if (frames < 30) return 8
  if (frames < 180) return 24
  return 90
}
// 由「当前帧」构造触发形参：strong=true 表示真实鼓点，false 表示 BPM 补拍。
function pulseParams (strength, strong) {
  const s = strong ? Math.max(0.35, Math.min(1, Number(strength) || 0)) : 0.45
  return {
    scale: (0.90 + 0.13 * s).toFixed(3),
    glow: (0.10 + 0.34 * s).toFixed(3),
    dur: Math.round(120 + 190 * s),   // ms：鼓点越重，冲击波越久
  }
}


const NCM_CSS = `
.ncm-wrap { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.ncm-win { pointer-events: auto; position: absolute; width: 360px; border-radius: 14px; overflow: hidden; background: var(--dsw-alias-bg-overlay, rgba(26,26,32,0.97)); border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.09)); box-shadow: 0 12px 40px rgba(0,0,0,0.45); color: var(--dsw-alias-label-primary, #eee); font-size: 13px; }
.ncm-win.mini { width: 340px; min-height: 76px; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; box-sizing: border-box; }
.ncm-header { display: flex; align-items: center; height: 40px; padding: 0 6px 0 12px; cursor: move; user-select: none; background: transparent; }
.ncm-brand { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; font-weight: 600; color: var(--dsw-alias-label-primary, #fff); letter-spacing: 0.3px; }
.ncm-brand .ncm-logo { color: var(--dsw-alias-brand-primary, #ec4141); display: flex; }
.ncm-icobtn { pointer-events: auto; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.75)); cursor: pointer; flex: none; }
.ncm-icobtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.1)); color: var(--dsw-alias-label-primary, #fff); }
.ncm-icobtn:disabled { opacity: 0.4; cursor: default; }
.ncm-tabs { display: flex; border-top: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.07)); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.07)); background: transparent; }
.ncm-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 0 6px; border: none; background: transparent; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.55)); cursor: pointer; font-size: 10px; border-bottom: 2px solid transparent; }
.ncm-tab.active { color: var(--dsw-alias-brand-primary, #ec4141); border-bottom-color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-body { height: 400px; position: relative; }
.ncm-scroll { position: absolute; inset: 0; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
.ncm-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
.ncm-scroll::-webkit-scrollbar-thumb { background: transparent; }
.ncm-play { display: flex; flex-direction: column; align-items: center; padding: 14px 18px 10px; gap: 9px; height: 100%; box-sizing: border-box; }
.ncm-cover { width: 176px; height: 176px; border-radius: 12px; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.5); background: linear-gradient(135deg, var(--dsw-alias-bg-layer-2, #3a3a44), var(--dsw-alias-bg-layer-1, #1e1e24)); flex: none; }
.ncm-coverph { display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.35)); }
.ncm-now { text-align: center; width: 100%; min-width: 0; }
.ncm-now-name { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-now-art { margin-top: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.5)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-progrow { display: flex; align-items: center; gap: 8px; width: 100%; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.55)); font-size: 11px; font-variant-numeric: tabular-nums; }
.ncm-range { flex: 1; accent-color: var(--dsw-alias-brand-primary, #ec4141); cursor: pointer; margin: 0; min-width: 0; }
.ncm-range:disabled { opacity: 0.4; }
.ncm-ctlrow { display: flex; align-items: center; justify-content: center; gap: 14px; width: 100%; margin-top: 2px; }
.ncm-ctl { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.8)); cursor: pointer; }
.ncm-ctl:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.1)); color: var(--dsw-alias-label-primary, #fff); }
.ncm-ctl:disabled { opacity: 0.4; cursor: default; }
.ncm-ctl.on { color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-ctl.main { width: 46px; height: 46px; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #ec4141)); color: var(--dsw-alias-label-primary-foreground, #fff); box-shadow: 0 4px 14px rgba(0,0,0,0.45); }
.ncm-ctl.main:hover { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #ec4141)); }
.ncm-mode { position: relative; width: auto; min-width: 42px; height: auto; flex-direction: column; gap: 2px; border-radius: 9px; padding: 4px 6px 3px; }
.ncm-mode-txt { font-size: 9px; line-height: 1; letter-spacing: 0.5px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.5)); }
.ncm-ctl.on .ncm-mode-txt { color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-mode-1 { position: absolute; top: 0; right: 1px; font-size: 9px; font-weight: 800; line-height: 1; padding: 1px 2px; border-radius: 4px; background: var(--dsw-alias-bg-overlay, rgba(26,26,32,0.97)); color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-volrow { display: flex; align-items: center; gap: 6px; width: 128px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.6)); }
.ncm-ctlbottom { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.ncm-lrc { text-align: center; padding: 16px 22px 26px; line-height: 2.1; }
.ncm-lrc-line { font-size: 14px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.5)); transition: color .2s, transform .2s; cursor: pointer; padding: 2px 0; }
.ncm-lrc-line.active { color: var(--dsw-alias-label-primary, #fff); font-weight: 700; transform: scale(1.04); }
.ncm-lrc-tr { font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.38)); line-height: 1.5; }
.ncm-lrc-empty { text-align: center; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.4)); padding-top: 80px; }
.ncm-listhead { display: flex; align-items: center; padding: 6px 12px; height: 42px; box-sizing: border-box; }
.ncm-listsearch { position: sticky; top: 0; z-index: 2; display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06)); height: 50px; box-sizing: border-box; background: var(--dsw-alias-bg-overlay, rgba(26,26,32,0.97)); }
.ncm-input { flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12)); background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06)); color: var(--dsw-alias-label-primary, #eee); font-size: 12px; outline: none; }
.ncm-input:focus { border-color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-cookie { height: auto; min-height: 64px; padding: 8px 10px; resize: none; line-height: 1.5; font-family: inherit; width: 100%; box-sizing: border-box; }
.ncm-seg { display: flex; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12)); border-radius: 8px; overflow: hidden; flex: none; }
.ncm-seg button { border: none; background: transparent; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.6)); padding: 0 9px; height: 30px; font-size: 11px; cursor: pointer; }
.ncm-seg button.on { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #ec4141)); color: var(--dsw-alias-label-primary-foreground, #fff); }
.ncm-sec { padding: 10px 12px 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.45)); display: flex; align-items: center; gap: 6px; }
.ncm-sec::before { content: ''; width: 3px; height: 12px; background: var(--dsw-alias-brand-primary, #ec4141); border-radius: 2px; }
.ncm-row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; cursor: pointer; }
.ncm-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06)); }
.ncm-row .ncm-cover { width: 38px; height: 38px; border-radius: 6px; }
.ncm-row .ncm-coverph { width: 38px; height: 38px; border-radius: 6px; }
.ncm-row-idx { width: 20px; text-align: center; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.4)); font-size: 11px; flex: none; }
.ncm-row-info { flex: 1; min-width: 0; }
.ncm-row-name { color: var(--dsw-alias-label-primary, #eee); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-row-sub { color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.42)); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.ncm-row.cur .ncm-row-name { color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-row-side { color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.4)); font-size: 11px; flex: none; }
.ncm-add { flex: none; }
.ncm-detailhead { display: flex; gap: 10px; padding: 12px; align-items: center; }
.ncm-detailhead .ncm-cover { width: 64px; height: 64px; border-radius: 10px; }
.ncm-detailhead .ncm-coverph { width: 64px; height: 64px; border-radius: 10px; }
.ncm-loading { padding: 30px; text-align: center; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.5)); }
.ncm-queuehead { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06)); font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.6)); height: 40px; box-sizing: border-box; }
.ncm-queuehead .sp { flex: 1; }
.ncm-set { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ncm-set-sec { border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); border-radius: 10px; padding: 12px; background: var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.03)); }
.ncm-set-title { font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.55)); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.ncm-btn { height: 28px; padding: 0 12px; border: none; border-radius: 7px; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #ec4141)); color: var(--dsw-alias-label-primary-foreground, #fff); font-size: 12px; cursor: pointer; }
.ncm-btn:hover { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #ec4141)); }
.ncm-btn:disabled { opacity: 0.5; cursor: default; }
.ncm-btn.ghost { background: var(--dsw-alias-button-ghost-active-fill, var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.08))); color: var(--dsw-alias-label-primary, rgba(255,255,255,0.8)); }
.ncm-btn.ghost:hover { background: var(--dsw-alias-button-ghost-active-hover, var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.14))); filter: none; }
.ncm-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.4)); line-height: 1.6; white-space: pre-line; }
.ncm-qr { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.ncm-qrcanvas { background: #fff; border-radius: 10px; }
.ncm-select { height: 28px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14)); background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06)); color: var(--dsw-alias-label-primary, #eee); font-size: 12px; padding: 0 6px; }
.ncm-toggle { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
.ncm-toggle label { color: var(--dsw-alias-label-primary, rgba(255,255,255,0.75)); font-size: 12px; }
.ncm-toast { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #ec4141)); color: var(--dsw-alias-label-primary-foreground, #fff); padding: 6px 14px; border-radius: 999px; font-size: 12px; z-index: 20; box-shadow: 0 4px 16px rgba(0,0,0,0.5); pointer-events: none; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-disc { pointer-events: auto; position: absolute; right: 18px; bottom: 18px; width: 46px; height: 46px; border-radius: 50%; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #ec4141)); color: var(--dsw-alias-label-primary-foreground, #fff); border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.ncm-disc:hover { transform: scale(1.08); }
/* ncm-player4：音符按钮可被长按拖动——拖动中/长按蓄力中禁用 hover 放大与文字选中 */
.ncm-disc.dragging, .ncm-disc.holding { cursor: grab; transform: none; user-select: none; touch-action: none; }
.ncm-disc.dragging { cursor: grabbing; transition: none; }
.ncm-disc.lifted { filter: drop-shadow(0 10px 16px rgba(0,0,0,0.55)); }
.ncm-mini .ncm-cover { width: 40px; height: 40px; border-radius: 8px; }
.ncm-mini .ncm-coverph { width: 40px; height: 40px; border-radius: 8px; }
.ncm-mini-info { flex: 1; min-width: 0; }
.ncm-mini-name { font-size: 13px; line-height: 1.2; color: var(--dsw-alias-label-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-mini-art { font-size: 11px; line-height: 1.2; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.45)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ncm-mini-lrc { margin-top: 2px; overflow: hidden; }
.ncm-mini-lrc-line { display: inline-block; white-space: nowrap; padding-right: 24px; line-height: 1.4; color: var(--dsw-alias-brand-primary, #ec4141); }
.ncm-mini-lrc-line.mq { animation: ncm-mq var(--ncm-mq-dur, 10s) linear infinite alternate; }
@keyframes ncm-mq { from { transform: translateX(0); } to { transform: translateX(var(--ncm-mq-mx, -80px)); } }
.ncm-mini-lrc-tr { font-size: 10px; line-height: 1.2; color: var(--dsw-alias-label-secondary, rgba(255,255,255,0.42)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ncm-player4：右下角音符按钮「随音乐节奏跳动」。
   每次检测到鼓点就给按钮换一次 key，从而重放一段 ncm-pulse 动画：
   先用 --ncm-hit 缩到略小（蓄力），再按 --ncm-scale 弹大，随后回落——
   强弱由 RhythmDetector 输出的 strength 决定，拍点来自真实音频。 */
@keyframes ncm-pulse {
  0%   { transform: scale(1); }
  18%  { transform: scale(var(--ncm-hit, 0.94)); }
  38%  { transform: scale(var(--ncm-scale, 1.1)); }
  62%  { transform: scale(calc(1 + (var(--ncm-scale, 1.1) - 1) * 0.45)); }
  100% { transform: scale(1); }
}
/* 每次鼓点扩散一圈光环：起始缩放/透明度随强度变化。 */
@keyframes ncm-splash {
  0%   { transform: scale(1); opacity: var(--ncm-glow, 0.4); }
  100% { transform: scale(1.85); opacity: 0; }
}
.ncm-disc.pulse { animation: ncm-pulse var(--ncm-beat-dur, 260ms) cubic-bezier(.22,.9,.3,1) 1; will-change: transform; }
.ncm-disc-ring { position: absolute; right: 18px; bottom: 18px; width: 46px; height: 46px; border-radius: 50%; border: 2px solid var(--dsw-alias-brand-primary, #ec4141); box-sizing: border-box; pointer-events: none; }
/* 节奏光环：由鼓点触发的一次性扩散（不再无限循环） */
.ncm-disc-ring.splash { animation: ncm-splash var(--ncm-splash-dur, 420ms) ease-out 1; }
/* 兜底心跳（Web Audio 不可用时使用，与 ncm-player3 一致） */
@keyframes ncm-beat {
  0%, 100% { transform: scale(1); box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 0 0 rgba(236,65,65,0.45); }
  14% { transform: scale(0.94); box-shadow: 0 4px 12px rgba(0,0,0,0.5), 0 0 0 2px rgba(236,65,65,0.32); }
  28% { transform: scale(1.14); box-shadow: 0 8px 26px rgba(0,0,0,0.5), 0 0 0 6px rgba(236,65,65,0.16); }
  42% { transform: scale(1.03); box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 0 2px rgba(236,65,65,0.10); }
  56% { transform: scale(1.09); box-shadow: 0 7px 22px rgba(0,0,0,0.5), 0 0 0 4px rgba(236,65,65,0.06); }
}
@keyframes ncm-halo {
  0% { transform: scale(1); opacity: 0.5; }
  70% { transform: scale(2); opacity: 0; }
  100% { transform: scale(2); opacity: 0; }
}
.ncm-disc.beat { animation: ncm-beat 1.4s ease-in-out infinite; }
.ncm-disc-ring.beat { animation: ncm-halo 1.4s ease-out infinite; }
.ncm-disc-ring.beat.d2 { animation-delay: 0.7s; }
`

function apply (ctx) {
  const styleEl = document.createElement('style')
  styleEl.id = 'ncm-player5-style'
  styleEl.textContent = NCM_CSS
  document.head.appendChild(styleEl)

  const slots = ctx.slots
  const timer = ctx.timer
  const h = React.createElement
  const { useState, useEffect, useRef } = React

  const api = async (op, args) => {
    const res = await fetch('/ncm/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ op }, args || {})),
    })
    const parsed = await res.json().catch(() => null)
    if (!parsed || parsed.ok !== true) {
      throw new Error((parsed && parsed.error && parsed.error.message) || '未知错误')
    }
    return parsed.value
  }

  // ---- 本地持久化：登录态与播放队列保存在浏览器 localStorage（host 不再写盘）。
  // 所有读写都 try/catch 包裹：隐私模式等场景下静默降级为"不持久化"。
  // LS_KEY 沿用 ncm-player2 的 key：同为 ncm 系插件，切换 v2/v3 时保留
  // 同一份登录态与播放队列（各插件全局状态本就互不影响，由 cordis.patch.yml 保证唯一）。
  const LS_KEY = 'ncmply2-settings'
  const lsRead = () => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return null
      const v = JSON.parse(raw)
      return v && typeof v === 'object' ? v : null
    } catch (e) { return null }
  }
  const lsWrite = (v) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(v)); return true } catch (e) { return false }
  }

  const fmt = (ms) => {
    if (!ms || ms < 0) return '0:00'
    const s = Math.floor(ms / 1000)
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
  }

  const parseLrc = (lrcText, tlyricText, romaText) => {
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
    const parse = (text) => {
      const lines = []
      if (!text) return lines
      for (const raw of text.split('\n')) {
        const times = []
        let m
        re.lastIndex = 0
        while ((m = re.exec(raw))) times.push(parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + parseInt(String(m[3] || '0').padEnd(3, '0'), 10))
        const content = raw.replace(re, '').trim()
        if (times.length === 0 || !content) continue
        for (const t of times) lines.push({ t, text: content })
      }
      lines.sort((a, b) => a.t - b.t)
      return lines
    }
    const main = parse(lrcText)
    let trans = parse(tlyricText)
    if (trans.length === 0) trans = parse(romaText)
    let ti = 0
    for (const line of main) {
      line.tr = ''
      while (ti < trans.length && trans[ti].t < line.t - 800) ti++
      if (ti < trans.length && Math.abs(trans[ti].t - line.t) <= 800) line.tr = trans[ti].text
    }
    return main
  }

  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    next: ['M6 5v14l9-7-9-7z', 'M17 5h2v14h-2z'],
    prev: ['M18 5v14l-9-7 9-7z', 'M5 5h2v14H5z'],
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z',
    music: ['M9 18V5l12-2v13', 'M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    list: ['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01'],
    lrc: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
    gear: ['M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3', 'M1 14h6M9 8h6M17 16h6'],
    queue: ['M21 15V6', 'M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M12 12H3', 'M16 6H3', 'M12 18H3'],
    shuffle: ['M16 3h5v5', 'M4 20L21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
    repeat: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
    vol: ['M11 5 6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
    volx: ['M11 5 6 9H2v6h4l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'],
    x: ['M18 6 6 18', 'M6 6l12 12'],
    minus: 'M5 12h14',
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    back: 'M15 18l-6-6 6-6',
    expand: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
    plus: ['M12 5v14', 'M5 12h14'],
    disc: ['M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20z'],
  }

  const Ico = ({ d, size, fill, className }) => {
    const paths = Array.isArray(d) ? d : [d]
    const s = size || 16
    return h('svg', { viewBox: '0 0 24 24', width: s, height: s, className, style: { display: 'block', width: s + 'px', height: s + 'px' } },
      paths.map((p, i) => h('path', { key: i, d: p, fill: fill ? 'currentColor' : 'none', stroke: fill ? 'none' : 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))
  }

  const hideImg = (e) => { e.currentTarget.style.display = 'none' }

  const QrCanvas = ({ grid, size }) => {
    const ref = useRef(null)
    useEffect(() => {
      const cv = ref.current
      if (!cv || !grid || !grid.length) return
      const n = grid.length
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
      cv.width = Math.round(size * dpr)
      cv.height = Math.round(size * dpr)
      const ctx2 = cv.getContext('2d')
      if (!ctx2) return
      ctx2.scale(dpr, dpr)
      ctx2.fillStyle = '#ffffff'
      ctx2.fillRect(0, 0, size, size)
      const margin = Math.max(1, Math.round(size / n))
      const cell = (size - margin * 2) / n
      ctx2.fillStyle = '#000000'
      for (let r = 0; r < n; r++) {
        const row = grid[r]
        if (!row) continue
        for (let c = 0; c < n; c++) {
          if (row.charAt(c) === '1') {
            ctx2.fillRect(margin + c * cell, margin + r * cell, Math.ceil(cell), Math.ceil(cell))
          }
        }
      }
    }, [grid, size])
    return h('canvas', { ref, className: 'ncm-qrcanvas', style: { width: size + 'px', height: size + 'px' } })
  }

  // -------------------------------------------------------------------------
  // ncm-player4 新功能 1 的接线：把 <audio> 接到 Web Audio 分析器上。
  // 只在浏览器支持时创建；创建失败（不支持 / 被策略禁用）返回 null，
  // 调用方据此退回固定心跳，保证功能不丢。
  // -------------------------------------------------------------------------
  function createRhythmEngine () {
    if (typeof window === 'undefined') return null
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const analyserCtx = {}
    const engine = {
      ac: null,
      analyser: null,
      source: null,
      freq: null,
      time: null,
      attached: null,
      // 把（或换）一个 audio 元素接进分析图。同一个元素不会重复接线。
      //
      // 重要：createMediaElementSource 会把该元素的声音从扬声器改道进 AudioContext，
      // 而且不可逆（元素从此不再自己发声，只有图里有通往 destination 的通路才会响）。
      // 所以接线的前提是「分析链一定能一路通到 destination」，否则整首歌会永久静音。
      // 三个前置条件任一不满足就先不接，由固定心跳兜底，条件满足后会自动再接。
      attach (audioEl) {
        if (!audioEl) return false
        if (engine.attached === audioEl && engine.source) return true
        try {
          if (!engine.ac) {
            engine.ac = new AC()
            engine.analyser = engine.ac.createAnalyser()
            engine.analyser.fftSize = BEAT.fftSize
            engine.freq = new Uint8Array(engine.analyser.frequencyBinCount)
            engine.time = new Uint8Array(engine.analyser.fftSize)
          }
          // ① 上下文挂起时接线等于静音：先尝试 resume，本轮不接。
          if (engine.ac.state !== 'running') {
            try { engine.ac.resume().catch(() => { }) } catch (e) { }
            analyserCtx.ok = false
            analyserCtx.reason = 'suspended'
            return false
          }
          if (audioEl.error) {
            analyserCtx.ok = false
            analyserCtx.reason = 'media-error'
            return false
          }
          // ② 跨域音频没走 CORS 时，浏览器把该源的输出整体置零（分析器和扬声器都收不到），
          //    这种元素一旦接线就是静音，等拿到 CORS 地址再接。
          if (audioEl.crossOrigin !== 'anonymous') {
            analyserCtx.ok = false
            analyserCtx.reason = 'not-cors'
            return false
          }
          // ③ 还没拿到数据就先不接：加载期的地址有可能随后因 CORS 失败，
          //    一旦接管进去就再也退不出来，宁可晚半秒再补接线。
          if (audioEl.readyState < 2) {
            analyserCtx.ok = false
            analyserCtx.reason = 'loading'
            return false
          }
          if (engine.source) { try { engine.source.disconnect() } catch (e) { } }
          engine.source = engine.ac.createMediaElementSource(audioEl)
          engine.source.connect(engine.analyser)
          // ④ 必须接到 destination：元素的声音已经在图里了，图没有出口就是把声音丢掉
          //    （旧实现只连到 analyser，正是「播放没声音」的直接原因）。
          engine.analyser.connect(engine.ac.destination)
          engine.attached = audioEl
          analyserCtx.ok = true
          analyserCtx.reason = 'ok'
          return true
        } catch (e) {
          analyserCtx.ok = false
          analyserCtx.error = e
          analyserCtx.reason = 'error'
          return false
        }
      },
      // 返回 resume 的 Promise（无 ac 或已 running 时返回 null），供调用方等待后补接线。
      resume () {
        const ac = engine.ac
        if (!ac || ac.state === 'running') return null
        try { return ac.resume() } catch (e) { return null }
      },
      // 读一帧低频能量与 RMS；未接线时返回 null。
      read () {
        const an = engine.analyser
        if (!an) return null
        an.getByteFrequencyData(engine.freq)
        let sum = 0
        for (const b of BEAT.bands) { if (b < engine.freq.length) sum += engine.freq[b] }
        const e = sum / BEAT.bands.length
        an.getByteTimeDomainData(engine.time)
        let ss = 0
        for (let i = 0; i < engine.time.length; i++) { const v = (engine.time[i] - 128) / 128; ss += v * v }
        const rms = Math.sqrt(ss / engine.time.length) * 255
        return { e, rms }
      },
    }
    engine.lastError = () => analyserCtx.error || null
    return engine
  }

  function NcmPlayer () {
    // 尺寸常量：展开窗 / 迷你条，用于默认定位与展开时防溢出。
    const WIN_W = 360
    const WIN_H = 490
    const MINI_W = 340
    const MINI_H = 96
    const defaultPos = () => (typeof window === 'undefined' ? null : { x: Math.max(8, window.innerWidth - MINI_W - 14), y: Math.max(8, window.innerHeight - MINI_H - 14) })
    const [pos, setPos] = useState(defaultPos)
    // 网页打开时默认隐藏为右下角音符按钮（visible=false），点击后展开完整窗口。
    const [mini, setMini] = useState(false)
    const [visible, setVisible] = useState(false)
    const [tab, setTab] = useState('play')
    const [queue, setQueue] = useState([])
    const [index, setIndex] = useState(-1)
    const [playing, setPlaying] = useState(false)
    const [time, setTime] = useState(0)
    const [dur, setDur] = useState(0)
    const [vol, setVol] = useState(0.8)
    const [muted, setMuted] = useState(false)
    const [mode, setMode] = useState('order')
    const [songUrl, setSongUrl] = useState(null)
    const [lyrics, setLyrics] = useState([])
    const [showTrans, setShowTrans] = useState(true)
    const [showMiniLrc, setShowMiniLrc] = useState(true)
    const [miniLrcScroll, setMiniLrcScroll] = useState(true)
    const [miniLrcSize, setMiniLrcSize] = useState(11)
    const [quality, setQuality] = useState(320000)
    const [loading, setLoading] = useState(false)
    // 生成号：<audio> 一旦被 createMediaElementSource 接管就无法撤销，
    // 遇到「已被接管但加载失败」时只能换一个全新的元素，见 onAudioError。
    const [audioGen, setAudioGen] = useState(0)
    const [account, setAccount] = useState(null)
    const [cookieDraft, setCookieDraft] = useState('')
    const [hot, setHot] = useState([])
    const [myPls, setMyPls] = useState([])
    const [myAlbums, setMyAlbums] = useState([])
    const [myTab, setMyTab] = useState('mine')
    const [listScope, setListScope] = useState('discover')
    const [searchKw, setSearchKw] = useState('')
    const [searchType, setSearchType] = useState(1)
    const [searchRes, setSearchRes] = useState(null)
    const [searching, setSearching] = useState(false)
    const [plDetail, setPlDetail] = useState(null)
    const [plLoading, setPlLoading] = useState(false)
    const [likedIds, setLikedIds] = useState(null)
    const [liked, setLiked] = useState(false)
    const [likeBusy, setLikeBusy] = useState(false)
    const [qr, setQr] = useState(null)
    const [qrBusy, setQrBusy] = useState(false)
    const [toast, setToast] = useState(null)
    const audioRef = useRef(null)
    const toastTimerRef = useRef(null)
    const dragRef = useRef(null)
    // 长按计时器：归属单次按下/抬起，不随渲染或打拍状态重建。
    const holdTimerRef = useRef(null)
    // 完整播放窗口根节点引用：用于判断一次 pointerdown 是否落在窗口之外。
    const winRef = useRef(null)
    const posRef = useRef(null)
    const pendingTimeRef = useRef(0)
    const autoPlayRef = useRef(true)
    // 当前地址是否已因「无 CORS 响应头」回退过一次（避免 onError 循环重试）。
    const corsRetryRef = useRef(false)
    // 自动跳过的防死循环闸门：{ tries, stopped }。
    //   tries   —— 本轮连续跳过了几首坏歌（成功播放一首就清零）；
    //   stopped —— 本轮已经判定「队列里没有能放的歌」并停了播放，需要用户再点播放
    //              （或换歌/换队列）才重新开闸，否则每次 update 都会被再次误判成坏歌。
    // 用 ref 而不是 state：跳过发生在 fetch 回调 / 事件回调里，需要读到同步的最新值。
    const skipGuardRef = useRef({ tries: 0, stopped: false })
    // 上一首「判定为不可播」的歌曲 id + 原因：用于 toast 区分（A→B 跳过后不再重复提示 A）。
    const skipNoticeRef = useRef({ id: null, name: '', reason: null })
    const liveRef = useRef(null)
    const throttledSaveRef = useRef(null)
    const accountRef = useRef(null)
    const accountCookieRef = useRef(null)
    posRef.current = pos
    const song = index >= 0 && index < queue.length ? queue[index] : null
    // ncm-player3：无操作自动退出的开关（默认开启，持久化到 state.autoExit）。
    const [autoExit, setAutoExit] = useState(true)
    // ncm-player5：遇到下架/无版权/放不出来的歌自动跳下一首（默认开启，
    // 持久化到 state.autoSkip；关掉后行为与 ncm-player4 完全一致）。
    const [autoSkip, setAutoSkip] = useState(true)

    // --- ncm-player4 新功能 1：随音乐节奏跳动 ---
    // rhythm：当前这拍的形参（key/scale/glow/dur）；每拍换 key 以重放 CSS 动画。
    const [rhythm, setRhythm] = useState(null)
    const [bpm, setBpm] = useState(0)
    // 音符按钮位置（null = 尚未拖动过，用默认右下角）。持久化到 localStorage。
    const [discPos, setDiscPos] = useState(() => {
      try {
        const raw = localStorage.getItem(DISC_POS_KEY)
        if (!raw) return null
        const v = JSON.parse(raw)
        return v && typeof v.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : null
      } catch (e) { return null }
    })
    const rhythmEngineRef = useRef(null)
    const detRef = useRef(null)
    const beatKeyRef = useRef(0)
    const lastPulseMsRef = useRef(0)
    const discDragRef = useRef(null)
    const discElRef = useRef(null)
    const discPosRef = useRef(null)
    const suppressClickRef = useRef(false)
    discPosRef.current = discPos

    const showToast = (msg) => {
      setToast({ msg, id: Date.now() })
      if (toastTimerRef.current) { try { toastTimerRef.current() } catch (e) { } }
      toastTimerRef.current = timer.timeout(() => setToast(null), 2800)
    }

    const buildState = () => {
      const s = liveRef.current
      if (!s) return null
      const a = audioRef.current
      return { queue: s.queue.slice(0, 300), index: s.index, mode: s.mode, vol: s.muted ? 0 : s.vol, quality: s.quality, showTrans: s.showTrans, showMiniLrc: s.showMiniLrc, miniLrcScroll: s.miniLrcScroll, miniLrcSize: s.miniLrcSize, autoExit: s.autoExit, autoSkip: s.autoSkip, time: a && a.currentTime ? Math.round(a.currentTime * 1000) : 0 }
    }
    const applyAccount = (acc) => { setAccount(acc); accountRef.current = acc }
    const applySavedState = (st) => {
      if (!st) return
      if (st.queue && st.queue.length) {
        const q = st.queue.slice(0, 300).map((s) => ({ id: s.id, name: String(s.name || '未知歌曲'), artists: String(s.artists || ''), album: String(s.album || ''), cover: String(s.cover || ''), duration: Number(s.duration) || 0 }))
        setQueue(q)
        const i = Math.max(0, Math.min(Number(st.index) || 0, q.length - 1))
        setIndex(i)
        if (typeof st.time === 'number' && st.time > 3) pendingTimeRef.current = st.time
        autoPlayRef.current = false
        showToast('已恢复上次的播放队列')
      }
      if (st.mode === 'loop' || st.mode === 'shuffle') setMode(st.mode)
      if (typeof st.vol === 'number' && st.vol >= 0 && st.vol <= 1) { setVol(st.vol); setMuted(st.vol === 0) }
      if (st.quality === 128000 || st.quality === 320000) setQuality(st.quality)
      if (typeof st.showTrans === 'boolean') setShowTrans(st.showTrans)
      if (typeof st.showMiniLrc === 'boolean') setShowMiniLrc(st.showMiniLrc)
      if (typeof st.miniLrcScroll === 'boolean') setMiniLrcScroll(st.miniLrcScroll)
      if (st.miniLrcSize === 9 || st.miniLrcSize === 11 || st.miniLrcSize === 13) setMiniLrcSize(st.miniLrcSize)
      if (typeof st.autoSkip === 'boolean') setAutoSkip(st.autoSkip)
    }
    // 把当前登录态与播放队列写入 localStorage（登录/登出时同步写，队列变化由 saveNow 写）。
    // 读-改-写：登录恢复是异步的，恢复完成前 accountCookieRef 为 null——
    // 若此时直接写 null 会覆盖掉 localStorage 里已保存的登录态（重启后丢登录的根因）。
    const persistLocal = () => {
      const st = buildState()
      if (!st) return
      const prev = lsRead() || {}
      const account = accountCookieRef.current !== null && accountCookieRef.current !== undefined
        ? accountCookieRef.current
        : (prev && prev.account ? prev.account : null)
      lsWrite({ account, state: st })
    }
    const saveNow = () => {
      const st = buildState()
      if (!st) return
      api('saveState', { state: st }).catch(() => { })
      persistLocal()
    }
    liveRef.current = { queue, index, mode, vol, muted, quality, showTrans, showMiniLrc, miniLrcScroll, miniLrcSize, autoExit, autoSkip }

    // 从 localStorage 恢复 autoExit / autoSkip 开关（默认都开启）。
    useEffect(() => {
      const saved = lsRead()
      const st = saved && saved.state
      if (st && typeof st.autoExit === 'boolean') setAutoExit(st.autoExit)
      if (st && typeof st.autoSkip === 'boolean') setAutoSkip(st.autoSkip)
    }, [])

    useEffect(() => {
      api('hotPlaylists', { limit: 30 }).then((r) => setHot(r.items || [])).catch((e) => showToast(e.message))
      const saved = lsRead()
      // 队列恢复：localStorage 优先（可能比旧文件新），否则回退 host 内存（旧 ~/.dsh 文件迁移）。
      if (saved && saved.state && saved.state.queue && saved.state.queue.length) applySavedState(saved.state)
      else api('loadState').then((r) => applySavedState(r.state)).catch(() => { })
      // 账号恢复：localStorage 有 cookie 则重新校验；否则看 host 内存是否有旧文件迁入的登录态。
      if (saved && saved.account && saved.account.cookie) {
        api('setAccount', { cookie: saved.account.cookie }).then((r) => {
          applyAccount({ uid: r.uid, nickname: r.nickname, hasCookie: true, persisted: true })
          accountCookieRef.current = { cookie: saved.account.cookie, uid: r.uid, nickname: r.nickname }
          showToast('已恢复登录态: ' + r.nickname)
        }).catch((e) => {
          const msg = String((e && e.message) || e)
          const invalid = /凭据|失效|过期|未登录|401|403/i.test(msg)
          if (invalid) {
            applyAccount({ uid: null, nickname: '', hasCookie: false, persisted: false })
            accountCookieRef.current = null
            if (saved.state) lsWrite({ account: null, state: saved.state })
            showToast('登录凭据已失效, 请重新登录')
          } else {
            // 网络等暂时性失败:保留本地登录态,下次启动再试(避免误删)。
            accountCookieRef.current = saved.account
            applyAccount({ uid: null, nickname: '', hasCookie: false, persisted: false })
            showToast('恢复登录态失败(网络异常), 已保留本地登录态')
          }
        })
      } else {
        api('accountStatus').then((r) => applyAccount({ uid: r.uid, nickname: r.nickname || '', hasCookie: !!r.hasCookie, persisted: !!r.persisted })).catch(() => { })
        // 旧版文件数据一次性迁入 localStorage（host 内存里有 cookie 时才写）。
        api('exportAccount').then((a) => {
          if (a && a.cookie) {
            accountCookieRef.current = a
            lsWrite({ account: a, state: saved && saved.state ? saved.state : buildState() })
          }
        }).catch(() => { })
      }
      return () => { if (toastTimerRef.current) { try { toastTimerRef.current() } catch (e) { } } }
    }, [])

    useEffect(() => {
      if (!throttledSaveRef.current) throttledSaveRef.current = timer.throttle(() => saveNow(), 1500)
      throttledSaveRef.current()
      return () => { if (throttledSaveRef.current) { try { throttledSaveRef.current.dispose() } catch (e) { } throttledSaveRef.current = null } }
    }, [queue, index, mode, vol, quality, showTrans, showMiniLrc, miniLrcScroll, miniLrcSize, autoSkip])

    useEffect(() => {
      if (!playing) return undefined
      const d = timer.interval(() => saveNow(), 15000)
      return () => { if (d) { try { d() } catch (e) { } } }
    }, [playing])

    useEffect(() => {
      if (!account || !account.uid) { setLikedIds(null); setMyPls([]); setMyAlbums([]); return }
      api('likedSet').then((r) => setLikedIds(new Set(r.ids || []))).catch(() => setLikedIds(new Set()))
      api('myPlaylists').then((r) => setMyPls(r.items || [])).catch(() => { })
      api('myAlbums').then((r) => setMyAlbums(r.items || [])).catch(() => { })
    }, [account && account.uid])

    // --- ncm-player5 新功能：不可播放歌曲自动跳过 ---
    // 判定来源有两个：
    //   ① 地址阶段：host 的 songUrl 返回 playable===false（下架/无版权/无音源）；
    //   ② 元素阶段：<audio> 报错且「换元素」「去 CORS」两条自救分支都不适用（见 onAudioError）。
    // 老 host 的 songUrl 只有 { url }，没有 playable 字段 → 视为「未知」，一律不跳。
    const skipReasonText = (reason) => (reason === 'copyright' ? '无版权/已下架' : '暂时无法播放')
    // 记下「刚刚跳过了哪首、为什么」，供下一首解析地址时补一条汇总提示。
    // 不在跳过的瞬间弹 toast：那样快速连跳时会刷屏，用户只看到最后一首的名字。
    const noteSkipped = (s, reason) => { skipNoticeRef.current = { id: s ? s.id : null, name: s ? s.name : '', reason: reason || 'unavailable' } }
    // 用户主动点播 / 上一首 / 手动下一首：那是明确的新一次播放意图，防死循环的计数重新开闸。
    const resetSkipGuard = () => { skipGuardRef.current = { tries: 0, stopped: false } }
    // 按当前播放模式算出「被跳过时该跳到哪首」：
    //   顺序 —— index+1，到末尾回到第 0 首（可播的歌曲循环播放）；
    //   随机 —— 随机取一首并避开当前这首（队列只剩 1 首时只能原地不动）；
    //   单曲 —— 也跳到下一首：单曲循环重播这首坏歌毫无意义，会一直卡死。
    const skipTargetIndex = () => {
      const n = queue.length
      if (n <= 1) return -1
      let base = index
      if (base < 0 || base >= n) base = n - 1
      if (mode === 'shuffle') {
        let i = Math.floor(Math.random() * n)
        if (i === base) i = (base + 1) % n
        return i
      }
      return (base + 1) % n
    }
    // 播放中遇到不可播放的歌 → 跳到下一首并继续播放。
    // 返回 true 表示已经接管（跳走或停下），调用方不必再弹常规的「播放失败」提示。
    //
    // 防死循环（这是整个功能最关键的部分）：
    //   · 每跳一次 tries+1；成功播放一首（onPlay）就把 tries 清零；
    //   · tries 达到本轮上限（min(队列长度, SKIP_MAX)）时说明整轮都放不出来 →
    //     setPlaying(false) 停在当前这首，并弹一次「队列中没有可播放的歌曲」；
    //   · 停下后 stopped=true 且 tries>=上限，此后任何新的「不可播」报告都只提示不跳，
    //     必须由用户点播放/上一首/下一首（resetSkipGuard）才重新开闸——否则用户手动
    //     点回一首坏歌会触发无限「跳→点回→跳」的拉锯；
    //   · 队列只有 1 首时直接停（跳过目标为 -1），不会反复解析同一个地址。
    const skipUnplayable = (s, reason, from) => {
      if (!s) return false
      // 关掉开关时完全退回 ncm-player4：只保留原来的 toast，不跳歌。
      if (!autoSkip) {
        if (from === 'url') showToast('无法播放: 可能无版权或已下架')
        return false
      }
      const g = skipGuardRef.current
      // 已经停过一轮了：不再自动继续，交给用户决定。
      if (g.stopped) {
        if (from === 'url') showToast('《' + s.name + '》无法播放: ' + skipReasonText(reason))
        return true
      }
      const cap = Math.min(queue.length, SKIP_MAX)
      const tgt = skipTargetIndex()
      if (tgt < 0 || g.tries >= cap) {
        g.stopped = true
        setPlaying(false)
        noteSkipped(s, reason)
        showToast(queue.length <= 1 ? '《' + s.name + '》无法播放: ' + skipReasonText(reason) : '队列中没有可播放的歌曲')
        return true
      }
      g.tries += 1
      noteSkipped(s, reason)
      autoPlayRef.current = true
      setIndex(tgt)
      return true
    }
    // 地址解析失败（网络/接口异常）时：原来只弹 toast 留在原地；开了自动跳过就顺手跳下一首，
    // 否则一首返回异常的坏数据会把整轮播放卡死在这里。
    const skipOnUrlError = (s, err) => {
      const msg = String((err && err.message) || err || '')
      if (autoSkip && s) {
        if (skipUnplayable(s, 'error', 'err')) return
      }
      showToast('获取播放地址失败: ' + msg)
    }

    useEffect(() => {
      if (!song) { setSongUrl(null); setLyrics([]); setDur(0); setTime(0); return }
      // 换歌就得重新走 CORS 兜底：上一首可能在元素层把 corsRetryRef 置成了 true，
      // 不清掉的话下一首会直接用「不走 CORS」的普通加载。
      corsRetryRef.current = false
      setLoading(true)
      api('songUrl', { id: song.id, br: quality }).then((r) => {
        // ① host 明确告知不可播（playable===false）：不再加载音频，直接按模式跳过。
        //    老格式 { url } 没有 playable 字段 → undefined，视为未知，照旧播放（不跳）。
        if (r && r.playable === false) {
          setSongUrl(null)
          skipUnplayable(song, r.reason || 'unavailable', 'url')
          return
        }
        // 上一首被跳过时留下了一条提示，这里补在「成功」的那首上，避免连续跳歌时刷屏。
        const note = skipNoticeRef.current
        if (note && note.id) {
          skipNoticeRef.current = { id: null, name: '', reason: null }
          showToast('已跳过《' + (note.name || '未知歌曲') + '》: ' + skipReasonText(note.reason))
        }
        setSongUrl(r.url)
      }).catch((e) => { setSongUrl(null); skipOnUrlError(song, e) }).finally(() => setLoading(false))
      api('lyric', { id: song.id }).then((r) => setLyrics(parseLrc(r.lrc, r.tlyric, r.romalrc))).catch(() => setLyrics([]))
    }, [index, quality, autoSkip])

    useEffect(() => {
      if (song) setLiked(!!(likedIds && likedIds.has(song.id)))
    }, [song && song.id, likedIds])

    useEffect(() => {
      const a = audioRef.current
      if (!a || !songUrl) return
      // 跨域音频必须显式走 CORS：否则浏览器会把这个音源的输出整体静音，
      // 一旦接进 Web Audio（音量可视化）就连扬声器也没声音。网易云 CDN 对 mp3
      // 返回 access-control-allow-origin: *，所以统一用 anonymous。
      // 注意：属性必须在 src 之前设好，改 crossOrigin 会触发重新加载。
      // corsRetryRef 记录「这个地址不走 CORS 也放不出来」，换元素重挂时沿用，避免死循环。
      const wantCors = !corsRetryRef.current
      try { a.crossOrigin = wantCors ? 'anonymous' : null } catch (e) { }
      if (wantCors) corsRetryRef.current = false
      a.src = songUrl
      setLoading(true)
      if (!autoPlayRef.current) { setLoading(false); return }
      a.play().then(() => setPlaying(true)).catch(() => { showToast('播放失败: 可能无版权或地址已失效') }).finally(() => setLoading(false))
    }, [songUrl, audioGen])

    useEffect(() => { const a = audioRef.current; if (a) a.volume = muted ? 0 : vol }, [vol, muted])
    useEffect(() => () => { window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragUp) }, [])

    const onTimeUpdate = (e) => setTime(e.currentTarget.currentTime * 1000)
    const onLoadedMetadata = (e) => {
      const a = e.currentTarget
      setDur(a.duration * 1000)
      if (pendingTimeRef.current > 0 && a.duration) {
        a.currentTime = Math.min(pendingTimeRef.current / 1000, a.duration - 0.5)
        pendingTimeRef.current = 0
      }
    }
    const onEnded = () => {
      const a = audioRef.current
      if (mode === 'loop') { if (a) { a.currentTime = 0; a.play().catch(() => { }) } return }
      if (mode === 'shuffle') {
        if (queue.length > 1) { let i = Math.floor(Math.random() * queue.length); if (i === index) i = (i + 1) % queue.length; setIndex(i) }
        else if (a) { a.currentTime = 0; a.play().catch(() => { }) }
        return
      }
      if (index < queue.length - 1) setIndex(index + 1)
      else setPlaying(false)
    }
    const onAudioError = () => {
      const a = audioRef.current
      const eng = rhythmEngineRef.current
      // 已被 Web Audio 接管的元素再报错，要先换新元素重来一次，不能直接判定不可播：
      // 「接管后才失败」也可能只是 AudioContext 被挂起 / 图断了（见下方说明）。
      const wasAttached = !!(a && eng && eng.attached === a)
      // 已经被 Web Audio 接管过的元素：它现在只能靠 AudioContext 发声，
      // 而这条链路一旦因跨域/失效而失败就再也救不回来，只能换新元素重开。
      if (wasAttached) {
        if (!corsRetryRef.current) corsRetryRef.current = true
        setAudioGen((g) => g + 1)
        return
      }
      // 少数地址（如 outer/url 兜底重定向、部分 404 转页）不带 CORS 响应头，
      // 强制 anonymous 会直接加载失败。这里放弃 CORS 重载一次，保证「先能听到」：
      // 此时元素不能接 Web Audio（接了会静音），节拍自动退回固定心跳。
      if (a && a.crossOrigin === 'anonymous' && !corsRetryRef.current) {
        corsRetryRef.current = true
        try {
          a.crossOrigin = null
          a.load()
          a.play().then(() => setPlaying(true)).catch(() => { })
        } catch (e) { }
        return
      }
      // 与上面两次自救都不相关，才轮到「这首歌是不是根本放不出来」：
      //   · code 4 = SRC_NOT_SUPPORTED（服务端给的其实是 404 页/空文件/下架占位），
      //   · code 3 = DECODE（文件损坏）——这两种基本不可能靠重试恢复，可以直接判定不可播；
      //   · CORS 兜底已经用尽（corsRetryRef=true）说明这个地址连「不走 CORS」都放不出来，
      //     同样是稳定失败，算作不可播。
      //   其余情况（code 2 网络中断等）往往是暂时性的，维持原来的 toast 行为，绝不跳歌。
      // 「换元素重播」出现在这条分支之前，所以那次重试不会被误判成不可播。
      const code = a && a.error ? a.error.code : 0
      const fatal = code === 4 || code === 3
      if (songUrl && (fatal || corsRetryRef.current)) {
        const handled = skipUnplayable(song, 'unavailable', 'audio')
        if (handled) return
      }
      if (songUrl) showToast('播放出错(可能无版权或需会员)')
    }

    const playAt = (i) => { if (i >= 0 && i < queue.length) { resetSkipGuard(); autoPlayRef.current = true; setIndex(i); setTab('play') } }
    const playFrom = (tracks, i) => {
      if (!tracks || !tracks.length) return
      resetSkipGuard()
      autoPlayRef.current = true
      setQueue(tracks.map((s) => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, cover: s.cover, duration: s.duration })))
      setIndex(Math.max(0, i))
      setTab('play')
    }
    const addToQueue = (s) => {
      const item = { id: s.id, name: s.name, artists: s.artists, album: s.album, cover: s.cover, duration: s.duration }
      setQueue((q) => (q.length === 0 ? [item] : q.concat([item])))
      showToast('已加入队列')
    }
    const toggle = () => {
      const a = audioRef.current
      if (!a || !song) return
      resetSkipGuard()
      autoPlayRef.current = true
      if (a.paused) a.play().catch(() => { }); else a.pause()
    }
    const next = () => {
      if (!queue.length) return
      resetSkipGuard()
      autoPlayRef.current = true
      if (mode === 'shuffle') { let i = Math.floor(Math.random() * queue.length); if (i === index) i = (i + 1) % queue.length; setIndex(i); return }
      setIndex((index + 1) % queue.length)
    }
    const prev = () => {
      const a = audioRef.current
      if (a && a.currentTime > 3) { a.currentTime = 0; return }
      if (!queue.length) return
      resetSkipGuard()
      autoPlayRef.current = true
      setIndex((index - 1 + queue.length) % queue.length)
    }
    const seek = (ms) => { const a = audioRef.current; if (a) { a.currentTime = ms / 1000; setTime(ms) } }
    const onVol = (v) => { setVol(v); if (v > 0 && muted) setMuted(false); if (v === 0) setMuted(true) }
    const toggleMute = () => setMuted((m) => !m)
    const removeFromQueue = (i) => {
      const nq = queue.filter((_, j) => j !== i)
      setQueue(nq)
      if (i < index) setIndex(index - 1)
      else if (i === index) {
        if (nq.length === 0) { setIndex(-1); setSongUrl(null); const a = audioRef.current; if (a) a.pause() }
        else setIndex(Math.min(index, nq.length - 1))
      }
    }
    const clearQueue = () => {
      resetSkipGuard()
      setQueue([]); setIndex(-1); setSongUrl(null)
      const a = audioRef.current
      if (a) { a.pause(); a.removeAttribute('src') }
    }
    const toggleLike = () => {
      if (!song) return
      if (!account || !account.uid) { showToast('请先在设置中登录账号'); setTab('settings'); return }
      if (likeBusy) return
      setLikeBusy(true)
      const target = !liked
      api('like', { id: song.id, like: target }).then(() => {
        setLiked(target)
        setLikedIds((s) => { const ns = new Set(s || []); if (target) ns.add(song.id); else ns.delete(song.id); return ns })
        showToast(target ? '已收藏' : '已取消收藏')
      }).catch((e) => showToast(e.message)).finally(() => setLikeBusy(false))
    }
    const doSearch = () => {
      const kw = searchKw.trim()
      if (!kw) return
      setSearching(true)
      api('search', { keyword: kw, type: searchType }).then((r) => {
        setSearchRes(searchType === 1
          ? { songs: r.songs || [], playlists: [], albums: [] }
          : searchType === 10
            ? { songs: [], playlists: [], albums: r.albums || [] }
            : { songs: [], playlists: r.playlists || [], albums: [] })
      }).catch((e) => showToast(e.message)).finally(() => setSearching(false))
    }
    const openPlaylist = (id) => {
      setPlLoading(true)
      setPlDetail(null)
      api('playlistDetail', { id }).then((r) => setPlDetail(r.playlist)).catch((e) => showToast(e.message)).finally(() => setPlLoading(false))
    }
    const openAlbum = (id) => {
      setPlLoading(true)
      setPlDetail(null)
      api('albumDetail', { id }).then((r) => setPlDetail(r.album)).catch((e) => showToast(e.message)).finally(() => setPlLoading(false))
    }
    const closePlaylist = () => setPlDetail(null)
    const startQr = () => {
      setQrBusy(true)
      api('qrCreate').then((r) => setQr({ unikey: r.unikey, grid: r.grid || [], status: 'wait', msg: '请用网易云音乐 App 扫一扫' })).catch((e) => setQr({ status: 'error', msg: '获取二维码失败: ' + e.message })).finally(() => setQrBusy(false))
    }
    useEffect(() => {
      if (!qr || qr.status !== 'wait') return undefined
      let disposed = false
      let polls = 0
      let disposer = null
      const stop = () => { if (disposer) { try { disposer() } catch (e) { } } }
      const tick = () => {
        polls += 1
        if (polls > 48) { setQr((q) => q ? Object.assign({}, q, { status: 'expired', msg: '二维码已过期, 请重新获取' }) : q); stop(); return }
        api('qrCheck', { key: qr.unikey }).then((r) => {
          if (disposed) return
          if (r.code === 803) {
            applyAccount({ uid: r.account.uid, nickname: r.account.nickname, hasCookie: true, persisted: true })
            // 二维码登录的 cookie 由 host 侧合并，client 需向 host 导出一次再落 localStorage。
            api('exportAccount').then((a) => {
              if (!a || !a.cookie) return
              accountCookieRef.current = a
              lsWrite({ account: a, state: buildState() })
            }).catch(() => { })
            setQr((q) => q ? Object.assign({}, q, { status: 'done', msg: '登录成功: ' + r.account.nickname }) : q)
            setCookieDraft('')
            showToast('登录成功: ' + r.account.nickname)
            stop()
          } else if (r.code === 800) {
            setQr((q) => q ? Object.assign({}, q, { status: 'expired', msg: '二维码已失效' }) : q)
            stop()
          } else {
            setQr((q) => q ? Object.assign({}, q, { msg: r.message || '等待扫码...' }) : q)
          }
        }).catch((e) => { if (!disposed) showToast(e.message) })
      }
      disposer = timer.interval(tick, 2500)
      return () => { disposed = true; stop() }
    }, [qr && qr.unikey, qr && qr.status])

    const saveCookie = () => {
      const c = cookieDraft.trim()
      if (!c) { showToast('请先粘贴 Cookie'); return }
      api('setAccount', { cookie: c }).then((r) => {
        applyAccount({ uid: r.uid, nickname: r.nickname, hasCookie: true, persisted: true })
        setCookieDraft('')
        api('exportAccount').then((a) => {
          if (!a || !a.cookie) return
          accountCookieRef.current = a
          lsWrite({ account: a, state: buildState() })
        }).catch(() => { })
        showToast('登录成功: ' + r.nickname)
      }).catch((e) => showToast(e.message))
    }
    const clearAccount = () => {
      api('clearAccount').then(() => {
        applyAccount({ uid: null, nickname: '', hasCookie: false, persisted: false })
        accountCookieRef.current = null
        // 只清除账号,播放队列继续保留在 localStorage。
        lsWrite({ account: null, state: buildState() })
        setLikedIds(null); setMyPls([]); setMyAlbums([])
        showToast('已清除账号')
      }).catch((e) => showToast(e.message))
    }

    const onHeaderDown = (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const w = window.innerWidth
      const hh = window.innerHeight
      const cur = posRef.current || defaultPos() || { x: 12, y: 12 }
      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: cur.x, oy: cur.y, w, hh }
      window.addEventListener('pointermove', onDragMove)
      window.addEventListener('pointerup', onDragUp)
    }
    const onMiniDown = (e) => {
      if (e.button !== 0) return
      if (e.target && e.target.closest && e.target.closest('button')) return
      onHeaderDown(e)
    }
    const onDragMove = (e) => {
      const d = dragRef.current
      if (!d) return
      const bw = 360
      let x = Math.round(d.ox + e.clientX - d.sx)
      let y = Math.round(d.oy + e.clientY - d.sy)
      x = Math.min(Math.max(x, 60 - bw), d.w - 60)
      y = Math.min(Math.max(y, 0), d.hh - 48)
      setPos({ x, y })
    }
    const onDragUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onDragUp)
    }
    // 从迷你条展开：若当前 y 太靠下会超出视口，先上移再展开。
    const expandWindow = () => {
      const cur = posRef.current
      if (cur) {
        const hh = window.innerHeight
        if (cur.y + WIN_H + 14 > hh) setPos({ x: cur.x, y: Math.max(8, hh - WIN_H - 14) })
      }
      setMini(false)
    }
    // 从右下角音符按钮打开：展开完整窗口（同样先上移防溢出）。
    const openWindow = () => {
      expandWindow()
      setVisible(true)
    }

    // --- ncm-player4 新功能 1：右下角音符按钮随音乐节奏跳动 ---
    // 只有在「音频本当播放，但界面已退出为音符按钮」时才需要驱动节奏：
    // 窗口/迷你条打开时图标不可见，不做无谓的计算。
    const beating = !visible && playing
    // 触发一「拍」：换 key 让 CSS 动画重放；最小间隔 BEAT.pulse 兜底防抖。
    const fireBeat = (strength, strong, nowMs) => {
      if (nowMs - lastPulseMsRef.current < BEAT.pulse * 0.6) return
      lastPulseMsRef.current = nowMs
      beatKeyRef.current += 1
      const p = pulseParams(strength, strong)
      setRhythm({ key: beatKeyRef.current, scale: p.scale, glow: p.glow, dur: p.dur })
    }
    useEffect(() => {
      if (!beating) { setRhythm(null); return undefined }
      const raf = window.requestAnimationFrame
      const caf = window.cancelAnimationFrame
      if (!raf) return undefined
      if (!rhythmEngineRef.current) rhythmEngineRef.current = createRhythmEngine()
      const engine = rhythmEngineRef.current
      const audioEl = audioRef.current
      // 接线可能因「上下文挂起 / 地址未走 CORS」被推迟：先不接，靠固定心跳顶上，
      // 之后每 500ms 重试一次，条件一满足就自动切到真实鼓点。
      let attached = !!(engine && audioEl && engine.attach(audioEl))
      let nextTryAt = attached ? 0 : performance.now() + 500
      if (!attached && engine) engine.resume()
      if (!detRef.current) detRef.current = new RhythmDetector()
      else detRef.current.reset()
      const det = detRef.current
      let id = 0
      let alive = true
      let lastTickAt = 0
      const loop = (t) => {
        if (!alive) return
        const now = typeof t === 'number' ? t : performance.now()
        let fired = false
        // 每 500ms 自检一次：上下文被系统挂起就唤醒；未接线且条件满足就补接线。
        // （接线后元素的声音完全由 AudioContext 输出，上下文一挂起就是全静音。）
        // 元素可能被换掉（见 onAudioError 的 audioGen），所以每次都重新取。
        if (engine && now >= nextTryAt) {
          nextTryAt = now + 500
          const cur = audioRef.current
          if (attached && engine.attached !== cur) attached = false
          if (attached && engine.ac && engine.ac.state !== 'running') engine.resume()
          else if (!attached && cur) attached = !!engine.attach(cur)
        }
        if (attached) {
          const f = engine.read()
          if (f) {
            const r = det.step(f.e, f.rms, now)
            if (r.hit) { fireBeat(r.strength, true, now); fired = true }
            else if (det.tick(now)) { fireBeat(0.45, false, now); fired = true } // 无鼓点段按 BPM 补拍
            setBpm((prev) => (prev === det.bpm ? prev : det.bpm))
          }
        }
        // 静止期把状态更新降到 BEAT.fps 一次，避免每帧都让 React 重渲染。
        if (!fired && now - lastTickAt > 1000 / BEAT.fps) lastTickAt = now
        id = raf(loop)
      }
      id = raf(loop)
      return () => { alive = false; if (id) caf(id) }
    }, [beating])

    // 播放状态变化时唤醒被浏览器自动挂起的 AudioContext（用户点击后即可恢复）。
    useEffect(() => {
      if (!playing) return
      const engine = rhythmEngineRef.current
      if (engine) engine.resume()
    }, [playing])

    // --- ncm-player4 新功能 2：右下角音符按钮支持左键长按拖动 ---
    // 交互：按住左键 → 未满 DISC_DRAG.holdMs 松开 = 点击（打开播放窗口）；
    //       按住超过 DISC_DRAG.holdMs 或移动超过 8px = 进入拖动，松开时把位置存进
    //       localStorage。拖动期间屏蔽紧随其后的 click，避免"拖完又弹出窗口"。
    const clampDisc = (x, y) => {
      const w = window.innerWidth
      const h = window.innerHeight
      const m = DISC_DRAG.margin
      const s = DISC_DRAG.size
      return {
        x: Math.round(Math.min(Math.max(x, m), w - s - m)),
        y: Math.round(Math.min(Math.max(y, m), h - s - m)),
      }
    }
    const defaultDiscPos = () => (typeof window === 'undefined' ? { x: 18, y: 18 } : { x: window.innerWidth - DISC_DRAG.size - 18, y: window.innerHeight - DISC_DRAG.size - 18 })
    const onDiscPointerDown = (e) => {
      if (e.button !== 0) return
      // 阻止浏览器原生拖拽图片 / 选中文本，否则指针事件会被接管，长按拖动失效。
      e.preventDefault()
      const el = discElRef.current
      const r = el ? el.getBoundingClientRect() : null
      const cur = discPosRef.current || (r ? { x: r.left, y: r.top } : defaultDiscPos())
      discDragRef.current = {
        sx: e.clientX, sy: e.clientY,
        ox: cur.x, oy: cur.y,
        moved: false, started: false,
        movedPx: 0,
      }
      if (el) el.classList.add('holding')
      try { if (el && el.setPointerCapture) el.setPointerCapture(e.pointerId) } catch (err) { }
      window.addEventListener('pointermove', onDiscPointerMove)
      window.addEventListener('pointerup', onDiscPointerUp)
    }
    const onDiscPointerMove = (e) => {
      const d = discDragRef.current
      if (!d) return
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      d.movedPx = Math.max(d.movedPx, Math.abs(dx) + Math.abs(dy))
      // 长按或明显位移都进入拖动（鼠标用户习惯直接拖，长按用户习惯按住再拖）。
      if (!d.started && (d.movedPx > 8)) d.started = true
      if (!d.started) return
      d.moved = true
      e.preventDefault()
      setDiscPos(clampDisc(d.ox + dx, d.oy + dy))
    }
    const onDiscPointerUp = (e) => {
      const d = discDragRef.current
      discDragRef.current = null
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
      window.removeEventListener('pointermove', onDiscPointerMove)
      window.removeEventListener('pointerup', onDiscPointerUp)
      const el = discElRef.current
      if (el) {
        el.classList.remove('holding')
        el.classList.remove('dragging')
        el.classList.remove('lifted')
        try { if (el.releasePointerCapture && e && e.pointerId !== undefined) el.releasePointerCapture(e.pointerId) } catch (err) { }
      }
      if (d && d.started) {
        // 拖过就别再触发 click 打开窗口
        suppressClickRef.current = true
        const p = discPosRef.current
        if (p) { try { localStorage.setItem(DISC_POS_KEY, JSON.stringify(p)) } catch (err) { } }
      }
    }
    // 长按：按住 holdMs 后进入拖动模式（视觉上抬起），之后移动即为拖动。
    // 计时器必须归属于单次 pointerdown/up（而不是依赖某段闭包），否则打拍状态一变
    // 或音频回退时监听被重挂，长按中途就被清掉了。
    useEffect(() => {
      const el = discElRef.current
      if (!el) return undefined
      const clear = () => {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
      }
      const onDown = (e) => {
        if (e.button !== 0) return
        clear()
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null
          const d = discDragRef.current
          if (!d || d.started) return
          d.started = true
          d.moved = true
          const node = discElRef.current
          if (node) { node.classList.remove('holding'); node.classList.add('dragging', 'lifted') }
        }, DISC_DRAG.holdMs)
      }
      const onUp = () => clear()
      el.addEventListener('pointerdown', onDown)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      return () => {
        clear()
        el.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    }, [])
    useEffect(() => () => {
      window.removeEventListener('pointermove', onDiscPointerMove)
      window.removeEventListener('pointerup', onDiscPointerUp)
    }, [])
    // 点击进入：刚结束拖动的那次 click 直接吞掉。
    const onDiscClick = () => {
      if (suppressClickRef.current) { suppressClickRef.current = false; return }
      openWindow()
    }

    // --- ncm-player2 新功能：点击播放窗口外即收起为迷你条 ---
    // 与 header「-」收起按钮等价：都只是 setMini(true)，播放不中断，
    // 迷你条仍显示封面/歌名/歌词，右下角还保留 展开/播放/下一首 三个按钮。
    // 只在「完整窗口已展开」时监听；折叠为迷你条或隐藏为音符按钮时自动摘除。
    const onDocPointerDown = (e) => {
      if (e.button !== 0) return
      // 拖拽窗口进行中：pointerdown 落在 header 上，不能误判为「窗口外」触发收起。
      if (dragRef.current) return
      const win = winRef.current
      if (win && e.target && e.target.nodeType === 1 && win.contains(e.target)) return
      setMini(true)
    }
    useEffect(() => {
      if (!visible || mini) return
      document.addEventListener('pointerdown', onDocPointerDown, true)
      return () => { document.removeEventListener('pointerdown', onDocPointerDown, true) }
    }, [visible, mini])

    // --- ncm-player3 新功能 1：播放界面无操作 3 秒自动退出 ---
    // 界面被"最小化"成迷你条(visible && mini)后，若 IDLE_AUTO_EXIT_MS 内没有任何
    // 鼠标点击/移动（键盘、滚轮、触摸同样算"有操作"），自动触发 header「×」退出
    // 按钮——即 setVisible(false)，隐藏为右下角音符按钮，播放不中断。
    // 在设置里可关闭该行为(autoExit=false)；拖拽窗口过程中暂停计时。
    useEffect(() => {
      if (!visible || !mini || !autoExit) return undefined
      let idleId = null
      const clear = () => { if (idleId !== null) { clearTimeout(idleId); idleId = null } }
      const onActivity = () => {
        // 拖拽窗口会产生 pointermove/pointerup，但那不是"用户在界面上操作"，不重置。
        if (dragRef.current) return
        clear()
        idleId = setTimeout(() => { idleId = null; setVisible(false) }, IDLE_AUTO_EXIT_MS)
      }
      onActivity()
      for (const t of EVENT_TARGETS) {
        for (const ev of ACTIVITY_EVENTS) t.addEventListener(ev, onActivity)
      }
      return () => {
        clear()
        for (const t of EVENT_TARGETS) {
          for (const ev of ACTIVITY_EVENTS) t.removeEventListener(ev, onActivity)
        }
      }
    }, [visible, mini, autoExit])

    let activeIdx = -1
    if (song && lyrics.length) {
      for (let i = 0; i < lyrics.length; i++) { if (lyrics[i].t <= time + 250) activeIdx = i; else break }
    }
    const lyricBoxRef = useRef(null)
    useEffect(() => {
      if (activeIdx < 0 || tab !== 'lyric') return
      const box = lyricBoxRef.current
      if (!box) return
      const el = box.querySelector('.ncm-lrc-line.active')
      if (!el) return
      const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }, [activeIdx, tab])

    // mini 模式歌词跑马灯：文本超出迷你条宽度时横向滚动（可通过设置关闭/调字号）。
    const miniLrcRef = useRef(null)
    const [miniLrcMq, setMiniLrcMq] = useState(null)
    useEffect(() => {
      const el = miniLrcRef.current
      const parent = el && el.parentElement
      if (!el || !parent || !miniLrcScroll) { setMiniLrcMq(null); return }
      if (el.scrollWidth > parent.clientWidth + 2) {
        const dist = el.scrollWidth - parent.clientWidth + 16
        const dur = Math.max(6, Math.round(dist / 14)) + 's'
        setMiniLrcMq({ dist: -dist + 'px', dur })
      } else {
        setMiniLrcMq(null)
      }
    }, [activeIdx, mini, showMiniLrc, miniLrcScroll, miniLrcSize])

    const songRow = (s, i, onPlay, onAdd) => h('div', { key: 's' + s.id + '_' + i, className: 'ncm-row' + (song && song.id === s.id ? ' cur' : ''), onClick: onPlay }, [
      s.cover ? h('img', { className: 'ncm-cover', src: s.cover, onError: hideImg }) : h('div', { className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.music, size: 14 })),
      h('span', { className: 'ncm-row-idx' }, String(i + 1)),
      h('div', { className: 'ncm-row-info' }, [
        h('div', { className: 'ncm-row-name' }, s.name),
        h('div', { className: 'ncm-row-sub' }, s.artists || s.album || ''),
      ]),
      h('span', { className: 'ncm-row-side' }, s.duration ? fmt(s.duration) : ''),
      h('button', { className: 'ncm-icobtn ncm-add', title: '加入队列', onClick: (e) => { e.stopPropagation(); onAdd() } }, h(Ico, { d: ICONS.plus, size: 14 })),
    ])
    const plRow = (p) => h('div', { key: 'p' + p.id, className: 'ncm-row', onClick: () => openPlaylist(p.id) }, [
      p.cover ? h('img', { className: 'ncm-cover', src: p.cover, onError: hideImg }) : h('div', { className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.list, size: 16 })),
      h('div', { className: 'ncm-row-info' }, [
        h('div', { className: 'ncm-row-name' }, p.name),
        h('div', { className: 'ncm-row-sub' }, (p.creator ? p.creator + ' · ' : '') + (p.trackCount || 0) + ' 首'),
      ]),
    ])
    const albumRow = (a) => h('div', { key: 'a' + a.id, className: 'ncm-row', onClick: () => openAlbum(a.id) }, [
      a.cover ? h('img', { className: 'ncm-cover', src: a.cover, onError: hideImg }) : h('div', { className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.disc, size: 16 })),
      h('div', { className: 'ncm-row-info' }, [
        h('div', { className: 'ncm-row-name' }, a.name),
        h('div', { className: 'ncm-row-sub' }, (a.artist ? a.artist + ' · ' : '') + (a.trackCount || 0) + ' 首'),
      ]),
    ])
    const mkTab = (id, label) => {
      const icon = id === 'play' ? ICONS.disc : id === 'lyric' ? ICONS.lrc : id === 'list' ? ICONS.list : id === 'queue' ? ICONS.queue : ICONS.gear
      return h('button', { key: id, className: 'ncm-tab' + (tab === id ? ' active' : ''), onClick: () => setTab(id) }, [
        h(Ico, { d: icon, size: 15 }),
        h('span', null, label),
      ])
    }

    const playView = h('div', { className: 'ncm-play' }, [
      song && song.cover ? h('img', { key: 'cov', className: 'ncm-cover', src: song.cover, onError: hideImg }) : h('div', { key: 'covph', className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.music, size: 40 })),
      h('div', { className: 'ncm-now' }, [
        h('div', { className: 'ncm-now-name' }, song ? song.name : '未在播放'),
        h('div', { className: 'ncm-now-art' }, song ? (song.artists + (song.album ? ' · ' + song.album : '')) : '在歌单或搜索结果中点一首歌开始'),
      ]),
      h('div', { className: 'ncm-progrow' }, [
        h('span', null, fmt(time)),
        h('input', { className: 'ncm-range', type: 'range', min: 0, max: dur || 1, step: 1, value: Math.min(time, dur || 0), disabled: !song, onChange: (e) => seek(Number(e.target.value)) }),
        h('span', null, fmt(dur)),
      ]),
      h('div', { className: 'ncm-ctlrow' }, [
        h('button', { className: 'ncm-ctl ncm-mode' + (mode !== 'order' ? ' on' : ''), title: mode === 'order' ? '顺序播放(点击切到单曲循环)' : mode === 'loop' ? '单曲循环(点击切到随机)' : '随机播放(点击切回顺序)', onClick: () => setMode(mode === 'order' ? 'loop' : mode === 'loop' ? 'shuffle' : 'order') }, [
          h('span', { className: 'ncm-mode-ico' }, h(Ico, { d: mode === 'shuffle' ? ICONS.shuffle : ICONS.repeat, size: 18 })),
          mode === 'loop' ? h('span', { className: 'ncm-mode-1' }, '1') : null,
          h('span', { className: 'ncm-mode-txt' }, mode === 'order' ? '顺序' : mode === 'loop' ? '单曲' : '随机'),
        ]),
        h('button', { className: 'ncm-ctl', onClick: prev, title: '上一首' }, h(Ico, { d: ICONS.prev, size: 20 })),
        h('button', { className: 'ncm-ctl main', onClick: toggle, title: playing ? '暂停' : '播放', disabled: !song }, h(Ico, { d: playing ? ICONS.pause : ICONS.play, size: 24, fill: true })),
        h('button', { className: 'ncm-ctl', onClick: next, title: '下一首' }, h(Ico, { d: ICONS.next, size: 20 })),
        account && account.uid
          ? h('button', { className: 'ncm-ctl' + (liked ? ' on' : ''), onClick: toggleLike, title: liked ? '取消收藏' : '收藏', disabled: likeBusy }, h(Ico, { d: ICONS.heart, size: 18, fill: liked }))
          : h('button', { className: 'ncm-ctl', onClick: () => setTab('settings'), title: '登录后可收藏' }, h(Ico, { d: ICONS.heart, size: 18 })),
      ]),
      h('div', { className: 'ncm-ctlbottom' }, [
        h('div', { className: 'ncm-volrow' }, [
          h('button', { className: 'ncm-icobtn', onClick: toggleMute, title: muted ? '取消静音' : '静音' }, h(Ico, { d: muted || vol === 0 ? ICONS.volx : ICONS.vol, size: 16 })),
          h('input', { className: 'ncm-range', type: 'range', min: 0, max: 1, step: 0.01, value: muted ? 0 : vol, onChange: (e) => onVol(Number(e.target.value)) }),
        ]),
        loading ? h('span', { className: 'ncm-hint' }, '加载中...') : h('span', { className: 'ncm-hint' }, ''),
      ]),
    ])

    const lyricView = h('div', { className: 'ncm-scroll ncm-lrc', ref: lyricBoxRef },
      lyrics.length === 0
        ? h('div', { className: 'ncm-lrc-empty' }, song ? (loading ? '歌词加载中...' : '暂无歌词') : '播放歌曲后显示歌词')
        : lyrics.map((line, i) => h('div', { key: i, className: 'ncm-lrc-line' + (i === activeIdx ? ' active' : ''), onClick: () => seek(line.t) }, [
          h('div', null, line.text),
          showTrans && line.tr ? h('div', { className: 'ncm-lrc-tr' }, line.tr) : null,
        ])))

    const fav = myPls.find((p) => p.specialType === 5)
    const ownPls = myPls.filter((p) => !p.subscribed && p.specialType !== 5)
    const subPls = myPls.filter((p) => p.subscribed)
    const listView = h('div', null, [
      plDetail ? null : h('div', { className: 'ncm-listhead' }, [
        h('div', { className: 'ncm-seg' }, [
          h('button', { className: listScope === 'discover' ? 'on' : '', onClick: () => setListScope('discover') }, '发现'),
          h('button', { className: listScope === 'mine' ? 'on' : '', onClick: () => setListScope('mine') }, '我的'),
        ]),
      ]),
      plDetail
        ? h('div', { className: 'ncm-scroll' }, [
          h('div', { className: 'ncm-detailhead' }, [
            h('button', { className: 'ncm-icobtn', onClick: closePlaylist, title: '返回' }, h(Ico, { d: ICONS.back })),
            plDetail.cover ? h('img', { className: 'ncm-cover', src: plDetail.cover, onError: hideImg }) : h('div', { className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.list, size: 20 })),
            h('div', { className: 'ncm-row-info' }, [
              h('div', { className: 'ncm-row-name', style: { fontWeight: 600 } }, plDetail.name),
              h('div', { className: 'ncm-row-sub' }, (plDetail.artist ? plDetail.artist + ' · ' : '') + plDetail.tracks.length + ' 首'),
            ]),
            h('button', { className: 'ncm-btn', onClick: () => playFrom(plDetail.tracks, 0) }, '播放'),
          ]),
          plLoading ? h('div', { className: 'ncm-loading' }, '加载中...')
            : plDetail.tracks.length === 0 ? h('div', { className: 'ncm-loading' }, '暂无歌曲')
            : plDetail.tracks.map((s, i) => songRow(s, i, () => playFrom(plDetail.tracks, i), () => addToQueue(s))),
        ])
        : listScope === 'discover'
          ? h('div', { className: 'ncm-scroll', style: { top: 42 } }, [
            h('div', { className: 'ncm-listsearch' }, [
              h('input', { className: 'ncm-input', placeholder: searchType === 1 ? '搜索单曲...' : searchType === 10 ? '搜索专辑...' : '搜索歌单...', value: searchKw, onChange: (e) => setSearchKw(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') doSearch() } }),
              h('div', { className: 'ncm-seg' }, [
                h('button', { className: searchType === 1 ? 'on' : '', onClick: () => setSearchType(1) }, '单曲'),
                h('button', { className: searchType === 1000 ? 'on' : '', onClick: () => setSearchType(1000) }, '歌单'),
                h('button', { className: searchType === 10 ? 'on' : '', onClick: () => setSearchType(10) }, '专辑'),
              ]),
              h('button', { className: 'ncm-btn', onClick: doSearch, disabled: searching }, '搜索'),
              searchRes ? h('button', { className: 'ncm-icobtn', title: '清除搜索, 返回热门', onClick: () => setSearchRes(null) }, h(Ico, { d: ICONS.x, size: 14 })) : null,
            ]),
            searching ? h('div', { className: 'ncm-loading' }, '搜索中...') : null,
            searchRes && searchRes.songs.length === 0 && searchRes.playlists.length === 0 && (!searchRes.albums || searchRes.albums.length === 0) ? [
              h('div', { key: 'nores', className: 'ncm-loading' }, [
                h('div', null, '未找到相关结果'),
                h('button', { className: 'ncm-btn ghost', style: { marginTop: 10 }, onClick: () => setSearchRes(null) }, '返回热门'),
              ]),
            ] : null,
            searchRes && searchRes.songs.length > 0 ? [
              h('div', { key: 'sec1', className: 'ncm-sec' }, '搜索结果'),
              searchRes.songs.map((s, i) => songRow(s, i, () => playFrom(searchRes.songs, i), () => addToQueue(s))),
            ] : null,
            searchRes && searchRes.playlists.length > 0 ? [
              h('div', { key: 'sec2', className: 'ncm-sec' }, '搜索结果'),
              searchRes.playlists.map((p) => plRow(p)),
            ] : null,
            searchRes && searchRes.albums && searchRes.albums.length > 0 ? [
              h('div', { key: 'seca', className: 'ncm-sec' }, '搜索结果'),
              searchRes.albums.map((a) => albumRow(a)),
            ] : null,
            !searchRes ? [
              h('div', { key: 'sec3', className: 'ncm-sec' }, '热门歌单'),
              hot.length === 0 ? h('div', { key: 'hotload', className: 'ncm-loading' }, '加载中...') : hot.map((p) => plRow(p)),
            ] : null,
          ])
          : h('div', { className: 'ncm-scroll', style: { top: 42 } }, [
            account && account.uid ? [
              h('div', { key: 'sec4', className: 'ncm-sec' }, '我的音乐'),
              h('div', { key: 'mytab', className: 'ncm-seg', style: { margin: '0 12px 8px' } }, [
                h('button', { className: myTab === 'mine' ? 'on' : '', onClick: () => setMyTab('mine') }, '创建'),
                h('button', { className: myTab === 'sub' ? 'on' : '', onClick: () => setMyTab('sub') }, '收藏'),
                h('button', { className: myTab === 'liked' ? 'on' : '', onClick: () => setMyTab('liked') }, '喜欢'),
                h('button', { className: myTab === 'albums' ? 'on' : '', onClick: () => setMyTab('albums') }, '专辑'),
              ]),
              myTab === 'albums'
                ? (myAlbums.length === 0 ? h('div', { key: 'aempty', className: 'ncm-loading' }, '暂无收藏的专辑') : myAlbums.map((a) => albumRow(a)))
                : myTab === 'liked'
                  ? (fav ? plRow(fav) : h('div', { key: 'fempty', className: 'ncm-loading' }, '未找到"我喜欢的音乐"'))
                  : myTab === 'sub'
                    ? (subPls.length === 0 ? h('div', { key: 'sempty', className: 'ncm-loading' }, '暂无收藏的歌单') : subPls.map((p) => plRow(p)))
                    : (ownPls.length === 0 ? h('div', { key: 'oempty', className: 'ncm-loading' }, '暂无创建的歌单') : ownPls.map((p) => plRow(p))),
            ] : [
              h('div', { key: 'nologin', className: 'ncm-loading' }, '登录后可查看我的音乐'),
              h('div', { key: 'nologinbtn', style: { textAlign: 'center', paddingBottom: 20 } }, h('button', { className: 'ncm-btn ghost', onClick: () => setTab('settings') }, '去登录')),
            ],
          ]),
    ])

    const queueView = h('div', null, [
      h('div', { className: 'ncm-queuehead' }, [
        h('span', null, '播放队列 (' + queue.length + ')'),
        h('span', { className: 'sp' }),
        h('button', { className: 'ncm-btn ghost', onClick: clearQueue, disabled: queue.length === 0 }, '清空'),
      ]),
      h('div', { className: 'ncm-scroll', style: { top: 40 } },
        queue.length === 0
          ? h('div', { className: 'ncm-loading' }, '队列为空')
          : queue.map((s, i) => h('div', { key: 'q' + s.id + '_' + i, className: 'ncm-row' + (i === index ? ' cur' : ''), onClick: () => playAt(i) }, [
            s.cover ? h('img', { className: 'ncm-cover', src: s.cover, onError: hideImg }) : h('div', { className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.music, size: 14 })),
            h('span', { className: 'ncm-row-idx' }, i === index ? (playing ? '▶' : '⏸') : String(i + 1)),
            h('div', { className: 'ncm-row-info' }, [
              h('div', { className: 'ncm-row-name' }, s.name),
              h('div', { className: 'ncm-row-sub' }, s.artists),
            ]),
            h('span', { className: 'ncm-row-side' }, s.duration ? fmt(s.duration) : ''),
            h('button', { className: 'ncm-icobtn', title: '移除', onClick: (e) => { e.stopPropagation(); removeFromQueue(i) } }, h(Ico, { d: ICONS.trash, size: 14 })),
          ]))),
    ])

    const settingsView = h('div', { className: 'ncm-scroll' }, [
      h('div', { className: 'ncm-set' }, [
        h('div', { className: 'ncm-set-sec' }, [
          h('div', { className: 'ncm-set-title' }, [h(Ico, { d: ICONS.disc, size: 14 }), h('span', null, '账号')]),
          account && account.uid
            ? h('div', { className: 'ncm-row-info', style: { marginBottom: 8 } }, [
              h('div', { className: 'ncm-row-name' }, '已登录: ' + account.nickname),
              h('div', { className: 'ncm-row-sub' }, account.hasCookie ? (account.persisted ? '登录态已保存在本机浏览器' : '登录态未持久化(浏览器存储不可用)') : '未配置 Cookie'),
            ])
            : h('div', { className: 'ncm-row-sub', style: { marginBottom: 8 } }, '未登录。粘贴 Cookie 或扫码登录后可查看"我的音乐"并使用收藏功能。'),
          h('textarea', { className: 'ncm-input ncm-cookie', rows: 3, placeholder: '粘贴 Cookie(需包含 MUSIC_U=...) 获取: 浏览器登录 music.163.com 后 F12 → 应用/Application → Cookie 复制整串', value: cookieDraft, onChange: (e) => setCookieDraft(e.target.value) }),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } }, [
            h('button', { className: 'ncm-btn', onClick: saveCookie }, '保存并登录'),
            h('button', { className: 'ncm-btn ghost', onClick: startQr, disabled: qrBusy || (qr && qr.status === 'wait') }, '扫码登录'),
            account && account.uid ? h('button', { className: 'ncm-btn ghost', onClick: clearAccount }, '退出登录') : null,
          ]),
          qr ? h('div', { className: 'ncm-qr', style: { marginTop: 10 } }, [
            qr.status === 'wait' || qr.status === 'done' ? h(QrCanvas, { key: 'qrc', grid: qr.grid, size: 148 }) : null,
            h('div', { className: 'ncm-hint' }, qr.msg),
            qr.status === 'wait' ? h('button', { className: 'ncm-btn ghost', onClick: () => setQr(null) }, '取消') : null,
            qr.status === 'expired' || qr.status === 'error' ? h('button', { className: 'ncm-btn ghost', onClick: startQr }, '重新获取') : null,
          ]) : null,
        ]),
        h('div', { className: 'ncm-set-sec' }, [
          h('div', { className: 'ncm-set-title' }, [h(Ico, { d: ICONS.gear, size: 14 }), h('span', null, '播放')]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '音质'),
            h('select', { className: 'ncm-select', value: quality, onChange: (e) => setQuality(Number(e.target.value)) }, [
              h('option', { value: 128000 }, '标准 128k'),
              h('option', { value: 320000 }, '高品质 320k'),
            ]),
          ]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '显示歌词翻译'),
            h('input', { type: 'checkbox', checked: showTrans, onChange: (e) => setShowTrans(e.target.checked) }),
          ]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '迷你模式显示歌词'),
            h('input', { type: 'checkbox', checked: showMiniLrc, onChange: (e) => setShowMiniLrc(e.target.checked) }),
          ]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '迷你歌词滚动'),
            h('input', { type: 'checkbox', checked: miniLrcScroll, onChange: (e) => setMiniLrcScroll(e.target.checked) }),
          ]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '无操作自动退出'),
            h('input', { type: 'checkbox', checked: autoExit, onChange: (e) => setAutoExit(e.target.checked) }),
          ]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '自动跳过不可播放的歌曲'),
            h('input', { type: 'checkbox', checked: autoSkip, onChange: (e) => setAutoSkip(e.target.checked) }),
          ]),
          h('div', { className: 'ncm-toggle' }, [
            h('label', null, '迷你歌词字号'),
            h('select', { className: 'ncm-select', value: miniLrcSize, onChange: (e) => setMiniLrcSize(Number(e.target.value)) }, [
              h('option', { value: 9 }, '小 9'),
              h('option', { value: 11 }, '中 11'),
              h('option', { value: 13 }, '大 13'),
            ]),
          ]),
        ]),
        h('div', { className: 'ncm-set-sec' }, [
          h('div', { className: 'ncm-set-title' }, [h(Ico, { d: ICONS.lrc, size: 14 }), h('span', null, '说明')]),
          h('div', { className: 'ncm-hint' }, '· 播放/搜索/歌词无需登录; "我的音乐"与收藏需要登录。\n· Cookie 仅用于请求 music.163.com, 不发送给任何第三方。\n· 登录态与播放队列保存在本机浏览器(localStorage), 不再写入 ~/.dsh 文件。\n· 界面颜色跟随当前皮肤主题。\n· 播放界面无操作 3 秒会自动隐藏为右下角按钮(播放不中断), 可在上面关闭。\n· 退出后若仍在播放, 右下角按钮会跟着音乐节奏跳动(检测到鼓点就跳, 强弱随音乐)。\n· 右下角按钮支持左键长按拖动, 位置会自动记住。\n· 遇到因下架/无版权而无法播放的歌曲会自动跳过, 播放下一首(可在上面关闭)。'),
        ]),
      ]),
    ])

    const p = pos || defaultPos() || { x: 8, y: 8 }
    const winStyle = { left: p.x + 'px', top: p.y + 'px' }
    // 音符按钮位置：拖过就用保存的位置（拖拽/窗口尺寸变化都夹在视口内），否则默认右下角。
    const dp = discPos ? clampDisc(discPos.x, discPos.y) : defaultDiscPos()
    const discStyle = { left: dp.x + 'px', top: dp.y + 'px', right: 'auto', bottom: 'auto' }
    const ringStyle = { left: dp.x + 'px', top: dp.y + 'px', right: 'auto', bottom: 'auto' }
    // 节奏驱动：有 rhythm 时用 pulse（每拍换一次 key 重放）；没有（Web Audio 不可用）时退回固定心跳。
    const usePulse = beating && rhythm
    const pulseStyle = usePulse
      ? Object.assign({}, discStyle, { '--ncm-scale': rhythm.scale, '--ncm-hit': '0.94', '--ncm-beat-dur': rhythm.dur + 'ms' })
      : discStyle
    const ringSplashStyle = usePulse
      ? Object.assign({}, ringStyle, { '--ncm-glow': rhythm.glow, '--ncm-splash-dur': Math.round(rhythm.dur * 1.7) + 'ms' })
      : ringStyle
    return h('div', { className: 'ncm-wrap' }, [
      h('audio', { key: 'au-' + audioGen, ref: audioRef, preload: 'auto', onTimeUpdate: onTimeUpdate, onLoadedMetadata: onLoadedMetadata, onEnded: onEnded, onError: onAudioError, onPlay: () => { resetSkipGuard(); setPlaying(true) }, onPause: () => { setPlaying(false); saveNow() } }),
      toast ? h('div', { key: 'toast', className: 'ncm-toast' }, toast.msg) : null,
      // --- ncm-player4 新功能 1：右下角音符按钮随音乐节奏跳动 ---
      // 界面已退出(visible=false)且音频仍在播放时：每检测到一个低频鼓点就扩散一圈光环
      // 并按该拍的强度做一次「蓄力→弹大→回落」脉冲；暂停时静止。
      usePulse
        ? h('div', { key: 'ring' + rhythm.key, className: 'ncm-disc-ring splash', style: ringSplashStyle, 'aria-hidden': true })
        : null,
      beating && !usePulse
        ? h('div', { key: 'ring', className: 'ncm-disc-ring beat', style: ringStyle, 'aria-hidden': true })
        : null,
      beating && !usePulse
        ? h('div', { key: 'ring2', className: 'ncm-disc-ring beat d2', style: ringStyle, 'aria-hidden': true })
        : null,
      !visible
        ? h('button', {
          // 节奏模式下每次鼓点换 key 重放 ncm-pulse；但换 key 会重建节点，
          // 会打断拖拽——所以处于按住/拖动状态时保持同一个 key。
          key: usePulse ? 'disc-p' + (discDragRef.current ? 'hold' : rhythm.key) : 'disc',
          ref: discElRef,
          className: 'ncm-disc' + (usePulse ? ' pulse' : (beating ? ' beat' : '')),
          style: pulseStyle,
          title: beating
            ? '正在播放 · 点击打开网易云音乐（按住左键可拖动）'
            : '打开网易云音乐（按住左键可拖动）',
          onPointerDown: onDiscPointerDown,
          onClick: onDiscClick,
        }, h(Ico, { d: ICONS.music, size: 22 }))
        : mini
          ? h('div', { key: 'mini', className: 'ncm-win mini ncm-mini', style: winStyle, onPointerDown: onMiniDown }, [
            song && song.cover ? h('img', { className: 'ncm-cover', src: song.cover, onError: hideImg }) : h('div', { className: 'ncm-cover ncm-coverph' }, h(Ico, { d: ICONS.music, size: 18 })),
            h('div', { className: 'ncm-mini-info' }, [
              h('div', { className: 'ncm-mini-name' }, song ? song.name : '未在播放'),
              h('div', { className: 'ncm-mini-art' }, song ? song.artists : '在歌单中点一首歌开始'),
              showMiniLrc && song && activeIdx >= 0 && lyrics[activeIdx] ? h('div', { className: 'ncm-mini-lrc' }, [
                h('div', { key: 'l' + activeIdx, ref: miniLrcRef, className: 'ncm-mini-lrc-line' + (miniLrcMq ? ' mq' : ''), style: Object.assign({ fontSize: miniLrcSize + 'px' }, miniLrcMq ? { '--ncm-mq-mx': miniLrcMq.dist, '--ncm-mq-dur': miniLrcMq.dur } : null) }, lyrics[activeIdx].text),
                showTrans && lyrics[activeIdx].tr ? h('div', { className: 'ncm-mini-lrc-tr', style: { fontSize: Math.max(9, miniLrcSize - 1) + 'px' } }, lyrics[activeIdx].tr) : null,
              ]) : null,
            ]),
            h('button', { className: 'ncm-icobtn', onClick: expandWindow, title: '展开' }, h(Ico, { d: ICONS.expand })),
            h('button', { className: 'ncm-icobtn', onClick: toggle, title: playing ? '暂停' : '播放' }, h(Ico, { d: playing ? ICONS.pause : ICONS.play, size: 20, fill: true })),
            h('button', { className: 'ncm-icobtn', onClick: next, title: '下一首' }, h(Ico, { d: ICONS.next })),
          ])
          : h('div', { key: 'win', ref: winRef, className: 'ncm-win', style: winStyle }, [
            h('div', { className: 'ncm-header', onPointerDown: onHeaderDown }, [
              h('div', { className: 'ncm-brand' }, [h('span', { className: 'ncm-logo' }, h(Ico, { d: ICONS.music, size: 18 })), h('span', null, '网易云音乐')]),
              h('button', { className: 'ncm-icobtn', title: '收起', onClick: () => setMini(true) }, h(Ico, { d: ICONS.minus })),
              h('button', { className: 'ncm-icobtn', title: '隐藏', onClick: () => setVisible(false) }, h(Ico, { d: ICONS.x })),
            ]),
            h('div', { className: 'ncm-tabs' }, ['play', 'lyric', 'list', 'queue', 'settings'].map((t) => mkTab(t, t === 'play' ? '播放' : t === 'lyric' ? '歌词' : t === 'list' ? '发现' : t === 'queue' ? '队列' : '设置'))),
            h('div', { className: 'ncm-body' }, tab === 'play' ? playView : tab === 'lyric' ? lyricView : tab === 'list' ? listView : tab === 'queue' ? queueView : settingsView),
          ]),
    ])
  }

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'ncm-player5-window', order: 100, label: '网易云音乐浮窗' },
    () => h(NcmPlayer)
  ))

  return () => {
    styleEl.remove()
  }
}

module.exports = { name, inject, apply }
