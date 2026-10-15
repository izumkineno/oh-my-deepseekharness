// mcp-server/tools/codeintel.mjs
// 代码智能 MCP（v0.4.0 P2-E，对标 OMC lsp_*/ast_grep_* 工具面）：
// - ast_grep_search / ast_grep_replace：@ast-grep/napi 结构化语法检索/重写（动态 import，
//   原生依赖缺席 → 显式报错，不静默降级成文本 grep）
// - lsp_*：LSP 语言服务器进程管理（vscode-jsonrpc stdio + vscode-languageserver-protocol，
//   注册表来自插件 Config codeIntel.lspServers 经 OMD_CODE_INTEL 环境变量注入）；
//   单 server 单实例、崩溃自动重启 ≤maxRestarts 次、进程随 MCP server 退出回收
// - 可配（OMD_CODE_INTEL ← Config codeIntel 段）：lsp.{initializeTimeoutMs,requestTimeoutMs,
//   shutdownTimeoutMs,maxRestarts,diagnosticsWaitMs} + search.{defaultMaxResults,hardMaxResults,
//   maxFiles,skipDirs}——resolveCodeIntelLimits 解析快照，缺席/非法一律回退存量默认值
//   （直调/旧挂载不炸 server；skipDirs 空数组=显式一个不跳，属合法值不回退）
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// ast-grep
// ---------------------------------------------------------------------------

/** 语言 → 扩展名映射（ast-grep Lang id 与 napi parse() 的语言串一致）。 */
export const LANG_EXT = {
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  python: ['.py'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'],
  csharp: ['.cs'],
  html: ['.html', '.htm'],
  css: ['.css'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
  markdown: ['.md'],
}
/** 默认跳过目录（与 Config codeIntel.search.skipDirs 默认值同源——改一处必须改另一处）。 */
const DEFAULT_SKIP_DIRS = ['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage']
const DEFAULT_MAX_RESULTS = 50
const HARD_MAX_RESULTS = 500
const DEFAULT_MAX_FILES = 2000

/**
 * 嵌套命中过滤（评审修复#3，实测文件损坏）：findAll 会返回嵌套命中（如 `$A + $B`
 * 命中 `a + b + c` 与其内层 `a + b`）——重叠编辑切片会写坏文件。保外层弃内层：
 * 凡范围被另一命中完整包含的命中直接过滤（保留最外层匹配集，彼此不重叠）。
 */
function dropNestedHits(hits) {
  const ranges = hits.map(h => ({ start: h.range().start.index, end: h.range().end.index }))
  return hits.filter((_, i) =>
    !ranges.some((r, j) => j !== i
      && r.start <= ranges[i].start && r.end >= ranges[i].end
      && (r.start < ranges[i].start || r.end > ranges[i].end)))
}

async function defaultLoadNapi() {
  try { return await import('@ast-grep/napi') }
  catch (e) {
    throw new Error(`ast_grep: @ast-grep/napi 加载失败（原生依赖缺席/不兼容）：${e?.message ?? e}——`
      + 'ast_grep_* 不可用（LSP 工具不受影响）；安装/重装依赖后重试，绝不静默降级成文本 grep')
  }
}

async function collectFiles(cwd, lang, paths, maxFiles = 2000, skip = DEFAULT_SKIP_DIRS) {
  const exts = LANG_EXT[lang]
  if (!exts) throw new Error(`ast_grep: 未知语言 '${lang}'（支持: ${Object.keys(LANG_EXT).join('/')}）`)
  const skipSet = new Set(skip)
  const roots = (paths?.length ? paths : ['.']).map(p => join(cwd, p))
  const out = []
  let truncated = false // 评审修复#14：截断不再静默
  async function walk(dir) {
    if (out.length >= maxFiles) { truncated = true; return }
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= maxFiles) { truncated = true; return }
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!skipSet.has(e.name)) await walk(full)
      } else if (exts.includes(extname(e.name).toLowerCase())) {
        out.push(full)
      }
    }
  }
  for (const r of roots) {
    // paths 也可直接指文件
    if (exts.includes(extname(r).toLowerCase())) { out.push(r); continue }
    await walk(r)
  }
  return { files: out, truncated }
}

/** 元变量替换：$NAME → getMatch(NAME)，$$$NAME → getMultipleMatches(NAME) 逗号联结
 * （multi-match 含匿名分隔符节点——实测逗号以 unnamed node 混入，过滤 isNamed 防 '2, ,, 3' 畸变）。 */
