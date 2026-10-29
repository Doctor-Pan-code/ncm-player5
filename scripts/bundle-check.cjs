// 校验构建产物 lib/client.js 是否包含新插件的两处关键改动，以及模块包装是否完整。
// 用法：node scripts/bundle-check.cjs
const fs = require('fs')
const path = require('path')

const root = path.dirname(__dirname)
const file = path.join(root, 'lib', 'client.js')
const s = fs.readFileSync(file, 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const checks = [
  ['注册 id 为包名', s.includes('id: ' + JSON.stringify(pkg.name))],
  ['模块包装 return module.exports', s.includes('return module.exports')],
  ['节奏检测器存在', /RhythmDetector/.test(s)],
  ['长按计时器 ref', s.includes('holdTimerRef')],
  ['指纹位置持久化 key', s.includes('ncmply4-disc-pos')],
  ['滞回重新武装（修正后语义）', s.includes('if (e < mean * 1.15) this.armed = false')],
  ['起音时置 armed=true', /this\.armed = true\n\s+this\.lastHitE/.test(s)],
  ['pointerdown 阻止原生拖拽', s.includes('否则指针事件会被接管')],
  ['长按计时器不依赖打拍状态', !s.includes('}, [beating])\n    useEffect(() => () => {\n      window.removeEventListener')],
  ['强度按超出阈值倍数归一化', s.includes('(e / thr - 1) / 2')],
]

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad++
  console.log((ok ? 'OK   ' : 'MISS ') + name)
}
console.log(bad ? 'BUNDLE INCOMPLETE (' + bad + ' missing)' : 'bundle ok, ' + s.length + ' bytes')
process.exit(bad ? 1 : 0)
