// tests/mcp-server/codeintel.test.js
// v0.4 P2-E 代码智能 MCP 验收：
// ① ast_grep_search：元变量模式命中 file:line、语言过滤、跳过 node_modules/.omd、maxResults 有界
// ② ast_grep_replace：dryRun 只出计划不落盘；dryRun=false 应用且 $VAR/$$$VARS 替换正确（逆序编辑不漂移）
// ③ napi 缺席 → 显式报错（不静默降级成文本 grep）
// ④ LSP：mock server 全链 start→symbols/references/definition/diagnostics→stop；未注册 server 显式报错
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeCodeIntelTools, resolveCodeIntelLimits, substituteRewrite } from '../../mcp-server/tools/codeintel.mjs'

const MOCK_LSP = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'mock-lsp.mjs')

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-ci-'))
  await mkdir(join(cwd, 'src'), { recursive: true })
  await mkdir(join(cwd, 'node_modules', 'junk'), { recursive: true })
  await writeFile(join(cwd, 'src', 'a.js'), 'function foo(a) { return a + 1 }\nconst x = foo(1)\nconsole.log(foo(2, 3))\n')
  await writeFile(join(cwd, 'src', 'b.js'), 'const y = foo(9)\n')
  await writeFile(join(cwd, 'src', 'c.ts'), 'const z: number = foo(5)\n')
  await writeFile(join(cwd, 'node_modules', 'junk', 'dep.js'), 'foo(0)\n')
  return cwd
}

// ---------- ① ast_grep_search ----------