export function substituteRewrite(match, rewrite) {
  return rewrite
    .replace(/\$\$\$([A-Z_][A-Z0-9_]*)/g, (_, name) =>
      match.getMultipleMatches(name).filter(n => n.isNamed()).map(n => n.text()).join(', '))
    .replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) =>
      match.getMatch(name)?.text() ?? '')
}

// ---------------------------------------------------------------------------
// LSP 进程管理
// ---------------------------------------------------------------------------

const MAX_RESTARTS = 2
const DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_DIAGNOSTICS_WAIT_MS = 1500
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000

/** 正数超时解析：注册项自带值优先，缺席/非法回退全局值（损坏注册项不炸 server）。 */
function posTimeout(v, fb) {
  return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : fb
}

/**
 * MCP 进程 codeIntel 配置快照解析（env.codeIntel ← OMD_CODE_INTEL ← Config codeIntel 段）。
 * 缺席/非法（非数字/非正/NaN）一律回退存量默认值——直调、旧挂载、损坏 env 都不炸 server。
 * 计数类取整（env JSON 未经 schema 校验时防浮点 maxResults/maxRestarts）。
 */
export function resolveCodeIntelLimits(env) {
  const lspCfg = env?.codeIntel?.lsp ?? {}
  const searchCfg = env?.codeIntel?.search ?? {}
  const posOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : fb
  const nonNegOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : fb
  // 字符串数组：全字符串才合法（含空数组=显式一个不跳）；非数组/混入非字符串 → 回退默认
  const strArrOr = (v, fb) => (Array.isArray(v) && v.every(s => typeof s === 'string')) ? v : fb
  return {
    initializeTimeoutMs: posOr(lspCfg.initializeTimeoutMs, DEFAULT_INITIALIZE_TIMEOUT_MS),
    requestTimeoutMs: posOr(lspCfg.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    shutdownTimeoutMs: posOr(lspCfg.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS),
    maxRestarts: Math.floor(nonNegOr(lspCfg.maxRestarts, MAX_RESTARTS)),
    diagnosticsWaitMs: nonNegOr(lspCfg.diagnosticsWaitMs, DEFAULT_DIAGNOSTICS_WAIT_MS),
    defaultMaxResults: Math.floor(posOr(searchCfg.defaultMaxResults, DEFAULT_MAX_RESULTS)),
    hardMaxResults: Math.floor(posOr(searchCfg.hardMaxResults, HARD_MAX_RESULTS)),
    maxFiles: Math.floor(posOr(searchCfg.maxFiles, DEFAULT_MAX_FILES)),
    skipDirs: strArrOr(searchCfg.skipDirs, DEFAULT_SKIP_DIRS),
  }
}

/** vscode-jsonrpc/node 的动态导入（optionalDependencies 被 --no-optional 跳过时报可行动错误，评审修复#19）。 */
async function loadJsonrpc() {
  try { return await import('vscode-jsonrpc/node') }
  catch (e) {
    throw new Error(`lsp: vscode-jsonrpc 加载失败（optionalDependencies 未安装？npm install 时被 --no-optional 跳过）：${e?.message ?? e}——lsp_* 不可用（ast_grep_* 不受影响）`)
  }
}

/** 带超时的 sendRequest 包装：LSP 服务器无响应时 initialize/请求不得无限悬挂（实测确认缺陷）。 */
async function withTimeout(promise, ms, what) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`lsp: ${what} 超时（${ms}ms 无响应）——语言服务器可能挂起或崩溃`)), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

function guessLanguageId(file, fallback) {
  const ext = extname(file).toLowerCase()
  for (const [lang, exts] of Object.entries(LANG_EXT)) if (exts.includes(ext)) return lang
  return fallback ?? 'plaintext'
}

// 进程退出回收（评审修复#10：不再只靠子进程自觉检测 stdin EOF——MCP server 退出时
// 杀掉全部存活 LSP 子进程，行为不良服务器也不成孤儿）。模块级单钩子（防多实例
// MaxListeners 告警；exit 钩子只能同步 kill）。
const LIVE_SERVER_MAPS = new Set()
let exitHookArmed = false
function armExitHook() {
  if (exitHookArmed) return
  exitHookArmed = true
  process.once('exit', () => {
    for (const m of LIVE_SERVER_MAPS)
      for (const h of m.values()) { try { h.child.kill() } catch { /* 已退出 */ } }
  })
}

