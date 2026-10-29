// ncm-player4 Node half：网易云音乐浮窗的 API 服务端。
// 通过 webServer 路由暴露 /ncm/api JSON API，client 半部 fetch 调用。
// 与 ncm-player3 的 host 半部完全一致：ncm-player4 新增的两项功能（随音乐节奏
// 跳动、长按拖动右下角图标）都实现在 client 半部，因此这里只需换插件名；
// 路由前缀仍为 /ncm/api，两个插件不能同时启用。
import os from 'node:os'
import path from 'node:path'

export const name = 'ncm-player4'
export const inject = ['webServer', 'subprocess', 'fs']

const NODE_SCRIPT = `
let data = '';
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', async () => {
  const respond = (obj) => process.stdout.write(JSON.stringify(obj));
  let req;
  try { req = JSON.parse(data); } catch (e) { respond({ ok: false, error: 'bad request json' }); return; }
  try {
    if (req.sysinfo) {
      respond({ ok: true, homeDir: require('os').homedir(), platform: process.platform });
      return;
    }
    let url = req.url;
    let method = req.method || 'GET';
    let headers = Object.assign({}, req.headers || {});
    let body = req.body;
    if (req.weapi) {
      const crypto = require('crypto');
      const iv = Buffer.from('0102030405060708', 'utf-8');
      const presetKey = Buffer.from('0CoJUm6Qyw8W8jud', 'utf-8');
      const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
      const b64url = (b) => Buffer.from(b).toString('base64url');
      const rsaKey = crypto.createPublicKey({ key: { kty: 'RSA', n: b64url(Buffer.from(MODULUS, 'hex')), e: b64url(Buffer.from('010001', 'hex')) }, format: 'jwk' });
      const aes = (text, key) => { const c = crypto.createCipheriv('aes-128-cbc', key, iv); return Buffer.concat([c.update(text, 'utf-8'), c.final()]); };
      let sk = null;
      let padded = null;
      do {
        sk = crypto.randomBytes(16);
        padded = Buffer.concat([Buffer.from(sk).reverse(), Buffer.alloc(112)]);
      } while (padded[0] >= 0xe0);
      const params = aes(aes(JSON.stringify(req.payload || {}), presetKey).toString('base64'), sk).toString('base64');
      const encSecKey = crypto.publicEncrypt({ key: rsaKey, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex');
      body = 'params=' + encodeURIComponent(params) + '&encSecKey=' + encodeURIComponent(encSecKey);
      method = 'POST';
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(url, { method: method, headers: headers, body: body, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const bodyText = await res.text();
    let setCookies = [];
    try { setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []; } catch (e) { setCookies = []; }
    respond({ ok: true, status: res.status, bodyText: bodyText, setCookies: setCookies });
  } catch (e) {
    respond({ ok: false, error: String((e && e.message) || e) });
  }
});
`

