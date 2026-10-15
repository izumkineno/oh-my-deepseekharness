// tests/lib/config.test.js
// Config schema 验收：默认值/覆盖/拒绝（存量 7 例，volatile 解包适配）+
// GUI 配置列表 41 叶全覆盖（volatile 标记/新增组默认/P0 缺口补齐/校验边界）。
//
// 约定：volatile 叶经 Config.parse 后是 cosmokit Volatile 引用——断言经 configValue()
// 解包（与 lib 读面同一函数），存在性经 `typeof v.get === 'function'` 判定。
import { test, expect } from 'vitest'
import { Config, configValue, plainConfig, resolveModel } from '../../lib/config.js'

test('默认值符合规格 §4.3（S8-C1：档位 id 对齐部署 LLM 服务，S1 差分证据 glm-5.3-flash 可解析）', () => {
  const c = Config.parse({})
  expect(configValue(c.language)).toBe('zh')
  expect(plainConfig(c.tiers)).toEqual({ low: 'glm-5.3-flash', medium: 'glm-5.3-flash', high: 'glm-5.3-flash' })
  expect(configValue(c.stateDir)).toBe('.omd')
  expect(plainConfig(c.autopilot)).toEqual({ maxIterations: 10, maxQaCycles: 5, maxValidationRounds: 3 })
})

test('deepInterview 默认值（终审修复 #3：deep-interview skill 引用的键必须存在）', () => {
  const c = Config.parse({})
  expect(plainConfig(c.deepInterview)).toEqual({ ambiguityThreshold: 0.2, maxRounds: 20, softWarningRounds: 10 })
})

test('routing.defaultTier 默认 medium（c3 会话默认档）；非法档位拒绝', () => {
  const c = Config.parse({})
  expect(configValue(c.routing.defaultTier)).toBe('medium')
  expect(configValue(Config.parse({ routing: { defaultTier: 'low' } }).routing.defaultTier)).toBe('low')
  expect(() => Config.parse({ routing: { defaultTier: 'ultra' } })).toThrow()
})

test('deepInterview 可覆盖且非法值拒绝', () => {
  const c = Config.parse({ deepInterview: { ambiguityThreshold: 0.5 } })
  expect(configValue(c.deepInterview.ambiguityThreshold)).toBe(0.5)
  expect(configValue(c.deepInterview.maxRounds)).toBe(20)   // 其余键保留默认
  expect(() => Config.parse({ deepInterview: { maxRounds: 0 } })).toThrow()
})

test('resolveModel：roleOverrides 优先于 tiers', () => {
  const c = Config.parse({ tiers: { high: 'x/y' }, roleOverrides: { 'omd-agent-planner': 'a/b' } })
  expect(resolveModel(c, { name: 'omd-agent-planner', tier: 'high' })).toBe('a/b')
  expect(resolveModel(c, { name: 'omd-agent-code-reviewer', tier: 'high' })).toBe('x/y')
})

test("resolveModel：档位值 'inherit' 返回 undefined（委派时不填 model）", () => {
  const c = Config.parse({ tiers: { low: 'inherit' } })
  expect(resolveModel(c, { name: 'omd-agent-explore', tier: 'low' })).toBeUndefined()
})

test('非法 language 拒绝', () => {
  expect(() => Config.parse({ language: 'fr' })).toThrow()
})

// ---- GUI 配置列表：41 叶 volatile 标记全覆盖（组不标、叶标；别名不标） ----

const LEAF_PATHS = [
  ['language'],
  ['tiers', 'low'], ['tiers', 'medium'], ['tiers', 'high'],
  ['roleOverrides'],
  ['routing', 'defaultTier'], ['routing', 'lowMax'], ['routing', 'mediumMax'],
  ['stateDir'],
  ['autopilot', 'maxIterations'], ['autopilot', 'maxQaCycles'], ['autopilot', 'maxValidationRounds'],
  ['deepInterview', 'ambiguityThreshold'], ['deepInterview', 'maxRounds'], ['deepInterview', 'softWarningRounds'],
  ['team', 'heartbeatIntervalMs'], ['team', 'staleAfterMs'], ['team', 'maxFixLoops'], ['team', 'casRetries'],
  ['codeIntel', 'astGrep'], ['codeIntel', 'lspServers'],
  ['codeIntel', 'lsp', 'initializeTimeoutMs'], ['codeIntel', 'lsp', 'requestTimeoutMs'],
  ['codeIntel', 'lsp', 'shutdownTimeoutMs'], ['codeIntel', 'lsp', 'maxRestarts'], ['codeIntel', 'lsp', 'diagnosticsWaitMs'],
  ['codeIntel', 'search', 'defaultMaxResults'], ['codeIntel', 'search', 'hardMaxResults'], ['codeIntel', 'search', 'maxFiles'],
  ['codeIntel', 'search', 'skipDirs'],
  ['hud', 'preset'], ['hud', 'refreshMs'],
  ['delegate', 'provider'],
  ['mcp', 'transport'], ['mcp', 'serverName'], ['mcp', 'failOnStartupError'],
  ['mcp', 'reconnect', 'enabled'], ['mcp', 'reconnect', 'initialDelayMs'],
  ['mcp', 'reconnect', 'maxDelayMs'], ['mcp', 'reconnect', 'maxAttempts'],
  ['memory', 'workingTtlDays'],
]
const GROUP_PATHS = [
  ['tiers'], ['routing'], ['autopilot'], ['deepInterview'], ['team'],
  ['codeIntel'], ['codeIntel', 'lsp'], ['codeIntel', 'search'],
  ['hud'], ['delegate'], ['mcp'], ['mcp', 'reconnect'], ['memory'],
]
const at = (c, path) => path.reduce((o, k) => o?.[k], c)