export function makeCodeIntelTools(env, opts = {}) {
  const loadNapi = opts.loadNapi ?? defaultLoadNapi
  const registry = env?.codeIntel?.lspServers ?? {}
  const limits = resolveCodeIntelLimits(env)
  /** 运行中 server：name → { child, connection, openDocs:Set, diagnostics:Map, restarts, starting } */
  const servers = new Map()
  /** 同名 server 并发启动去重（name → in-flight Promise）。 */
  const starting = new Map()
  /** 崩溃计数账本（独立于 servers 存活期——exit 时 servers 删条目，崩溃计数必须留存，
   *  否则 MAX_RESTARTS 预算永不生效（实测确认缺陷）；仅显式 lsp_stop 复位）。 */
  const crashLedger = new Map()

  // ---- ast-grep ----

  async function astGrepSearch({ cwd, pattern, lang, paths, maxResults = limits.defaultMaxResults }) {
    if (env?.codeIntel?.astGrep === false) throw new Error('ast_grep: 已被配置 codeIntel.astGrep=false 禁用')
    if (typeof pattern !== 'string' || !pattern) throw new Error('ast_grep_search: pattern 必填')
    const napi = await loadNapi()
    const limit = Math.min(Math.max(1, maxResults), limits.hardMaxResults)
    const { files, truncated: filesTruncated } = await collectFiles(cwd, lang, paths, limits.maxFiles, limits.skipDirs)
    const matches = []
    let truncated = false
    for (const file of files) {
      if (matches.length >= limit) { truncated = true; break }
      let src
      try { src = await readFile(file, 'utf8') } catch { continue }
      let root
      try { root = napi.parse(lang, src) } catch { continue } // 单文件解析失败不阻断扫描
      const hits = root.root().findAll({ rule: { pattern } })
      for (const h of hits) {
        if (matches.length >= limit) { truncated = true; break }
        const r = h.range()
        matches.push({
          file: relative(cwd, file).replaceAll('\\', '/'),
          line: r.start.line + 1, column: r.start.column + 1,
          endLine: r.end.line + 1, endColumn: r.end.column + 1,
          kind: h.kind(), text: h.text(),
        })
      }
    }
    return { pattern, lang, scannedFiles: files.length, filesTruncated, count: matches.length, truncated, matches }
  }

  async function astGrepReplace({ cwd, pattern, rewrite, lang, paths, dryRun = true, maxResults = limits.hardMaxResults }) {
    if (env?.codeIntel?.astGrep === false) throw new Error('ast_grep: 已被配置 codeIntel.astGrep=false 禁用')
    if (typeof rewrite !== 'string' || !rewrite) throw new Error('ast_grep_replace: rewrite 必填（$VAR 元变量引用 pattern 捕获）')
    const napi = await loadNapi()
    const { files, truncated: filesTruncated } = await collectFiles(cwd, lang, paths, limits.maxFiles, limits.skipDirs)
    const edits = []
    let changedFiles = 0
    for (const file of files) {
      if (edits.length >= maxResults) break
      let src
      try { src = await readFile(file, 'utf8') } catch { continue }
      let root
      try { root = napi.parse(lang, src) } catch { continue }
      const hits = dropNestedHits(root.root().findAll({ rule: { pattern } }))
      if (!hits.length) continue
      // 逆序应用编辑（索引不漂移）
      const fileEdits = hits.map(h => ({
        start: h.range().start.index, end: h.range().end.index,
        before: h.text(), after: substituteRewrite(h, rewrite),
      })).sort((a, b) => b.start - a.start)
      let next = src
      for (const e of fileEdits) next = next.slice(0, e.start) + e.after + next.slice(e.end)
      changedFiles++
      for (const e of fileEdits.reverse()) {
        const line = src.slice(0, e.start).split('\n').length
        edits.push({ file: relative(cwd, file).replaceAll('\\', '/'), line, before: e.before, after: e.after })
      }
      if (!dryRun) await writeFile(file, next, 'utf8')
    }
    return { pattern, rewrite, lang, dryRun, changedFiles, filesTruncated, editCount: edits.length, edits: edits.slice(0, limits.hardMaxResults) }
  }

  // ---- LSP ----

  function registryEntry(name) {
    const entry = registry[name]
    if (!entry) throw new Error(`lsp: 未注册的语言服务器 '${name}'（Config codeIntel.lspServers 已注册: ${Object.keys(registry).join('/') || '无'}）`)
    if (!entry.command) throw new Error(`lsp: 注册项 '${name}' 缺 command`)
    return entry
  }

  async function connect(name, entry, cwd) {
    const child = spawn(entry.command, entry.args ?? [], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(entry.env ?? {}) },
    })
    child.stderr?.on('data', () => {}) // spawn 后立即排干 stderr（评审修复#9：启动期 >64KB 输出会写阻塞死锁握手）
    const killAndWait = async () => {
      try { child.kill() } catch { /* 已退出 */ }
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 1000)
        t.unref?.()
        if (child.exitCode !== null) { clearTimeout(t); resolve() }
        else child.once('exit', () => { clearTimeout(t); resolve() })
      })
    }
    // spawn 确认（评审修复#1 根因）：'error'（ENOENT 等）与 'spawn' 成功事件竞争——
    // 监听在 spawn 同一拍挂上，杜绝「动态 import 期间 error 先发射而无监听 → uncaught
    // 打崩整个 MCP server」。ENOENT 在此显式报错，连接根本不会创建（连写错误一并消除）。
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('spawn', resolve)
      })
    } catch (err) {
      await killAndWait()
      throw new Error(`lsp: server '${name}' 进程启动失败（command='${entry.command}'）：${err?.message ?? err}——检查 codeIntel.lspServers 注册的可执行路径`)
    }
    child.on('error', () => {}) // 持久兜底：spawn 确认后任何迟到 error 都不再 uncaught
    try {
      return await handshake(name, entry, cwd, child)
    } catch (e) {
      // kill 后等真退出（≤1s）再抛出——调用方常紧接着清理 cwd，未退进程会占文件锁（EBUSY 实测）
      await killAndWait()
      throw e
    }
  }

  async function handshake(name, entry, cwd, child) {
    const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = await loadJsonrpc()
    // spawn 已在 connect 确认（'spawn' 事件胜出）；此处只需防「握手期间进程死亡」——
    // 进程 exit → initialize 悬挂，转成显式拒绝（与 initializeTimeoutMs 双保险）
    let handshakeDone = false
    let onDied
    const died = new Promise((_, rej) => {
      onDied = () => { if (!handshakeDone) rej(new Error(`lsp: server '${name}' 进程在 initialize 握手期间退出——语言服务器可能启动即崩（看其自身日志）`)) }
    })
    child.once('exit', onDied)
    died.catch(() => {}) // race 未消费的路径不产生 unhandled rejection
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    )
    connection.onError(() => {}) // 库内部流错误（如写已毁流）必须有人接盘——否则 uncaught/unhandled（评审修复#1 残余实测）
    const handle = {
      name, child, connection, cwd,
      openDocs: new Set(), diagnostics: new Map(), restarts: servers.get(name)?.restarts ?? 0,
      closed: false,
    }
    connection.onNotification('textDocument/publishDiagnostics', (p) => {
      handle.diagnostics.set(p.uri, p.diagnostics ?? [])
    })
    child.on('exit', () => {
      handle.closed = true
      servers.delete(name)
      crashLedger.set(name, (crashLedger.get(name) ?? 0) + 1) // 崩溃入账（预算账本，lsp_stop 才复位）
    })
    connection.onClose(() => { handle.closed = true })
    connection.listen()
    const { URI } = await import('vscode-uri')
    const initReq = withTimeout(connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: URI.file(cwd).toString(),
      capabilities: {
        textDocument: {
          documentSymbol: { hierarchicalDocumentSymbolSupport: false },
          references: {}, definition: {}, publishDiagnostics: {},
        },
      },
      workspaceFolders: [{ uri: URI.file(cwd).toString(), name: 'workspace' }],
      clientInfo: { name: 'omd-codeintel', version: '0.4.0' },
    }), posTimeout(entry.initializeTimeoutMs, limits.initializeTimeoutMs), `server '${name}' initialize 握手`)
    initReq.catch(() => {}) // race 已定胜负后，迟到的 initialize 拒绝不再上报（防 unhandled rejection）
    await Promise.race([initReq, died])
    handshakeDone = true
    child.removeListener('exit', onDied)
    await connection.sendNotification('initialized', {})
    return handle
  }

  async function ensureServer(name, cwd) {
    const cur = servers.get(name)
    if (cur && !cur.closed) return cur
    if (cur?.closed) servers.delete(name)
    // 并发 lsp_start 去重（评审修复#12：并发双 spawn 会有一个脱离追踪永不回收）
    if (starting.has(name)) return starting.get(name)
    const entry = registryEntry(name)
    const crashes = crashLedger.get(name) ?? 0
    if (crashes >= limits.maxRestarts)
      throw new Error(`lsp: server '${name}' 崩溃重启已达上限（${crashes}/${limits.maxRestarts}）——检查语言服务器安装后调 lsp_stop 复位预算再 lsp_start`)
    const p = (async () => {
      const handle = await connect(name, entry, cwd)
      handle.restarts = crashes
      servers.set(name, handle)
      return handle
    })()
    starting.set(name, p)
    try { return await p }
    finally { starting.delete(name) }
  }

  async function ensureDoc(handle, file) {
    const { URI } = await import('vscode-uri')
    const uri = URI.file(file).toString()
    if (handle.openDocs.has(uri)) return uri
    const text = await readFile(file, 'utf8')
    await handle.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: guessLanguageId(file, registry[handle.name]?.languages?.[0]), version: 1, text },
    })
    handle.openDocs.add(uri)
    return uri
  }

  const normLoc = (l) => l ? {
    uri: l.uri, range: l.range,
    file: l.uri?.startsWith('file://') ? decodeURIComponent(new URL(l.uri).pathname).replace(/^\/([A-Za-z]:)/, '$1') : l.uri,
  } : null

  async function lspStart({ cwd, server }) {
    const handle = await ensureServer(server, cwd)
    return { ok: true, server, pid: handle.child.pid, openDocs: handle.openDocs.size }
  }

  async function lspStop({ server }) {
    const handle = servers.get(server)
    crashLedger.delete(server) // 显式 stop 复位崩溃预算（允许干净地再 start；未运行也复位）
    if (!handle) return { ok: true, server, note: '未运行' }
    try { await withTimeout(handle.connection.sendRequest('shutdown'), limits.shutdownTimeoutMs, `server '${server}' shutdown`) } catch { /* 已死/不回应也继续回收 */ }
    try { await handle.connection.sendNotification('exit') } catch { /* 同上 */ }
    handle.restarts = 0 // 显式 stop 重置重启预算（允许干净地再 start）
    servers.delete(server)
    // 等子进程真退出（≤2s）再返回——调用方（含测试）常紧接着清理 cwd，进程未退会占文件锁（EBUSY）
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { handle.child.kill() } catch { /* 已退出 */ } resolve() }, 2000)
      timer.unref?.()
      if (handle.child.exitCode !== null || handle.closed) { clearTimeout(timer); resolve() }
      else handle.child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    return { ok: true, server, stopped: true }
  }

  async function lspStatus() {
    return {
      registered: Object.keys(registry),
      running: [...servers.values()].filter(h => !h.closed)
        .map(h => ({ server: h.name, pid: h.child.pid, openDocs: h.openDocs.size, restarts: h.restarts })),
    }
  }

  async function lspDocumentSymbols({ cwd, server, file }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const result = await withTimeout(handle.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    }), limits.requestTimeoutMs, `server '${server}' documentSymbol`)
    const flat = []
    const walk = (syms, container) => {
      for (const s of syms ?? []) {
        flat.push({
          name: s.name, kind: s.kind, container: container ?? null,
          line: (s.selectionRange ?? s.range)?.start?.line + 1,
        })
        if (s.children) walk(s.children, s.name)
      }
    }
    if (Array.isArray(result) && result[0]?.location) {
      // DocumentSymbol[] 之外还有 SymbolInformation[] 形态
      for (const s of result) flat.push({ name: s.name, kind: s.kind, container: s.containerName ?? null, line: s.location.range.start.line + 1 })
    } else walk(result)
    return { server, file, count: flat.length, symbols: flat }
  }

  async function lspReferences({ cwd, server, file, line, character }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const result = await withTimeout(handle.connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 }, // 输入 1-based，LSP 0-based
      context: { includeDeclaration: true },
    }), limits.requestTimeoutMs, `server '${server}' references`)
    return { server, file, count: result?.length ?? 0, locations: (result ?? []).map(normLoc) }
  }

  async function lspDefinition({ cwd, server, file, line, character }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const result = await withTimeout(handle.connection.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    }), limits.requestTimeoutMs, `server '${server}' definition`)
    const locs = Array.isArray(result) ? result : (result ? [result] : [])
    return { server, file, count: locs.length, locations: locs.map(l => normLoc(l?.targetUri ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l)) }
  }

  async function lspDiagnostics({ cwd, server, file, waitMs = limits.diagnosticsWaitMs }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const deadline = Date.now() + Math.max(0, waitMs)
    while (!handle.diagnostics.has(uri) && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 50))
    const diags = handle.diagnostics.get(uri) ?? []
    return {
      server, file, count: diags.length,
      diagnostics: diags.map(d => ({
        line: d.range.start.line + 1, character: d.range.start.character + 1,
        severity: d.severity ?? null, code: d.code ?? null, source: d.source ?? null, message: d.message,
      })),
    }
  }

  // 进程退出回收（评审修复#10）：模块级单钩子（防多实例 MaxListeners 告警）
  armExitHook()
  LIVE_SERVER_MAPS.add(servers)

  return {
    astGrepSearch, astGrepReplace,
    lspStart, lspStop, lspStatus, lspDocumentSymbols, lspReferences, lspDefinition, lspDiagnostics,
    _servers: servers, // 测试观测面
    _disposeExitHook: () => { // 测试/收尾用：摘除本实例登记并就地清杀
      LIVE_SERVER_MAPS.delete(servers)
      for (const h of servers.values()) { try { h.child.kill() } catch { /* 已退出 */ } }
    },
  }
}