// ---- pure-JS QR encoder ----
const qrEncode = (function () {
  const EXP_TABLE = new Uint8Array(512);
  const LOG_TABLE = new Uint8Array(256);
  (function initGF () { let x = 1; for (let i = 0; i < 255; i++) { EXP_TABLE[i] = x; LOG_TABLE[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP_TABLE[i] = EXP_TABLE[i - 255]; })();
  const gfMul = (x, y) => (x === 0 || y === 0) ? 0 : EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
  function polyMul (p1, p2) { const coeff = new Uint8Array(p1.length + p2.length - 1); for (let i = 0; i < p1.length; i++) for (let j = 0; j < p2.length; j++) coeff[i + j] ^= gfMul(p1[i], p2[j]); return coeff; }
  function polyMod (dividend, divisor) { let result = new Uint8Array(dividend); while (result.length - divisor.length >= 0) { const coeff = result[0]; for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], coeff); let offset = 0; while (offset < result.length && result[offset] === 0) offset++; result = result.slice(offset); } return result; }
  function generateECPolynomial (degree) { let poly = new Uint8Array([1]); for (let i = 0; i < degree; i++) poly = polyMul(poly, new Uint8Array([1, EXP_TABLE[i]])); return poly; }
  function rsEncode (data, degree) { const genPoly = generateECPolynomial(degree); const paddedData = new Uint8Array(data.length + degree); paddedData.set(data); const remainder = polyMod(paddedData, genPoly); const start = degree - remainder.length; if (start > 0) { const buff = new Uint8Array(degree); buff.set(remainder, start); return buff; } return remainder; }
  const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  const EC_CODEWORDS_L = [0, 7, 10, 15, 20, 26, 36, 40, 48, 60, 72];
  const EC_BLOCKS_L = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
  const getSymbolSize = (version) => version * 4 + 17;
  function getRowColCoords (version) { if (version === 1) return []; const posCount = Math.floor(version / 7) + 2; const size = getSymbolSize(version); const intervals = Math.ceil((size - 13) / (2 * posCount - 2)) * 2; const positions = [size - 7]; for (let i = 1; i < posCount - 1; i++) positions[i] = positions[i - 1] - intervals; positions.push(6); return positions.reverse(); }
  function getAlignmentPositions (version) { const coords = []; const pos = getRowColCoords(version); const len = pos.length; for (let i = 0; i < len; i++) { for (let j = 0; j < len; j++) { if ((i === 0 && j === 0) || (i === 0 && j === len - 1) || (i === len - 1 && j === 0)) continue; coords.push([pos[i], pos[j]]); } } return coords; }
  function getBCHDigit (data) { let digit = 0; while (data !== 0) { digit++; data >>>= 1; } return digit; }
  const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
  const G15_BCH = getBCHDigit(G15);
  function getFormatInfoBits (mask) { const data = (1 << 3) | mask; let d = data << 10; while (getBCHDigit(d) - G15_BCH >= 0) d ^= (G15 << (getBCHDigit(d) - G15_BCH)); return ((data << 10) | d) ^ G15_MASK; }
  function BitMatrix (size) { this.size = size; this.data = new Uint8Array(size * size); this.reservedBit = new Uint8Array(size * size); }
  BitMatrix.prototype.set = function (row, col, value, reserved) { const index = row * this.size + col; this.data[index] = value ? 1 : 0; if (reserved) this.reservedBit[index] = 1; };
  BitMatrix.prototype.get = function (row, col) { return this.data[row * this.size + col]; };
  BitMatrix.prototype.xor = function (row, col, value) { this.data[row * this.size + col] ^= value ? 1 : 0; };
  BitMatrix.prototype.isReserved = function (row, col) { return this.reservedBit[row * this.size + col] === 1; };
  function setupFinderPattern (matrix) { const size = matrix.size; const positions = [[0, 0], [size - 7, 0], [0, size - 7]]; for (let p = 0; p < positions.length; p++) { const row = positions[p][0]; const col = positions[p][1]; for (let r = -1; r <= 7; r++) { if (row + r <= -1 || size <= row + r) continue; for (let c = -1; c <= 7; c++) { if (col + c <= -1 || size <= col + c) continue; if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) { matrix.set(row + r, col + c, true, true); } else { matrix.set(row + r, col + c, false, true); } } } } }
  function setupTimingPattern (matrix) { const size = matrix.size; for (let r = 8; r < size - 8; r++) { const value = r % 2 === 0; matrix.set(r, 6, value, true); matrix.set(6, r, value, true); } }
  function setupAlignmentPattern (matrix, version) { const pos = getAlignmentPositions(version); for (let i = 0; i < pos.length; i++) { const row = pos[i][0]; const col = pos[i][1]; for (let r = -2; r <= 2; r++) { for (let c = -2; c <= 2; c++) { if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) { matrix.set(row + r, col + c, true, true); } else { matrix.set(row + r, col + c, false, true); } } } } }
  function setupFormatInfo (matrix, maskPattern) { const size = matrix.size; const bits = getFormatInfoBits(maskPattern); for (let i = 0; i < 15; i++) { const mod = ((bits >> i) & 1) === 1; if (i < 6) matrix.set(i, 8, mod, true); else if (i < 8) matrix.set(i + 1, 8, mod, true); else matrix.set(size - 15 + i, 8, mod, true); if (i < 8) matrix.set(8, size - i - 1, mod, true); else if (i < 9) matrix.set(8, 15 - i - 1 + 1, mod, true); else matrix.set(8, 15 - i - 1, mod, true); } matrix.set(size - 8, 8, 1, true); }
  function setupData (matrix, data) { const size = matrix.size; let inc = -1; let row = size - 1; let bitIndex = 7; let byteIndex = 0; for (let col = size - 1; col > 0; col -= 2) { if (col === 6) col--; while (true) { for (let c = 0; c < 2; c++) { if (!matrix.isReserved(row, col - c)) { let dark = false; if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1); matrix.set(row, col - c, dark); bitIndex--; if (bitIndex === -1) { byteIndex++; bitIndex = 7; } } } row += inc; if (row < 0 || size <= row) { row -= inc; inc = -inc; break; } } } }
  const PENALTY_N1 = 3; const PENALTY_N2 = 3; const PENALTY_N3 = 40; const PENALTY_N4 = 10;
  function maskAt (pattern, i, j) { switch (pattern) { case 0: return (i + j) % 2 === 0; case 1: return i % 2 === 0; case 2: return j % 3 === 0; case 3: return (i + j) % 3 === 0; case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; case 5: return (i * j) % 2 + (i * j) % 3 === 0; case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0; default: return ((i * j) % 3 + (i + j) % 2) % 2 === 0; } }
  function applyMask (pattern, matrix) { const size = matrix.size; for (let col = 0; col < size; col++) { for (let row = 0; row < size; row++) { if (matrix.isReserved(row, col)) continue; matrix.xor(row, col, maskAt(pattern, row, col)); } } }
  function getPenaltyN1 (matrix) { const size = matrix.size; let points = 0; for (let row = 0; row < size; row++) { let sameCountCol = 0; let sameCountRow = 0; let lastCol = null; let lastRow = null; for (let col = 0; col < size; col++) { let module = matrix.get(row, col); if (module === lastCol) sameCountCol++; else { if (sameCountCol >= 5) points += PENALTY_N1 + (sameCountCol - 5); lastCol = module; sameCountCol = 1; } module = matrix.get(col, row); if (module === lastRow) sameCountRow++; else { if (sameCountRow >= 5) points += PENALTY_N1 + (sameCountRow - 5); lastRow = module; sameCountRow = 1; } } if (sameCountCol >= 5) points += PENALTY_N1 + (sameCountCol - 5); if (sameCountRow >= 5) points += PENALTY_N1 + (sameCountRow - 5); } return points; }
  function getPenaltyN2 (matrix) { const size = matrix.size; let points = 0; for (let row = 0; row < size - 1; row++) { for (let col = 0; col < size - 1; col++) { const last = matrix.get(row, col) + matrix.get(row, col + 1) + matrix.get(row + 1, col) + matrix.get(row + 1, col + 1); if (last === 4 || last === 0) points++; } } return points * PENALTY_N2; }
  function getPenaltyN3 (matrix) { const size = matrix.size; let points = 0; for (let row = 0; row < size; row++) { let bitsCol = 0; let bitsRow = 0; for (let col = 0; col < size; col++) { bitsCol = ((bitsCol << 1) & 0x7ff) | matrix.get(row, col); if (col >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) points++; bitsRow = ((bitsRow << 1) & 0x7ff) | matrix.get(col, row); if (col >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) points++; } } return points * PENALTY_N3; }
  function getPenaltyN4 (matrix) { let darkCount = 0; const total = matrix.data.length; for (let i = 0; i < total; i++) darkCount += matrix.data[i]; const k = Math.abs(Math.ceil((darkCount * 100 / total) / 5) - 10); return k * PENALTY_N4; }
  function getBestMask (matrix) { let bestPattern = 0; let lowerPenalty = Infinity; for (let p = 0; p < 8; p++) { setupFormatInfo(matrix, p); applyMask(p, matrix); const penalty = getPenaltyN1(matrix) + getPenaltyN2(matrix) + getPenaltyN3(matrix) + getPenaltyN4(matrix); applyMask(p, matrix); if (penalty < lowerPenalty) { lowerPenalty = penalty; bestPattern = p; } } return bestPattern; }
  function BitBuffer () { this.buffer = []; this.length = 0; }
  BitBuffer.prototype.put = function (num, length) { for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1); };
  BitBuffer.prototype.putBit = function (bit) { const bufIndex = Math.floor(this.length / 8); if (this.buffer.length <= bufIndex) this.buffer.push(0); if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8)); this.length++; };
  function getByteCapacity (version) { const total = TOTAL_CODEWORDS[version]; const ecTotal = EC_CODEWORDS_L[version]; const usableBits = (total - ecTotal) * 8 - 12; return Math.floor(usableBits / 8); }
  function getBestVersion (byteLength) { for (let v = 1; v <= 10; v++) if (byteLength <= getByteCapacity(v)) return v; throw new Error('qr: data too long'); }
  function createData (version, textBytes) { const buffer = new BitBuffer(); buffer.put(4, 4); buffer.put(textBytes.length, 8); for (let i = 0; i < textBytes.length; i++) buffer.put(textBytes[i], 8); const totalCodewords = TOTAL_CODEWORDS[version]; const ecTotal = EC_CODEWORDS_L[version]; const dataTotalBits = (totalCodewords - ecTotal) * 8; if (buffer.length + 4 <= dataTotalBits) buffer.put(0, 4); while (buffer.length % 8 !== 0) buffer.putBit(0); const remainingByte = (dataTotalBits - buffer.length) / 8; for (let i = 0; i < remainingByte; i++) buffer.put(i % 2 ? 0x11 : 0xec, 8); return createCodewords(buffer, version); }
  function createCodewords (bitBuffer, version) { const totalCodewords = TOTAL_CODEWORDS[version]; const ecTotal = EC_CODEWORDS_L[version]; const dataTotalCodewords = totalCodewords - ecTotal; const ecTotalBlocks = EC_BLOCKS_L[version]; const blocksInGroup2 = totalCodewords % ecTotalBlocks; const blocksInGroup1 = ecTotalBlocks - blocksInGroup2; const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks); const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks); const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1; const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1; let offset = 0; const dcData = []; const ecData = []; let maxDataSize = 0; const buffer = new Uint8Array(bitBuffer.buffer); for (let b = 0; b < ecTotalBlocks; b++) { const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2; dcData[b] = buffer.slice(offset, offset + dataSize); ecData[b] = rsEncode(dcData[b], ecCount); offset += dataSize; maxDataSize = Math.max(maxDataSize, dataSize); } const data = new Uint8Array(totalCodewords); let index = 0; for (let i = 0; i < maxDataSize; i++) { for (let r = 0; r < ecTotalBlocks; r++) if (i < dcData[r].length) data[index++] = dcData[r][i]; } for (let i = 0; i < ecCount; i++) { for (let r = 0; r < ecTotalBlocks; r++) data[index++] = ecData[r][i]; } return data; }
  function qrEncodeFn (text) { const encoder = new TextEncoder(); const textBytes = encoder.encode(text); const version = getBestVersion(textBytes.length); const dataBits = createData(version, textBytes); const moduleCount = getSymbolSize(version); const matrix = new BitMatrix(moduleCount); setupFinderPattern(matrix); setupTimingPattern(matrix); setupAlignmentPattern(matrix, version); setupFormatInfo(matrix, 0); setupData(matrix, dataBits); const mask = getBestMask(matrix); applyMask(mask, matrix); setupFormatInfo(matrix, mask); const modules = []; for (let r = 0; r < moduleCount; r++) { const row = []; for (let c = 0; c < moduleCount; c++) row.push(matrix.get(r, c) === 1); modules.push(row); } return { size: moduleCount, version: version, mask: mask, modules: modules }; }
  return qrEncodeFn;
})();

