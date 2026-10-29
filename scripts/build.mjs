// ncm-player client 构建：无依赖——把 src.js 拼接进 __ModuleLoader__.load 包装。
// 注册 id 必须是包名（package.json 的 name），client-modules 按包名校验。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const src = readFileSync(join(root, 'client', 'src.js'), 'utf8')
const wrapped = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(pkg.name)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  src,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), wrapped)
console.log('built lib/client.js (' + wrapped.length + ' bytes)')
