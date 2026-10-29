// 校验构建产物 lib/client.js：既有 ncm-player4 的全部能力必须原样在位，
// 且新增的「自动跳过不可播放歌曲」能力必须齐全。
// 用法：node scripts/bundle-check.cjs
const fs = require('fs')
const path = require('path')

const root = path.dirname(__dirname)
const file = path.join(root, 'lib', 'client.js')
const s = fs.readFileSync(file, 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const host = fs.readFileSync(path.join(root, 'index.mjs'), 'utf8')

const checks = [
  // ---- 模块包装与身份 ----
  ['client 注册 id 为包名', s.includes('id: ' + JSON.stringify(pkg.name))],
  ['client 模块包装 return module.exports', s.includes('return module.exports')],
  ['client 不再使用 player4 的 style id', !s.includes("'ncm-player4-style'")],
  ['client 不再使用 player4 的 slot id', !s.includes("'ncm-player4-window'")],
  ['host 导出插件名为 ncm-player5', /export const name = 'ncm-player5'/.test(host)],

  // ---- 继承自 ncm-player4：节奏检测 + 长按拖动（不得回退）----
  ['节奏检测器存在', /RhythmDetector/.test(s)],
  ['长按计时器 ref', s.includes('holdTimerRef')],
  ['指纹位置持久化 key 沿用 ncmply4-disc-pos', s.includes('ncmply4-disc-pos')],
  ['滞回重新武装（修正后语义）', s.includes('if (e < mean * 1.15) this.armed = false')],
  ['pointerdown 阻止原生拖拽', s.includes('否则指针事件会被接管')],
  ['分析器必须接到 destination（无声修复）', s.includes('engine.analyser.connect(engine.ac.destination)')],
  ['跨域音频走 CORS', s.includes("a.crossOrigin = wantCors ? 'anonymous' : null")],

  // ---- 继承自 ncm-player3：无操作自动退出 ----
  ['无操作自动退出的 3 秒常量', /IDLE_AUTO_EXIT_MS\s*=\s*3000/.test(s)],
  ['无操作自动退出开关 autoExit', s.includes('autoExit')],

  // ---- 继承自 ncm-player2：点击窗口外收起 ----
  ['点击窗口外收起 onDocPointerDown', s.includes('onDocPointerDown')],

  // ---- ncm-player5 新增：自动跳过不可播放歌曲 ----
  ['新增自动跳过开关 autoSkip', /autoSkip/.test(s)],
  ['新增跳过守卫 skipGuardRef', s.includes('skipGuardRef')],
  ['跳过提示文案', s.includes('已跳过')],
  ['不可播判定读取 playable 字段', s.includes('playable')],
  ['全部不可播时的终止文案', s.includes('没有可播放的歌曲')],

  // ---- host 半部：可播性检测 ----
  ['host 新增 songStatus op', /case 'songStatus'/.test(host)],
  ['host 可播性判定函数 songPlayable', /songPlayable/.test(host)],
  ['host songUrl 返回 playable', /playable/.test(host)],
]

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad++
  console.log((ok ? 'OK   ' : 'MISS ') + name)
}
console.log(bad ? 'BUNDLE INCOMPLETE (' + bad + ' missing)' : 'bundle ok, ' + s.length + ' bytes')
process.exit(bad ? 1 : 0)