export async function apply (ctx) {
  const subprocess = ctx.subprocess
  const fs = ctx.fs

  // ---- 路径 ----
  // 数据目录跟随 DSH_HOME(DSH 实际的数据根);未设置时回退 <home>/.dsh;
  // homeDir 也不可得时退到系统临时目录,避免相对路径落到进程 cwd。
  // 注: v1.1.0 起持久化移交 client 半部(浏览器 localStorage),
  // 该文件仅作旧版本数据的只读迁移,不再由 host 写入。
  let homeDir = null
  try { homeDir = os.homedir() } catch (e) { console.error('ncm3: homedir failed: ' + String(e)) }
  const DATA_DIR = process.env.DSH_HOME || (homeDir ? path.join(homeDir, '.dsh') : null)
  // 沿用 v2 的旧文件名:仅作 ≤1.0.7 老数据的只读迁移(持久化现由 client localStorage 负责)。
  const SETTINGS_FILE = DATA_DIR ? path.join(DATA_DIR, 'ncmply2-settings') : path.join(os.tmpdir(), 'ncmply2-settings')
  // 子进程 cwd:取一个确定存在且可写的目录(Windows 盘根/Unix 根目录对个别程序不友好)。
  const CWD = homeDir || os.tmpdir()

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  const REF = 'https://music.163.com/'

  // node 运行时:优先复用宿主自身进程(process.execPath,保证存在且可用),
  // 再回退到 PATH 与常见安装路径(避免 PATH 命中 Microsoft Store 的 node 桩等)。
  let nodePath = process.execPath || null
  if (!nodePath) {
    const cands = ['node', 'node.exe', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
    for (const cand of cands) {
      try { nodePath = await subprocess.resolveExecutable(cand); break } catch (e) { /* next */ }
    }
  }
  if (!nodePath) console.error('ncm3: Node.js runtime not found; network disabled')

  const runNode = async (req) => {
    if (!nodePath) throw new Error('网络服务不可用(Node.js 运行时未找到)')
    const handle = subprocess.spawn({
      argv: [nodePath, '-e', NODE_SCRIPT],
      cwd: CWD,
      stdio: { stdin: { data: JSON.stringify(req) }, stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      graceMs: 3000,
    })
    const outcome = await handle.done
    const out = handle.collected.stdout.readFrom(0).text
    if (outcome.exitCode !== 0) throw new Error('网络子进程异常退出 (' + outcome.exitCode + ')')
    let parsed
    try { parsed = JSON.parse(out) } catch (e) { throw new Error('网络子进程输出异常') }
    if (!parsed.ok) throw new Error(parsed.error || '网络请求失败')
    return parsed
  }

  // Cookie 值里的双引号会使 settings JSON 损坏（历史数据曾因此被截断），统一消毒。
  const cleanCookieValue = (v) => String(v || '').replace(/"/g, '').trim()
  let settings = { account: { cookie: '', uid: null, nickname: '' }, state: null }
  try {
    const target = await fs.resolve(SETTINGS_FILE)
    const text = await fs.readText(target)
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      const a = parsed.account
      if (a && typeof a === 'object') {
        const u = a.uid
        settings.account = {
          cookie: typeof a.cookie === 'string' ? cleanCookieValue(a.cookie) : '',
          uid: (typeof u === 'number' && u > 0) ? u : (typeof u === 'string' && /^\d+$/.test(u) ? Number(u) : null),
          nickname: typeof a.nickname === 'string' ? a.nickname : '',
        }
      }
      if (parsed.state && typeof parsed.state === 'object' && Array.isArray(parsed.state.queue)) settings.state = parsed.state
      console.log('ncm: loaded settings' + (settings.account.nickname ? ' for ' + settings.account.nickname : ''))
    }
  } catch (e) { /* no settings file yet */ }
  // 持久化已移交 client 半部(浏览器 localStorage):host 只维护会话内存态,不再写盘。
  // 保留返回 true 以兼容旧调用方;启动时的 SETTINGS_FILE 读取保留为 ≤1.0.7 旧数据的一次性迁移。
  const writeSettings = async () => true

  const baseHeaders = (cookie) => {
    const h = { 'User-Agent': UA, 'Referer': REF }
    if (cookie) h['Cookie'] = cookie
    return h
  }
  const jsonGet = async (url, cookie) => {
    const r = await runNode({ url, method: 'GET', headers: baseHeaders(cookie !== undefined ? cookie : settings.account.cookie) })
    if (r.status >= 400) throw new Error('HTTP ' + r.status)
    let j
    try { j = JSON.parse(r.bodyText) } catch (e) { throw new Error('响应解析失败') }
    return j
  }
  const formPost = async (url, form, cookie) => {
    const r = await runNode({ url, method: 'POST', headers: Object.assign(baseHeaders(cookie), { 'Content-Type': 'application/x-www-form-urlencoded' }), body: form })
    let j = null
    try { j = JSON.parse(r.bodyText) } catch (e) { j = null }
    return { json: j, setCookies: r.setCookies || [] }
  }
  const weapiPost = async (url, payload, cookie) => {
    const r = await runNode({ url, weapi: true, payload, headers: baseHeaders(cookie !== undefined ? cookie : settings.account.cookie) })
    let j = null
    try { j = JSON.parse(r.bodyText) } catch (e) { j = null }
    return j
  }
  const cookiePairs = (cookies) => {
    const pairs = []
    for (const c of cookies || []) {
      const eq = c.indexOf('=')
      if (eq > 0) pairs.push(c.slice(0, eq) + '=' + cleanCookieValue(c.slice(eq + 1).split(';')[0]))
    }
    return pairs
  }
  const mergeCookies = (existing, pairs) => {
    const map = {}
    if (existing) { for (const part of existing.split('; ')) { const eq = part.indexOf('='); if (eq > 0) map[part.slice(0, eq)] = cleanCookieValue(part.slice(eq + 1)) } }
    for (const p of pairs) { const eq = p.indexOf('='); if (eq > 0) map[p.slice(0, eq)] = cleanCookieValue(p.slice(eq + 1)) }
    return Object.keys(map).map((k) => k + '=' + map[k]).join('; ')
  }
  const normSong = (s) => ({
    id: s.id,
    name: String(s.name || '未知歌曲'),
    artists: Array.isArray(s.ar) ? s.ar.map((a) => (a && a.name) || '').filter(Boolean).join(' / ') : '',
    album: (s.al && s.al.name) || '',
    cover: String((s.al && s.al.picUrl) || '').replace(/^http:/, 'https:'),
    duration: typeof s.dt === 'number' ? s.dt : 0,
  })
  // 兼容两种返回结构：/api/search/get 用 artists/album，/api/song/detail 用 ar/al。
  const normSongAny = (s) => {
    const ar = Array.isArray(s.ar) ? s.ar : Array.isArray(s.artists) ? s.artists : []
    const al = s.al || s.album || {}
    return {
      id: s.id,
      name: String(s.name || '未知歌曲'),
      artists: ar.map((a) => (a && a.name) || '').filter(Boolean).join(' / '),
      album: String(al.name || ''),
      cover: String(al.picUrl || s.picUrl || '').replace(/^http:/, 'https:'),
      duration: typeof s.dt === 'number' ? s.dt : (typeof s.duration === 'number' ? s.duration : 0),
    }
  }
  const normAlbumSong = (s) => ({
    id: s.id,
    name: String(s.name || '未知歌曲'),
    artists: Array.isArray(s.artists) ? s.artists.map((a) => (a && a.name) || '').filter(Boolean).join(' / ') : '',
    album: (s.album && s.album.name) || '',
    cover: String((s.album && s.album.picUrl) || '').replace(/^http:/, 'https:'),
    duration: typeof s.dt === 'number' ? s.dt : (typeof s.duration === 'number' ? s.duration : 0),
  })
  const normPlaylist = (p) => ({
    id: p.id,
    name: String(p.name || '').slice(0, 120),
    cover: String(p.coverImgUrl || '').replace(/^http:/, 'https:'),
    trackCount: p.trackCount || 0,
    creator: (p.creator && p.creator.nickname) || '',
  })
  const searchSongs = async (kw, limit) => {
    const j = await jsonGet('https://music.163.com/api/search/get?s=' + encodeURIComponent(kw) + '&type=1&limit=' + limit)
    const list = j && j.result && j.result.songs
    if (!Array.isArray(list)) throw new Error('搜索失败')
    const songs = list.map(normSongAny)
    // 旧搜索接口不返回封面(album 无 picUrl)，用 song/detail 批量补封面；失败不阻塞搜索结果。
    const ids = songs.map((s) => s.id).filter((v) => typeof v === 'number').slice(0, 30)
    if (ids.length) {
      try {
        const c = encodeURIComponent(JSON.stringify(ids.map((tid) => ({ id: tid }))))
        const d = await jsonGet('https://music.163.com/api/v3/song/detail?c=' + c)
        const byId = {}
        for (const song of (d && d.songs) || []) byId[song.id] = normSong(song)
        let n = 0
        for (const s of songs) {
          const full = byId[s.id]
          if (full) {
            if (full.cover) { s.cover = full.cover; n++ }
            if (full.album) s.album = full.album
          }
        }
        console.log('ncm: search covers enriched ' + n + '/' + songs.length)
      } catch (e) { console.error('ncm: search cover enrichment failed: ' + String((e && e.message) || e)) }
    }
    return songs
  }
  const searchPlaylists = async (kw, limit) => {
    const j = await jsonGet('https://music.163.com/api/search/get?s=' + encodeURIComponent(kw) + '&type=1000&limit=' + limit)
    const list = j && j.result && j.result.playlists
    if (!Array.isArray(list)) throw new Error('搜索失败')
    return list.map(normPlaylist)
  }
  const searchAlbums = async (kw, limit) => {
    const j = await jsonGet('https://music.163.com/api/search/get?s=' + encodeURIComponent(kw) + '&type=10&limit=' + limit)
    const list = j && j.result && j.result.albums
    if (!Array.isArray(list)) throw new Error('搜索失败')
    return list.map((a) => ({
      id: a.id,
      name: String(a.name || '未知专辑'),
      cover: String(a.picUrl || '').replace(/^http:/, 'https:'),
      artist: (a.artist && a.artist.name) || '',
      trackCount: a.size || 0,
    }))
  }
  const hotPlaylists = async (limit) => {
    const j = await jsonGet('https://music.163.com/api/playlist/list?cat=' + encodeURIComponent('全部') + '&order=hot&limit=' + limit + '&offset=0')
    const list = j && j.playlists
    if (!Array.isArray(list)) throw new Error('获取热门歌单失败')
    return list.map(normPlaylist)
  }
  const playlistDetail = async (id) => {
    const d = await jsonGet('https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(String(id)))
    const p = d && d.playlist
    if (!p) throw new Error('歌单不存在或已失效')
    const ids = (p.trackIds || []).map((t) => t && t.id).filter((v) => typeof v === 'number').slice(0, 300)
    const tracks = []
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const c = encodeURIComponent(JSON.stringify(chunk.map((tid) => ({ id: tid }))))
      const s = await jsonGet('https://music.163.com/api/v3/song/detail?c=' + c)
      for (const song of (s && s.songs) || []) tracks.push(normSong(song))
    }
    return { id: p.id, name: String(p.name || '未命名歌单'), cover: String(p.coverImgUrl || '').replace(/^http:/, 'https:'), tracks }
  }
  const myPlaylists = async () => {
    if (!settings.account.uid) throw new Error('未登录: 请先在设置中登录账号')
    const j = await jsonGet('https://music.163.com/api/user/playlist?uid=' + settings.account.uid + '&limit=1000&offset=0')
    const list = j && j.playlist
    if (!Array.isArray(list)) throw new Error('获取歌单失败')
    const items = list.map((p) => Object.assign(normPlaylist(p), { specialType: p.specialType || 0, subscribed: !!p.subscribed }))
    const rank = (x) => (x.specialType === 5 ? 0 : x.subscribed ? 2 : 1)
    items.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'zh'))
    return items
  }
  const myAlbums = async () => {
    if (!settings.account.uid) throw new Error('未登录: 请先在设置中登录账号')
    const out = []
    for (let offset = 0; offset < 500 && out.length < 300; offset += 50) {
      const j = await jsonGet('https://music.163.com/api/album/sublist?limit=50&offset=' + offset + '&total=true')
      const list = j && j.data
      if (!Array.isArray(list) || list.length === 0) break
      for (const a of list) {
        out.push({
          id: a.id,
          name: String(a.name || '未知专辑'),
          cover: String(a.picUrl || '').replace(/^http:/, 'https:'),
          artist: (Array.isArray(a.artists) && a.artists[0] && a.artists[0].name) || '',
          trackCount: a.size || 0,
        })
      }
      if (list.length < 50) break
    }
    return out
  }
  const albumDetail = async (id) => {
    const cookie = 'os=pc' + (settings.account.cookie ? '; ' + settings.account.cookie : '')
    const j = await jsonGet('https://music.163.com/api/album/' + encodeURIComponent(String(id)), cookie)
    const al = j && j.album
    if (!al) throw new Error('专辑不存在或已失效')
    const tracks = Array.isArray(al.songs) ? al.songs.map(normAlbumSong) : []
    return { id: al.id, name: String(al.name || '未知专辑'), cover: String(al.picUrl || '').replace(/^http:/, 'https:'), artist: (al.artist && al.artist.name) || '', tracks }
  }
  const songUrl = async (id, br) => {
    try {
      const j = await jsonGet('https://music.163.com/api/song/enhance/player/url?ids=' + encodeURIComponent('[' + String(id) + ']') + '&br=' + br)
      const d = j && j.data && j.data[0]
      if (d && typeof d.url === 'string' && d.url.length > 10) return d.url.replace(/^http:/, 'https:')
    } catch (e) { /* fall through */ }
    return 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(String(id)) + '.mp3'
  }
  const lyric = async (id) => {
    const j = await jsonGet('https://music.163.com/api/song/lyric?os=pc&id=' + id + '&lv=-1&kv=-1&tv=-1')
    return {
      lrc: (j && j.lrc && j.lrc.lyric) || '',
      tlyric: (j && j.tlyric && j.tlyric.lyric) || '',
      romalrc: (j && j.romalrc && j.romalrc.lyric) || '',
    }
  }
  let likePidCache = null
  const likePlaylistId = async () => {
    if (likePidCache) return likePidCache
    const items = await myPlaylists()
    const fav = items.find((x) => x.specialType === 5)
    if (!fav) throw new Error('未找到"我喜欢的音乐"歌单')
    likePidCache = fav.id
    return fav.id
  }
  const like = async (id, likeFlag) => {
    if (!settings.account.uid) throw new Error('请先登录账号')
    await likePlaylistId()
    const j = await weapiPost('https://music.163.com/api/radio/like?alg=itembased&trackId=' + id + '&like=' + likeFlag, { trackId: id, like: likeFlag })
    if (!j || j.code !== 200) throw new Error('收藏操作失败' + (j && j.message ? ': ' + j.message : '') + '(可能是账号风控, 请稍后再试)')
    return true
  }
  const likedIds = async () => {
    const pid = await likePlaylistId()
    const p = await playlistDetail(pid)
    return p.tracks.map((t) => t.id)
  }
  const accountFromCookie = async (cookie) => {
    const info = await weapiPost('https://music.163.com/api/nuser/account/get', {}, cookie)
    const profile = info && info.profile
    if (!info || info.code !== 200 || !profile || !profile.userId) throw new Error('登录凭据无效或已过期')
    return { uid: profile.userId, nickname: String(profile.nickname || '') }
  }
  const qrSessions = {}
  const qrCreate = async () => {
    const r = await formPost('https://music.163.com/api/login/qrcode/unikey', 'type=3')
    if (!r.json || r.json.code !== 200 || !r.json.unikey) throw new Error('获取二维码失败')
    const unikey = r.json.unikey
    qrSessions[unikey] = mergeCookies('os=pc', cookiePairs(r.setCookies))
    const qr = qrEncode('https://music.163.com/login?codekey=' + unikey)
    return { unikey, grid: qr.modules.map((row) => row.map((d) => (d ? '1' : '0')).join('')) }
  }
  const qrCheck = async (key) => {
    const session = qrSessions[key] || 'os=pc'
    const r = await formPost('https://music.163.com/api/login/qrcode/client/login', 'key=' + encodeURIComponent(key) + '&type=3', session)
    const merged = mergeCookies(session, cookiePairs(r.setCookies))
    qrSessions[key] = merged
    const code = r.json && r.json.code
    const message = (r.json && r.json.message) || ''
    if (code !== 803) {
      if (code === 800) delete qrSessions[key]
      return { code, message }
    }
    const prev = { cookie: settings.account.cookie, uid: settings.account.uid, nickname: settings.account.nickname }
    settings.account = { cookie: merged, uid: null, nickname: '' }
    try {
      const info = await accountFromCookie(merged)
      settings.account.uid = info.uid
      settings.account.nickname = info.nickname
      const persisted = await writeSettings()
      delete qrSessions[key]
      return { code: 803, account: { uid: settings.account.uid, nickname: settings.account.nickname }, persisted }
    } catch (e) {
      settings.account = prev
      throw e
    }
  }

  const dispatch = async (args) => {
    const op = args && args.op
    switch (op) {
      case 'search': {
        const kw = String((args && args.keyword) || '').trim()
        if (!kw) throw new Error('请输入关键词')
        if (args.type === 1000) return { playlists: await searchPlaylists(kw, 30) }
        if (args.type === 10) return { albums: await searchAlbums(kw, 30) }
        return { songs: await searchSongs(kw, 30) }
      }
      case 'hotPlaylists': return { items: await hotPlaylists(30) }
      case 'playlistDetail': return { playlist: await playlistDetail(Number(args.id)) }
      case 'albumDetail': return { album: await albumDetail(Number(args.id)) }
      case 'myPlaylists': return { items: await myPlaylists(), nickname: settings.account.nickname, uid: settings.account.uid }
      case 'myAlbums': return { items: await myAlbums() }
      case 'songUrl': return { url: await songUrl(Number(args.id), Number(args.br) || 320000) }
      case 'lyric': return lyric(Number(args.id))
      case 'like': { await like(Number(args.id), args.like !== false); return { liked: args.like !== false } }
      case 'likedSet': return { ids: await likedIds() }
      case 'accountStatus': return { uid: settings.account.uid, nickname: settings.account.nickname, hasCookie: !!settings.account.cookie, persisted: !!settings.account.cookie }
      // 供 client 半部做 localStorage 持久化时导出 cookie(仅回环本地, 用于登录态恢复)。
      case 'exportAccount': return { cookie: settings.account.cookie || '', uid: settings.account.uid, nickname: settings.account.nickname }
      case 'setAccount': {
        const cookie = cleanCookieValue((args && args.cookie) || '')
        if (!cookie) throw new Error('请提供 Cookie')
        const prev = { cookie: settings.account.cookie, uid: settings.account.uid, nickname: settings.account.nickname }
        settings.account = { cookie, uid: null, nickname: '' }
        try {
          const info = await accountFromCookie(cookie)
          settings.account.uid = info.uid
          settings.account.nickname = info.nickname
          const persisted = await writeSettings()
          return { uid: settings.account.uid, nickname: settings.account.nickname, persisted }
        } catch (e) { settings.account = prev; throw e }
      }
      case 'clearAccount': {
        settings.account = { cookie: '', uid: null, nickname: '' }
        likePidCache = null
        await writeSettings()
        return {}
      }
      case 'saveState': { settings.state = args.state; await writeSettings(); return {} }
      case 'loadState': return { state: settings.state }
      case 'qrCreate': return qrCreate()
      case 'qrCheck': return qrCheck(String(args.key || ''))
      default: throw new Error('未知操作: ' + String(op))
    }
  }

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ncm/api',
    handler: async (req, res) => {
      const respond = (obj) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      try {
        const body = await readBody(req)
        let args = {}
        try { args = JSON.parse(body || '{}') } catch (e) { args = {} }
        const value = await dispatch(args)
        respond({ ok: true, value })
      } catch (e) {
        respond({ ok: false, error: { code: 'ncm_error', message: String((e && e.message) || e) } })
      }
    },
  }))

  // 自检
  try {
    const l = await hotPlaylists(3)
    console.log('ncm3: self-test OK — ' + l.length + ' playlists' + (settings.account.cookie ? '; account: ' + settings.account.nickname : ''))
  } catch (e) {
    console.error('ncm3: self-test failed: ' + String(e))
  }
}