test('ast_grep_search：元变量命中带 file:line/kind/text，跳过 node_modules', async () => {
  const cwd = await fixture()
  try {
    const t = makeCodeIntelTools({ codeIntel: {} })
    const r = await t.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript' })
    expect(r.count).toBe(2) // a.js 的 foo(1)；b.js 的 foo(9)——node_modules 不计
    expect(r.matches.every(m => m.file.startsWith('src/'))).toBe(true)
    const m0 = r.matches.find(m => m.file.endsWith('a.js'))
    expect(m0.line).toBe(2)
    expect(m0.kind).toBe('call_expression')
    expect(m0.text).toBe('foo(1)')
    expect(r.scannedFiles).toBe(2) // c.ts 不是 javascript 扩展
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('ast_grep_search：$$$ 元变量、paths 限定、maxResults 有界截断', async () => {
  const cwd = await fixture()
  try {
    const t = makeCodeIntelTools({ codeIntel: {} })
    const multi = await t.astGrepSearch({ cwd, pattern: 'foo($$$ARGS)', lang: 'javascript' })
    expect(multi.count).toBe(3) // foo(1) / foo(2,3) / foo(9)
    const only = await t.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript', paths: ['src/b.js'] })
    expect(only.count).toBe(1)
    const bound = await t.astGrepSearch({ cwd, pattern: 'foo($$$ARGS)', lang: 'javascript', maxResults: 2 })
    expect(bound.count).toBe(2)
    expect(bound.truncated).toBe(true)
    await expect(t.astGrepSearch({ cwd, pattern: 'x()', lang: 'cobol' })).rejects.toThrow('未知语言')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('ast_grep_search：typescript 扫描 .ts 文件', async () => {
  const cwd = await fixture()
  try {
    const t = makeCodeIntelTools({ codeIntel: {} })
    const r = await t.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'typescript' })
    expect(r.count).toBe(1)
    expect(r.matches[0].file).toBe('src/c.ts')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------- ② ast_grep_replace ----------

test('ast_grep_replace：dryRun 不落盘；dryRun=false 应用 $A 替换且多命中不漂移', async () => {
  const cwd = await fixture()
  try {
    const t = makeCodeIntelTools({ codeIntel: {} })
    const file = join(cwd, 'src', 'b.js')
    const before = await readFile(file, 'utf8')

    const plan = await t.astGrepReplace({ cwd, pattern: 'foo($A)', rewrite: 'bar($A)', lang: 'javascript', paths: ['src/b.js'] })
    expect(plan.dryRun).toBe(true)
    expect(plan.editCount).toBe(1)
    expect(plan.edits[0]).toMatchObject({ file: 'src/b.js', before: 'foo(9)', after: 'bar(9)' })
    expect(await readFile(file, 'utf8')).toBe(before) // dryRun 不落盘

    const applied = await t.astGrepReplace({ cwd, pattern: 'foo($A)', rewrite: 'bar($A)', lang: 'javascript', paths: ['src/b.js'], dryRun: false })
    expect(applied.dryRun).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('const y = bar(9)\n')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('ast_grep_replace：同文件多命中逆序编辑不漂移 + $$$ 替换', async () => {
  const cwd = await fixture()
  try {
    await writeFile(join(cwd, 'src', 'multi.js'), 'foo(1)\nfoo(2, 3)\n')
    const t = makeCodeIntelTools({ codeIntel: {} })
    await t.astGrepReplace({ cwd, pattern: 'foo($$$ARGS)', rewrite: 'baz($$$ARGS)', lang: 'javascript', paths: ['src/multi.js'], dryRun: false })
    expect(await readFile(join(cwd, 'src', 'multi.js'), 'utf8')).toBe('baz(1)\nbaz(2, 3)\n')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('substituteRewrite：单/多元变量与缺捕获兜底（匿名分隔符节点被过滤）', () => {
  const named = (t) => ({ text: () => t, isNamed: () => true })
  const anon = (t) => ({ text: () => t, isNamed: () => false })
  const fake = {
    getMatch: (n) => (n === 'A' ? named('x') : null),
    getMultipleMatches: (n) => (n === 'REST' ? [named('1'), anon(','), named('2')] : []),
  }
  expect(substituteRewrite(fake, 'bar($A, $$$REST)')).toBe('bar(x, 1, 2)')
  expect(substituteRewrite(fake, 'bar($MISSING)')).toBe('bar()')
})

// ---------- ③ napi 缺席显式报错 ----------

test('napi 加载失败 → 显式报错（不静默降级）；astGrep=false 配置禁用同样显式', async () => {
  const cwd = await fixture()
  try {
    const t = makeCodeIntelTools({ codeIntel: {} }, { loadNapi: async () => { throw new Error('mock: 原生绑定缺失') } })
    await expect(t.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript' })).rejects.toThrow('mock: 原生绑定缺失')
    const disabled = makeCodeIntelTools({ codeIntel: { astGrep: false } })
    await expect(disabled.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript' })).rejects.toThrow('禁用')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------- ④ LSP（mock server 全链） ----------

function lspTools() {
  return makeCodeIntelTools({
    codeIntel: {
      lspServers: { mock: { command: process.execPath, args: [MOCK_LSP], languages: ['javascript'] } },
    },
  })
}

test('lsp 全链：start → symbols/references/definition/diagnostics → status → stop', async () => {
  const cwd = await fixture()
  const t = lspTools()
  try {
    const started = await t.lspStart({ cwd, server: 'mock' })
    expect(started.ok).toBe(true)
    expect(started.pid).toBeGreaterThan(0)

    const syms = await t.lspDocumentSymbols({ cwd, server: 'mock', file: 'src/a.js' })
    expect(syms.count).toBe(2)
    expect(syms.symbols.map(s => s.name)).toEqual(['foo', 'Bar'])
    expect(syms.symbols[0].line).toBe(1) // 0-based → 1-based 转换

    const refs = await t.lspReferences({ cwd, server: 'mock', file: 'src/a.js', line: 1, character: 10 })
    expect(refs.count).toBe(2)
    expect(refs.locations[0].file).toContain('a.js')

    const def = await t.lspDefinition({ cwd, server: 'mock', file: 'src/a.js', line: 1, character: 10 })
    expect(def.count).toBe(1)
    expect(def.locations[0].range.start.line).toBe(0) // LSP 原始 0-based range 透传

    const diags = await t.lspDiagnostics({ cwd, server: 'mock', file: 'src/a.js', waitMs: 2000 })
    expect(diags.count).toBe(1)
    expect(diags.diagnostics[0]).toMatchObject({ line: 1, severity: 2, code: 'mock-warning' })

    const status = await t.lspStatus()
    expect(status.registered).toEqual(['mock'])
    expect(status.running).toHaveLength(1)
    expect(status.running[0].openDocs).toBe(1)

    const stopped = await t.lspStop({ server: 'mock' })
    expect(stopped.stopped).toBe(true)
    const status2 = await t.lspStatus()
    expect(status2.running).toHaveLength(0)
  } finally {
    // 兜底回收（测试失败也不留子进程）
    try { await t.lspStop({ server: 'mock' }) } catch { /* 已停 */ }
    await rm(cwd, { recursive: true, force: true })
  }
}, 20000)

test('lsp：未注册 server 显式报错；lsp_stop 未运行幂等', async () => {
  const cwd = await fixture()
  const t = lspTools()
  try {
    await expect(t.lspStart({ cwd, server: 'typescript' })).rejects.toThrow("未注册的语言服务器 'typescript'")
    const r = await t.lspStop({ server: 'never-started' })
    expect(r.note).toBe('未运行')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------- 评审修复回归（v0.4.1） ----------

test('评审#2：spawn 不存在的 command → 显式报错而非打崩 MCP server', async () => {
  const cwd = await fixture()
  const t = makeCodeIntelTools({
    codeIntel: { lspServers: { ghost: { command: 'definitely-not-a-real-binary-omd-xyz', args: [], languages: [] } } },
  })
  try {
    await expect(t.lspStart({ cwd, server: 'ghost' })).rejects.toThrow(/启动失败|ENOENT|exit|write after a stream/i)
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 20000)

test('评审#4：initialize 无响应 → initializeTimeoutMs 内显式超时（不无限悬挂）', async () => {
  const cwd = await fixture()
  // 挂起服务器：读 stdin 但永不回复
  const t = makeCodeIntelTools({
    codeIntel: {
      lspServers: {
        hung: { command: process.execPath, args: ['-e', 'process.stdin.resume()'], languages: [], initializeTimeoutMs: 800 },
      },
    },
  })
  try {
    const start = Date.now()
    await expect(t.lspStart({ cwd, server: 'hung' })).rejects.toThrow(/超时/)
    expect(Date.now() - start).toBeLessThan(5000) // 在注入的 800ms 超时附近失败，不悬挂
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 20000)

test('评审：崩溃预算真实生效（2 次崩溃后第 3 次拒绝；lsp_stop 复位）', async () => {
  const cwd = await fixture()
  const t = makeCodeIntelTools({
    codeIntel: {
      lspServers: {
        crasher: { command: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(1),100)'], languages: [], initializeTimeoutMs: 500 },
      },
    },
  })
  try {
    for (let i = 0; i < 3; i++) {
      await t.lspStart({ cwd, server: 'crasher' }).catch(() => {}) // 握手多半超时/失败，child 随后 exit 入账
      await new Promise(r => setTimeout(r, 300)) // 等 exit 事件入账
    }
    // 崩溃 ≥2 后拒绝（预算账本独立于 servers 存活期）
    await expect(t.lspStart({ cwd, server: 'crasher' })).rejects.toThrow(/崩溃重启已达上限/)
    await t.lspStop({ server: 'crasher' }) // 显式 stop 复位预算
    // 复位后不再因预算拒绝（可能因握手失败抛别的错，但不是预算错）
    await expect(t.lspStart({ cwd, server: 'crasher' })).rejects.toThrow(/^(?!.*崩溃重启已达上限).*$/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 30000)

test('评审#3：astGrep=false 时 replace 同样显式禁用（search 不再独木难支）', async () => {
  const cwd = await fixture()
  try {
    const t = makeCodeIntelTools({ codeIntel: { astGrep: false } })
    await expect(t.astGrepReplace({ cwd, pattern: 'foo($A)', rewrite: 'bar($A)', lang: 'javascript' })).rejects.toThrow('禁用')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------- ⑤ OMD_CODE_INTEL 快照解析（Config codeIntel 段 → lsp/search 全局参数） ----------

test('resolveCodeIntelLimits：缺席 env 回退存量默认（直调/旧挂载不炸）', () => {
  expect(resolveCodeIntelLimits(undefined)).toEqual({
    initializeTimeoutMs: 10000, requestTimeoutMs: 15000, shutdownTimeoutMs: 5000, maxRestarts: 2, diagnosticsWaitMs: 1500,
    defaultMaxResults: 50, hardMaxResults: 500, maxFiles: 2000,
    skipDirs: ['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'],
  })
  expect(resolveCodeIntelLimits({})).toEqual(resolveCodeIntelLimits(undefined))
  expect(resolveCodeIntelLimits({ codeIntel: {} })).toEqual(resolveCodeIntelLimits(undefined))
})

test('resolveCodeIntelLimits：env 覆盖生效；非法值回退默认（不炸 server）', () => {
  const limits = resolveCodeIntelLimits({ codeIntel: {
    lsp: { initializeTimeoutMs: 3000, requestTimeoutMs: 5000, shutdownTimeoutMs: 8000, maxRestarts: 5, diagnosticsWaitMs: 300 },
    search: { defaultMaxResults: 10, hardMaxResults: 100, maxFiles: 500, skipDirs: ['src'] },
  } })
  expect(limits).toEqual({
    initializeTimeoutMs: 3000, requestTimeoutMs: 5000, shutdownTimeoutMs: 8000, maxRestarts: 5, diagnosticsWaitMs: 300,
    defaultMaxResults: 10, hardMaxResults: 100, maxFiles: 500, skipDirs: ['src'],
  })
  // 空数组=显式一个不跳（合法值，不回退）
  expect(resolveCodeIntelLimits({ codeIntel: { search: { skipDirs: [] } } }).skipDirs).toEqual([])
  const bad = resolveCodeIntelLimits({ codeIntel: {
    lsp: { initializeTimeoutMs: -1, requestTimeoutMs: NaN, shutdownTimeoutMs: 0, maxRestarts: 'x', diagnosticsWaitMs: -5 },
    search: { defaultMaxResults: 0, hardMaxResults: 2.7, maxFiles: null, skipDirs: 'node_modules' },
  } })
  expect(bad).toEqual({
    initializeTimeoutMs: 10000, requestTimeoutMs: 15000, shutdownTimeoutMs: 5000, maxRestarts: 2, diagnosticsWaitMs: 1500,
    defaultMaxResults: 50, hardMaxResults: 2, maxFiles: 2000, // hardMaxResults=2.7 取整（正数合法）
    skipDirs: ['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'], // 非数组回退默认
  })
  // 混入非字符串 → 回退默认
  expect(resolveCodeIntelLimits({ codeIntel: { search: { skipDirs: ['src', 42] } } }).skipDirs)
    .toEqual(['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'])
})

test('ast_grep_search：search.defaultMaxResults/hardMaxResults 经 env 生效', async () => {
  const cwd = await fixture()
  try {
    // a.js 3 命中 + b.js 1 命中 + c.ts 1 命中 = 5（javascript+typescript 都扫？lang 过滤——只 javascript：a.js 3 + b.js 1 = 4）
    const t = makeCodeIntelTools({ codeIntel: { search: { defaultMaxResults: 2, hardMaxResults: 3 } } })
    const r = await t.astGrepSearch({ cwd, pattern: 'foo($$$ARGS)', lang: 'javascript' })
    expect(r.count).toBe(2) // 默认 2（非 50）
    expect(r.truncated).toBe(true)
    const r2 = await t.astGrepSearch({ cwd, pattern: 'foo($$$ARGS)', lang: 'javascript', maxResults: 99 })
    expect(r2.count).toBe(3) // 调用值 99 被 hard 3 钳制
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('ast_grep_search：search.skipDirs 经 env 生效（缺席=默认 8 项；显式覆盖）', async () => {
  const cwd = await fixture() // fixture 含 node_modules/junk/dep.js（foo(0) 单命中）
  try {
    // 缺席 → 默认跳过 node_modules：a.js 的 foo(1) + b.js 的 foo(9) = 2
    const t0 = makeCodeIntelTools({ codeIntel: {} })
    const r0 = await t0.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript' })
    expect(r0.count).toBe(2)
    // 显式 [] → 一个不跳：dep.js 的 foo(0) 也计入 = 3
    const t1 = makeCodeIntelTools({ codeIntel: { search: { skipDirs: [] } } })
    const r1 = await t1.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript' })
    expect(r1.count).toBe(3)
    expect(r1.matches.some(m => m.file.includes('node_modules'))).toBe(true)
    // 显式 ['src'] → 只跳 src：仅 dep.js = 1
    const t2 = makeCodeIntelTools({ codeIntel: { search: { skipDirs: ['src'] } } })
    const r2 = await t2.astGrepSearch({ cwd, pattern: 'foo($A)', lang: 'javascript' })
    expect(r2.count).toBe(1)
    expect(r2.matches[0].file.includes('dep.js')).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
