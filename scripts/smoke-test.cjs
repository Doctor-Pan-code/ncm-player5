// smoke test for ncm-player fixes (run with node)
const p = require(process.argv[2] + '/package.json')
console.log('pkg name:', p.name)
console.log('peerDeps:', JSON.stringify(p.peerDependencies))
console.log('files:', p.files.join(', '))

// cookie sanitize behavior, mirroring index.mjs logic
const clean = (v) => String(v || '').replace(/"/g, '').trim()
console.log('clean quote:', JSON.stringify(clean('MUSIC_SNS="')))
const cookiePairs = (cookies) => {
  const pairs = []
  for (const c of cookies || []) {
    const eq = c.indexOf('=')
    if (eq > 0) pairs.push(c.slice(0, eq) + '=' + clean(c.slice(eq + 1).split(';')[0]))
  }
  return pairs
}
const merged = cookiePairs(['MUSIC_U=abc"def; Path=/', '__csrf=x; extra=1']).join('; ')
console.log('merged:', merged)
console.log('no stray quote:', !merged.includes('"'))

// legacy settings file (v1.0.7 and earlier wrote ~/.dsh/ncmply-settings):
// v1.1.0+ persists to browser localStorage; the file is read only as a one-time
// migration source, so it may be stale or absent.
const fs = require('fs')
const f = process.env.USERPROFILE + '/.dsh/ncmply-settings'
if (fs.existsSync(f)) {
  const raw = fs.readFileSync(f, 'utf8')
  const j = JSON.parse(raw)
  console.log('legacy settings valid JSON, cookie contains quote:', j.account.cookie.includes('"'))
  console.log('uid:', j.account.uid, 'queue:', (j.state && j.state.queue) ? j.state.queue.length : 0, 'mode:', j.state ? j.state.mode : null)
  console.log('cleaned cookie quote-free:', !clean(j.account.cookie).includes('"'))
} else {
  console.log('no legacy settings file (expected: v1.1.0+ persists via browser localStorage)')
}
