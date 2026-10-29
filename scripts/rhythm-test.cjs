// ncm-player4 rhythm test: feed synthetic kick-drum envelopes into RhythmDetector
// and check that detected beats line up with the true onsets/BPM.
const fs = require('node:fs')
const path = require('node:path')

const root = path.dirname(__dirname)
const src = fs.readFileSync(path.join(root, 'client', 'src.js'), 'utf8')
// Extract the pure-JS rhythm section (BEAT const + RhythmDetector + helpers).
const start = src.indexOf('const BEAT = {')
const end = src.indexOf('// 右下角图标的长按拖动参数')
const code = src.slice(start, src.indexOf('const DISC_DRAG')) + '\n' + src.slice(src.indexOf('// 节奏检测引擎'), src.indexOf('function apply (ctx)'))
const mod = { exports: {} }
// class/const declarations inside new Function are function-scoped, so append an export line.
// eslint-disable-next-line no-new-func
const factory = new Function('module', 'exports', code + '\nmodule.exports = { BEAT, RhythmDetector, pulseParams, meanMaxFrames }')
factory(mod, mod.exports)
const { RhythmDetector, pulseParams } = mod.exports

// Kick envelope: sharp attack (~25ms), exponential decay (~90ms), plus a low noise floor.
function frameEnergy (t, onsetMs, amp) {
  if (t < onsetMs) return 0
  const dt = t - onsetMs
  if (dt > 420) return 0
  return amp * Math.exp(-dt / 95) * (dt < 25 ? dt / 25 : 1)
}

function run (bpm, seconds, opts) {
  const o = opts || {}
  const det = new RhythmDetector()
  const period = 60000 / bpm
  const onsets = []
  for (let k = 0; k * period < seconds * 1000 - 300; k++) onsets.push(k * period)
  const hits = []
  let prev = 0
  for (let t = 0; t < seconds * 1000; t += 1000 / 60) {
    let e = 0
    for (const on of onsets) e = Math.max(e, frameEnergy(t, on, o.amp || 210))
    // withGaps: silence the kicks in the middle third to test the BPM fallback
    if (o.gaps) {
      const mid = seconds * 1000 / 3
      if (t > mid && t < mid * 2) e = 0
    }
    e = Math.max(e, 3 + 2 * Math.sin(t / 37)) // low noise floor
    // 整体响度跟随输入幅度（真实分析器里 RMS 也是随音量变化的）
    const rms = o.rms || Math.min(255, (o.amp || 210) * 0.45)
    const r = det.step(e, rms, t)
    if (r.hit) hits.push({ t: Math.round(det.lastBeatMs), s: r.strength })
    if (det.bpm) prev = det.bpm
    if (det.tick(t) && o.gaps) hits.push({ t: Math.round(t), s: 0.45, fallback: true })
  }
  // match hits against true onsets
  let matched = 0
  const used = new Set()
  for (const h of hits) {
    const i = onsets.findIndex((on, idx) => !used.has(idx) && Math.abs(on - h.t) < 60)
    if (i >= 0) { used.add(i); matched++ }
  }
  return { bpm, estimated: prev, onsets: onsets.length, hits: hits.length, matched, recall: (matched / onsets.length).toFixed(2), sample: hits.slice(0, 6), hitList: hits }
}

let ok = true
const cases = [
  { bpm: 90, seconds: 8, expectBpm: 90 },
  { bpm: 120, seconds: 8, expectBpm: 120 },
  { bpm: 140, seconds: 8, expectBpm: 140 },
  { bpm: 174, seconds: 8, expectBpm: 174 },
]
for (const c of cases) {
  const r = run(c.bpm, c.seconds)
  const bpmOk = Math.abs(r.estimated - c.expectBpm) <= 3
  const recallOk = Number(r.recall) >= 0.7
  if (!bpmOk || !recallOk) ok = false
  console.log(`${c.bpm} BPM -> est ${r.estimated} ${bpmOk ? 'OK' : 'FAIL'}; onsets ${r.onsets} hits ${r.hits} matched ${r.matched} recall ${r.recall} ${recallOk ? 'OK' : 'FAIL'}`)
  console.log('   first beats(ms):', r.sample.map((h) => h.t + '@' + h.s.toFixed(2)).join(' '))
}

// strength should scale with amplitude
const quiet = run(120, 6, { amp: 120 })
const loud = run(120, 6, { amp: 245 })
const avg = (h) => {
  const real = h.hitList.filter((x) => !x.fallback)
  return real.reduce((a, b) => a + b.s, 0) / Math.max(1, real.length)
}
const louderIsBigger = avg(loud) > avg(quiet)
if (!louderIsBigger) ok = false
console.log('strength quiet/loud avg:', avg(quiet).toFixed(2), avg(loud).toFixed(2), louderIsBigger ? 'OK' : 'FAIL')

// BPM fallback across silence
const g = run(120, 9, { gaps: true })
console.log('with silent middle: est bpm', g.estimated, 'hits', g.hits, 'fallback sampled', g.sample.filter((h) => h.fallback).length)

// pulse params monotonic
const p1 = pulseParams(0.4, true)
const p2 = pulseParams(1, true)
console.log('pulse low:', JSON.stringify(p1), 'high:', JSON.stringify(p2))
if (!(Number(p2.scale) > Number(p1.scale) && Number(p2.glow) > Number(p1.glow) && p2.dur > p1.dur)) { ok = false; console.log('pulse params not monotonic FAIL') }

console.log(ok ? 'ALL RHYTHM CHECKS PASSED' : 'SOME CHECKS FAILED')
process.exit(ok ? 0 : 1)