export function registerCodeIntelTools(server, env) {
  const t = makeCodeIntelTools(env)
  const limits = resolveCodeIntelLimits(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const base = { cwd: z.string() }
  const astBase = { ...base, pattern: z.string(), lang: z.string(), paths: z.array(z.string()).optional() }

  server.registerTool('ast_grep_search', {
    description: 'ast-grep 结构化语法检索（$VAR/$$$VARS 元变量模式；按语言过滤文件；返回 file:line 命中，有界）',
    inputSchema: { ...astBase, maxResults: z.number().int().min(1).max(limits.hardMaxResults).optional() },
  }, async a => jsonOut(await t.astGrepSearch(a)))

  server.registerTool('ast_grep_replace', {
    description: 'ast-grep 结构化重写（pattern 捕获 $VAR → rewrite 引用；dryRun 默认 true 只出计划不落盘）',
    inputSchema: { ...astBase, rewrite: z.string(), dryRun: z.boolean().optional(), maxResults: z.number().int().optional() },
  }, async a => jsonOut(await t.astGrepReplace(a)))

  const lspBase = { ...base, server: z.string() }
  const lspPos = { ...lspBase, file: z.string(), line: z.number().int().min(1), character: z.number().int().min(1) }

  server.registerTool('lsp_start', {
    description: `启动已注册的语言服务器（Config codeIntel.lspServers 注册表；单实例，崩溃重启 ≤${limits.maxRestarts}）`,
    inputSchema: lspBase,
  }, async a => jsonOut(await t.lspStart(a)))

  server.registerTool('lsp_stop', {
    description: '关闭语言服务器（shutdown+exit；显式 stop 重置崩溃重启预算）',
    inputSchema: { server: z.string() },
  }, async a => jsonOut(await t.lspStop(a)))

  server.registerTool('lsp_status', {
    description: 'LSP 状态（已注册注册表 + 运行中 server/openDocs/重启计数）',
    inputSchema: {},
  }, async a => jsonOut(await t.lspStatus(a)))

  server.registerTool('lsp_document_symbols', {
    description: '文档符号（函数/类/变量大纲；自动 didOpen）',
    inputSchema: { ...lspBase, file: z.string() },
  }, async a => jsonOut(await t.lspDocumentSymbols(a)))

  server.registerTool('lsp_references', {
    description: '符号引用（line/character 为 1-based）',
    inputSchema: lspPos,
  }, async a => jsonOut(await t.lspReferences(a)))

  server.registerTool('lsp_definition', {
    description: '跳转定义（line/character 为 1-based）',
    inputSchema: lspPos,
  }, async a => jsonOut(await t.lspDefinition(a)))

  server.registerTool('lsp_diagnostics', {
    description: '文件诊断（等 publishDiagnostics 至 waitMs；返回 severity/message 有界列表）',
    inputSchema: { ...lspBase, file: z.string(), waitMs: z.number().int().min(0).max(30000).optional() },
  }, async a => jsonOut(await t.lspDiagnostics(a)))
}