test('GUI 41 叶全部 volatile（可编辑）+ 组不标（防 enclosing volatile 抛错）+ 别名不标', () => {
  expect(LEAF_PATHS).toHaveLength(41)
  const c = Config.parse({})
  for (const p of LEAF_PATHS)
    expect(typeof at(c, p)?.get, p.join('.')).toBe('function')
  for (const p of GROUP_PATHS)
    expect(typeof at(c, p)?.get, p.join('.')).toBe('undefined')
  // hudPreset 兼容别名：纯值（GUI 不展示），默认 focused
  expect(typeof c.hudPreset?.get).toBe('undefined')
  expect(c.hudPreset).toBe('focused')
})

test('新增组默认值 = 存量硬编码常量（零行为变化）', () => {
  const c = plainConfig(Config.parse({}))
  expect(c.hud).toEqual({ preset: 'focused', refreshMs: 5000 })
  expect(c.routing).toMatchObject({ lowMax: 2, mediumMax: 5 })
  expect(c.delegate).toEqual({ provider: 'spawn' })
  expect(c.team).toMatchObject({ maxFixLoops: 3, casRetries: 3 })
  expect(c.mcp).toEqual({
    transport: 'stdio', serverName: 'omd-state', failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 5 },
  })
  expect(c.codeIntel.lsp).toEqual({
    initializeTimeoutMs: 10000, requestTimeoutMs: 15000, shutdownTimeoutMs: 5000, maxRestarts: 2, diagnosticsWaitMs: 1500,
  })
  expect(c.codeIntel.search).toEqual({
    defaultMaxResults: 50, hardMaxResults: 500, maxFiles: 2000,
    skipDirs: ['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'],
  })
  expect(c.memory).toEqual({ workingTtlDays: 7 })
})

test('P0 缺口补齐：ambiguityThreshold 校验（范围 0–1 + 步长 0.05）', () => {
  expect(configValue(Config.parse({ deepInterview: { ambiguityThreshold: 0 } }).deepInterview.ambiguityThreshold)).toBe(0)
  expect(configValue(Config.parse({ deepInterview: { ambiguityThreshold: 1 } }).deepInterview.ambiguityThreshold)).toBe(1)
  expect(() => Config.parse({ deepInterview: { ambiguityThreshold: 1.5 } })).toThrow()
  expect(() => Config.parse({ deepInterview: { ambiguityThreshold: -0.1 } })).toThrow()
  expect(() => Config.parse({ deepInterview: { ambiguityThreshold: 0.33 } })).toThrow(/multiple of/)
})

test('P0 缺口补齐：lspServers 条目 initializeTimeoutMs（默认 10000；自带值保留）', () => {
  const c = plainConfig(Config.parse({ codeIntel: { lspServers: {
    a: { command: 'x', languages: ['javascript'] },
    b: { command: 'y', initializeTimeoutMs: 800 },
  } } }))
  expect(c.codeIntel.lspServers.a.initializeTimeoutMs).toBe(10000)
  expect(c.codeIntel.lspServers.a.args).toEqual([])
  expect(c.codeIntel.lspServers.a.env).toEqual({})
  expect(c.codeIntel.lspServers.b.initializeTimeoutMs).toBe(800)
})

test('P0 缺口补齐：hudPreset 兼容别名解析（纯值；hud.preset 独立存在）', () => {
  expect(Config.parse({ hudPreset: 'full' }).hudPreset).toBe('full')
  expect(() => Config.parse({ hudPreset: 'no-such' })).toThrow()
  const c = plainConfig(Config.parse({ hud: { preset: 'minimal' } }))
  expect(c.hud.preset).toBe('minimal')
  expect(c.hudPreset).toBe('focused') // 别名默认不受 hud.preset 影响（hud-route 读 hud.preset ?? hudPreset）
})

test('新增键校验边界', () => {
  expect(() => Config.parse({ hud: { refreshMs: 999 } })).toThrow()
  expect(() => Config.parse({ hud: { preset: 'no-such' } })).toThrow()
  expect(() => Config.parse({ delegate: { provider: 'grpc' } })).toThrow()
  expect(() => Config.parse({ mcp: { transport: 'sse' } })).toThrow()
  expect(() => Config.parse({ memory: { workingTtlDays: 0 } })).toThrow()
  expect(() => Config.parse({ routing: { lowMax: 9 } })).toThrow() // max(8)=总分上限
  expect(() => Config.parse({ codeIntel: { lsp: { maxRestarts: -1 } } })).toThrow()
  expect(() => Config.parse({ autopilot: { maxIterations: 1.5 } })).toThrow() // natural 步长 1
})

test('plainConfig 深解包：JSON 稳定 + 无 Volatile 残留', () => {
  const plain = plainConfig(Config.parse({ codeIntel: { lspServers: { a: { command: 'x' } } } }))
  expect(() => JSON.stringify(plain)).not.toThrow()
  const stack = [plain]
  while (stack.length) {
    const v = stack.pop()
    expect(typeof v?.get).toBe('undefined')
    if (v !== null && typeof v === 'object') stack.push(...Object.values(v))
  }
})

test('configValue：纯值原样直通（手写纯对象 config 不受影响）', () => {
  expect(configValue('zh')).toBe('zh')
  expect(configValue(0)).toBe(0)
  expect(configValue(false)).toBe(false)
  const o = { a: 1 }
  expect(configValue(o)).toBe(o)
  expect(configValue(undefined)).toBeUndefined()
  expect(configValue(null)).toBeNull()
})
