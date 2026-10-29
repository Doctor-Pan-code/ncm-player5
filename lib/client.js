window.__ModuleLoader__.load({
	id: "@wolfgenerals/ncm-player",
	factory: (require) => {
		var module = { exports: {} };
// ncm-player client half：网易云音乐浮窗 UI。
// 通过 slots 注册到 shell.overlay；与 host 用 fetch('/ncm/api') JSON API 通信。
// 纯 JS（无 JSX/TS），构建时仅做简单拼接包装；react 由 client 运行时注入。
const React = require('react')

const name = 'ncm-player-client'
const inject = ['slots', 'timer']

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
`

function apply (ctx) {
  const styleEl = document.createElement('style')
  styleEl.id = 'ncm-player-style'
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
  const LS_KEY = 'ncmply-settings'
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
    const posRef = useRef(null)
    const pendingTimeRef = useRef(0)
    const autoPlayRef = useRef(true)
    const liveRef = useRef(null)
    const throttledSaveRef = useRef(null)
    const accountRef = useRef(null)
    const accountCookieRef = useRef(null)
    posRef.current = pos
    const song = index >= 0 && index < queue.length ? queue[index] : null

    const showToast = (msg) => {
      setToast({ msg, id: Date.now() })
      if (toastTimerRef.current) { try { toastTimerRef.current() } catch (e) { } }
      toastTimerRef.current = timer.timeout(() => setToast(null), 2800)
    }

    const buildState = () => {
      const s = liveRef.current
      if (!s) return null
      const a = audioRef.current
      return { queue: s.queue.slice(0, 300), index: s.index, mode: s.mode, vol: s.muted ? 0 : s.vol, quality: s.quality, showTrans: s.showTrans, showMiniLrc: s.showMiniLrc, miniLrcScroll: s.miniLrcScroll, miniLrcSize: s.miniLrcSize, time: a && a.currentTime ? Math.round(a.currentTime * 1000) : 0 }
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
    liveRef.current = { queue, index, mode, vol, muted, quality, showTrans, showMiniLrc, miniLrcScroll, miniLrcSize }

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
    }, [queue, index, mode, vol, quality, showTrans, showMiniLrc, miniLrcScroll, miniLrcSize])

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

    useEffect(() => {
      if (!song) { setSongUrl(null); setLyrics([]); setDur(0); setTime(0); return }
      setLoading(true)
      api('songUrl', { id: song.id, br: quality }).then((r) => setSongUrl(r.url)).catch((e) => { setSongUrl(null); showToast('获取播放地址失败: ' + e.message) }).finally(() => setLoading(false))
      api('lyric', { id: song.id }).then((r) => setLyrics(parseLrc(r.lrc, r.tlyric, r.romalrc))).catch(() => setLyrics([]))
    }, [index])

    useEffect(() => {
      if (song) setLiked(!!(likedIds && likedIds.has(song.id)))
    }, [song && song.id, likedIds])

    useEffect(() => {
      const a = audioRef.current
      if (!a || !songUrl) return
      a.src = songUrl
      setLoading(true)
      if (!autoPlayRef.current) { setLoading(false); return }
      a.play().then(() => setPlaying(true)).catch(() => { showToast('播放失败: 可能无版权或地址已失效') }).finally(() => setLoading(false))
    }, [songUrl])

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
    const onAudioError = () => { if (songUrl) showToast('播放出错(可能无版权或需会员)') }

    const playAt = (i) => { if (i >= 0 && i < queue.length) { autoPlayRef.current = true; setIndex(i); setTab('play') } }
    const playFrom = (tracks, i) => {
      if (!tracks || !tracks.length) return
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
      autoPlayRef.current = true
      if (a.paused) a.play().catch(() => { }); else a.pause()
    }
    const next = () => {
      if (!queue.length) return
      autoPlayRef.current = true
      if (mode === 'shuffle') { let i = Math.floor(Math.random() * queue.length); if (i === index) i = (i + 1) % queue.length; setIndex(i); return }
      setIndex((index + 1) % queue.length)
    }
    const prev = () => {
      const a = audioRef.current
      if (a && a.currentTime > 3) { a.currentTime = 0; return }
      if (!queue.length) return
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
          h('div', { className: 'ncm-hint' }, '· 播放/搜索/歌词无需登录; "我的音乐"与收藏需要登录。\n· Cookie 仅用于请求 music.163.com, 不发送给任何第三方。\n· 登录态与播放队列保存在本机浏览器(localStorage), 不再写入 ~/.dsh 文件。\n· 界面颜色跟随当前皮肤主题。\n· 受版权或会员限制的歌曲可能无法播放。'),
        ]),
      ]),
    ])

    const p = pos || defaultPos() || { x: 8, y: 8 }
    const winStyle = { left: p.x + 'px', top: p.y + 'px' }
    return h('div', { className: 'ncm-wrap' }, [
      h('audio', { key: 'au', ref: audioRef, preload: 'auto', onTimeUpdate: onTimeUpdate, onLoadedMetadata: onLoadedMetadata, onEnded: onEnded, onError: onAudioError, onPlay: () => setPlaying(true), onPause: () => { setPlaying(false); saveNow() } }),
      toast ? h('div', { key: 'toast', className: 'ncm-toast' }, toast.msg) : null,
      !visible
        ? h('button', { key: 'disc', className: 'ncm-disc', title: '打开网易云音乐', onClick: openWindow }, h(Ico, { d: ICONS.music, size: 22 }))
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
          : h('div', { key: 'win', className: 'ncm-win', style: winStyle }, [
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
    { name: 'shell.overlay', id: 'ncm-player-window', order: 100, label: '网易云音乐浮窗' },
    () => h(NcmPlayer)
  ))

  return () => {
    styleEl.remove()
  }
}

module.exports = { name, inject, apply }

		return module.exports;
	}
});
