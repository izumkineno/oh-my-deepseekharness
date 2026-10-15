// tests/lib/client-bundle.test.js
// v0.4 P2-D HUD client half（lib/client.js 手工懒加载 CJS bundle）沙箱断言：
// ① bundle 在 fake __ModuleLoader__ 下注册工厂（id=包名）且执行无副作用（只注册）
// ② 物化导出 { apply, inject, HudPanel, HUD_ROUTE, ConfigPage, CONFIG_ROW_KEY, FIELDS, resolveRefreshMs }；
//    inject=['slots','sidebarRightTabs']
// ③ apply(mock ctx)：注册 tab 类型（id/kind/title/guide）+ tab 体（seat/key 对齐定义 id）
//    + 行配置页（plugins.row.config，key=包名#行 id → ConfigPage）
// ④ 服务缺席 → console.warn 告警直通不抛错
// ⑤ 加载中分支冒烟（NB-a：本轮 HudPanel 重写不触及该分支，断言保留）
// ⑥-⑭ ralplan-hud-clarity 呈现层重写：AC7 idle 下发目录/active 中文卡/stale 锁子串/
//    detail 缺席回退/无内置目录；AC10 tier 三档 data-tier 标记；AC11 preset 三档矩阵
//    （minimal-idle / focused-active / full-active / 回退，fakeReact useState 种子注入）
// ⑮-⑳ browser half（dsh-gui-config t4 缺口回填）：F3 resolveRefreshMs 单测；FIELDS 41 叶表
//    自检；ConfigPage summary 回退/page 壳 + 41 控件 + 9 分组 + overridden 徽标；暂存语义
//    （edit→set/clear→unset/revision fence）；非法草稿阻塞保存
// ㉑-㉒ 包配置页（plugins.bundle.config 少点一层）：configForms.get(行 id) 自取表单 +
//    包名 key 注册 + 41 控件全渲染；apply 缺席/控制器缺席回退 unavailable
import { test, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../../lib/client.js')

/** 在沙箱中加载 bundle：返回 { loaderCalls, materialize }。 */
async function loadBundle() {
  const code = await readFile(BUNDLE, 'utf8')
  const loaderCalls = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (row) => loaderCalls.push(row) } },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { loaderCalls, sandbox }
}

/** 第一方控件桩：与 bundle 内 require('@deepseek-ai/dsh-client-ui-primitives') 解包同名。
 *  桩为具名空函数——fake createElement 原样保留 type 引用，findNodes 可按引用定位。 */
function SettingsFormStub() {}
function SettingsValueFieldStub() {}
function SwitchStub() {}
const primitivesStub = {
  SettingsForm: SettingsFormStub,
  SettingsValueField: SettingsValueFieldStub,
  Switch: SwitchStub,
}

/** 物化工厂：fake require 认 react + ui-primitives（平台基线裸包名 require）。 */
function materialize(row, reactStub) {
  const require = (name) => {
    if (name === 'react') return reactStub
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`unexpected require: ${name}`)
  }
  return row.factory(require)
}

/** fake React：useState 按调用序注入种子（seeds[i] 覆盖第 i 个 useState 的 init）。 */
function fakeReact(seeds = []) {
  const effects = []
  const states = []
  return {
    effects, states,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => {
      const i = states.length
      const v = i < seeds.length ? seeds[i] : init
      const s = [v, () => {}]
      states.push(s)
      return s
    },
    useEffect: (fn) => effects.push(fn),
    useRef: (init) => ({ current: init }),
  }
}

/** 深度收集树中满足条件的节点（fake React 元素 {type, props, children}；children 可为嵌套数组）。 */
function findNodes(node, pred, out = []) {
  if (Array.isArray(node)) {
    for (const c of node) findNodes(c, pred, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  findNodes(node.children ?? [], pred, out)
  return out
}

// ---- fixtures：hud.json payload 形状按计划 AC4/AC5/AC11 契约 ----

const CATALOG = [
  { mode: 'autopilot', label: '自动驾驶' },
  { mode: 'ralph', label: 'Ralph 循环' },
  { mode: 'team', label: '团队' },
  { mode: 'ralplan', label: '共识规划' },
  { mode: 'deep-interview', label: '深度访谈' },
]

const CARD_TEXT = [
  '[omd] 编排状态',
  '模式: Ralph 循环（ralph）',
  '阶段: exec',
  '轮次: 3',
  '任务: 2 个 agent',
  '记忆: 工作区 1 / 优先区 2 / 手动区 0',
  '另有 1 个模式：autopilot（自动驾驶）',
].join('\n')

function modeEntry(over = {}) {
  return {
    mode: 'ralph', label: 'Ralph 循环', sessionId: 'sess-1', state: 'active',
    iteration: 3, current_story: 'S1 实现', current_phase: 'exec',
    active_agents: [{ id: 'w-1' }, { id: 'w-2' }],
    updatedAt: '2026-02-06T10:00:00.000Z', stale: false,
    ...over,
  }
}

function snapPayload(over = {}) {
  return {
    ok: true, cwd: 'D:/omd', at: '2026-02-06T10:00:05.000Z',
    summary: { mode: 'ralph', round: 3, story: 'S1 实现', agents: 2, todo: { working: 1, priority: 2, manual: 0 } },
    card: CARD_TEXT,
    preset: 'focused',
    detail: { primary: 'ralph', modes: [modeEntry()] },
    modeCatalog: CATALOG,
    ...over, // 显式传 detail: undefined / preset: undefined 即「缺席」
  }
}

/** 种子注入渲染：snap 为第 1 个 useState、err 为第 2 个。
 *  HudPanel 闭包绑定 materialize 时的 react——故必须在此用种子 react 物化工厂。 */
function seedPanel(loaderCalls, snap, err = null) {
  const react = fakeReact([snap, err])
  const exports = materialize(loaderCalls[0], react)
  const tree = exports.HudPanel()
  return { react, tree, flat: JSON.stringify(tree) }
}

test('① bundle 注册工厂：id=包名，加载零副作用', async () => {
  const { loaderCalls } = await loadBundle()
  expect(loaderCalls).toHaveLength(1)
  expect(loaderCalls[0].id).toBe('@sakura12/oh-my-deepseekharness')
  expect(typeof loaderCalls[0].factory).toBe('function')
})

test('② 物化导出契约：apply/inject/HudPanel/HUD_ROUTE/ConfigPage/BundleConfigPage/CONFIG_ROW_KEY/CONFIG_BUNDLE_KEY/CONFIG_NS/FIELDS/resolveRefreshMs', async () => {
  const { loaderCalls } = await loadBundle()
  const react = fakeReact()
  const exports = materialize(loaderCalls[0], react)
  expect(typeof exports.apply).toBe('function')
  expect(exports.inject).toEqual(['slots', 'sidebarRightTabs']) // configForms 可选接入，不进 inject
  expect(typeof exports.HudPanel).toBe('function')
  expect(exports.HUD_ROUTE).toBe('/oh-my-dsh/hud.json')
  expect(typeof exports.ConfigPage).toBe('function')
  expect(typeof exports.BundleConfigPage).toBe('function')
  expect(exports.CONFIG_ROW_KEY).toBe('@sakura12/oh-my-deepseekharness#oh-my-dsh')
  expect(exports.CONFIG_BUNDLE_KEY).toBe('@sakura12/oh-my-deepseekharness')
  expect(exports.CONFIG_NS).toBe('oh-my-dsh') // settings 命名空间 = loader 行 id
  expect(Array.isArray(exports.FIELDS)).toBe(true)
  expect(typeof exports.resolveRefreshMs).toBe('function') // F3：HUD 轮询周期解析导出供测
  expect(Object.keys(exports).sort()).toEqual([
    'BundleConfigPage', 'CONFIG_BUNDLE_KEY', 'CONFIG_NS', 'CONFIG_ROW_KEY', 'ConfigPage', 'FIELDS', 'HUD_ROUTE', 'HudPanel', 'apply', 'inject', 'resolveRefreshMs',
  ])
})

test('③ apply：tab 类型 + tab 体注册（seat/key 对齐，guide 胶囊齐全）', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const tabDefs = []
  const slotInjects = []
  const slotRegs = []
  const ctx = {
    sidebarRightTabs: { register: (def) => tabDefs.push(def) },
    slots: {
      inject: (seat, fn) => { slotInjects.push(seat); return fn() },
      register: (meta, component) => { slotRegs.push({ meta, component }); return () => {} },
    },
  }
  const warns = []
  const origWarn = console.warn
  console.warn = (m) => warns.push(String(m))
  try {
    exports.apply(ctx)
  } finally { console.warn = origWarn }
  expect(tabDefs).toHaveLength(1)
  const def = tabDefs[0]
  expect(def.id).toBe('omd-hud-panel')
  expect(def.kind).toBe('omd-hud')
  expect(def.patterns).toBeUndefined() // page 类型：无地址 glob
  expect(def.title()).toBe('omd HUD')
  expect(def.guide).toHaveLength(1)
  expect(def.guide[0].title()).toBe('omd HUD')
  expect(def.guide[0].description()).toContain('五要素')
  expect(slotInjects).toEqual(['sidebar.right.pane.tab', 'plugins.row.config'])
  expect(slotRegs).toHaveLength(2)
  expect(slotRegs[0].meta).toMatchObject({ name: 'sidebar.right.pane.tab', key: 'omd-hud-panel' }) // keyed 座按 key 派发（第一方契约）
  expect(slotRegs[0].component).toBe(exports.HudPanel) // 体座 key=定义 id，组件同导出
  // 行配置页：keyed root 座按 key=包名#行 id 派发（第一方契约），owner 传 {view, form}
  expect(slotRegs[1].meta).toMatchObject({ name: 'plugins.row.config', key: '@sakura12/oh-my-deepseekharness#oh-my-dsh' })
  expect(slotRegs[1].component).toBe(exports.ConfigPage)
  // 包配置页：configForms 缺席 → 跳过注册（告警一行），HUD/行页不受影响
  expect(warns).toHaveLength(1)
  expect(warns[0]).toContain('configForms')
})

test('④ 服务缺席告警直通（不抛错、不注册）', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const warns = []
  const orig = console.warn
  console.warn = (m) => warns.push(m)
  try {
    expect(() => exports.apply({})).not.toThrow()
    expect(() => exports.apply(null)).not.toThrow()
  } finally { console.warn = orig }
  expect(warns.length).toBe(2)
  expect(warns[0]).toContain('sidebarRightTabs/slots')
})

test('⑤ HudPanel 初始渲染：加载中分支（effect 注册轮询）', async () => {
  const { loaderCalls } = await loadBundle()
  const react = fakeReact()
  const exports = materialize(loaderCalls[0], react)
  const tree = exports.HudPanel()
  expect(tree.type).toBe('div')
  const flat = JSON.stringify(tree)
  expect(flat).toContain('omd 编排状态') // B3′：面板标题随 HudPanel 重写同步
  expect(flat).toContain('加载中') // NB-a：加载中分支断言原样保留
  expect(react.effects).toHaveLength(1) // NB-a：轮询 effect 已注册（fetch/setTimeout 链在 effect 内，沙箱不执行）
})

test('⑥ AC7 idle：渲染下发 modeCatalog（模式名+中文名同现）+ 空态引导 + 记忆中文标签', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    summary: { mode: 'idle', round: null, story: null, agents: 0, todo: { working: 0, priority: 0, manual: 0 } },
    detail: { primary: null, modes: [] },
  })
  const { flat } = seedPanel(loaderCalls, s)
  expect(flat).toContain('当前没有运行中的 omd 模式')
  // 目录来自下发 modeCatalog：模式名与中文名同现
  expect(flat).toContain('autopilot')
  expect(flat).toContain('自动驾驶')
  expect(flat).toContain('deep-interview')
  expect(flat).toContain('深度访谈')
  // 记忆中文标签，非裸 working=
  expect(flat).toContain('记忆')
  expect(flat).not.toContain('working=')
})

test('⑦ AC7 focused active：主模式卡（模式/阶段/轮次/任务）+ stale 锁子串 + 次要小注；AC10 warn 档', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    detail: {
      primary: 'ralph',
      modes: [
        modeEntry({ stale: true }),
        modeEntry({ mode: 'autopilot', label: '自动驾驶', sessionId: 'sess-2', current_story: 'S2' }),
      ],
    },
  })
  const { tree, flat } = seedPanel(loaderCalls, s)
  expect(tree.props['data-tier']).toBe('warn') // AC10：data-tier 标记落 DOM
  expect(flat).toContain('阶段')
  expect(flat).toContain('轮次')
  expect(flat).toContain('任务')
  expect(flat).toContain('未更新') // A1 受锁子串（stale 行漂移兜底）
  expect(flat).toContain('另有 1 个模式') // focused：次要模式小注
  expect(flat).toContain('记忆')
  expect(flat).toContain('最近取数') // U3/O1：focused 档取数时间上下文
  expect(flat).not.toContain('刷新间隔') // S5：删刷新间隔行
  expect(flat).not.toContain('working=')
})

test('⑧ AC10 danger：活跃模式 state=failed → data-tier=危险档 + 文字标记', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({ detail: { primary: 'ralph', modes: [modeEntry({ state: 'failed' })] } })
  const { tree, flat } = seedPanel(loaderCalls, s)
  expect(tree.props['data-tier']).toBe('danger')
  expect(flat).toContain('危险')
})

test('⑨ AC10 ok：活跃且非 stale → ok 档（无色降级=默认文本色）', async () => {
  const { loaderCalls } = await loadBundle()
  const { tree, flat } = seedPanel(loaderCalls, snapPayload({}))
  expect(tree.props['data-tier']).toBe('ok')
  expect(flat).toContain('状态正常')
})

test('⑨b AC10 tier：payload 的 detail.tier 优先（lib 单源下发），非法值回退受锁副本判定', async () => {
  const { loaderCalls } = await loadBundle()
  const given = seedPanel(loaderCalls, snapPayload({ detail: { primary: 'ralph', modes: [modeEntry()], tier: 'warn' } }))
  expect(given.tree.props['data-tier']).toBe('warn')
  const bogus = seedPanel(loaderCalls, snapPayload({ detail: { primary: 'ralph', modes: [modeEntry()], tier: 'bogus' } }))
  expect(bogus.tree.props['data-tier']).toBe('ok')
})

test('⑩ AC11 minimal-idle：<pre> 卡文本档，不渲染语义面板与目录', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    preset: 'minimal',
    summary: { mode: 'idle', round: null, story: null, agents: 0, todo: { working: 0, priority: 0, manual: 0 } },
    detail: { primary: null, modes: [] },
  })
  const { tree, flat } = seedPanel(loaderCalls, s)
  const pres = findNodes(tree, (n) => n.type === 'pre')
  expect(pres).toHaveLength(1)
  expect(flat).toContain('任务: 2 个 agent') // fixture 卡正文进 <pre>
  expect(flat).not.toContain('启动方式') // 空态目录引导不渲染（minimal 只出卡）
  expect(tree.props['data-tier']).toBe('ok')
})

test('⑪ AC11 full active：次要模式全部展开 + 记忆三区逐条 + cwd/最近取数元信息区', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    preset: 'full',
    detail: {
      primary: 'ralph',
      modes: [
        modeEntry(),
        modeEntry({ mode: 'autopilot', label: '自动驾驶', sessionId: 'sess-2', current_story: 'S2', iteration: 1 }),
      ],
    },
  })
  const { tree, flat } = seedPanel(loaderCalls, s)
  expect(flat).toContain('其他模式')
  expect(flat).not.toContain('另有 ') // full：次要模式展开，不折叠小注
  expect(flat).toContain('自动驾驶（autopilot）')
  expect(flat).toContain('记忆（notepad 三区）')
  expect(flat).toContain('永久保留')
  expect(flat).toContain('手动维护')
  expect(flat).toContain('7 天过期')
  expect(flat).toContain('cwd')
  expect(flat).toContain('D:/omd')
  expect(flat).toContain('最近取数')
  expect(tree.props['data-tier']).toBe('ok')
})

test('⑫ AC7/AC11 detail 缺席回退：<pre> 卡文本（回退分支冒烟）', async () => {
  const { loaderCalls } = await loadBundle()
  const { tree, flat } = seedPanel(loaderCalls, snapPayload({ detail: undefined }))
  const pres = findNodes(tree, (n) => n.type === 'pre')
  expect(pres).toHaveLength(1)
  expect(flat).toContain('任务: 2 个 agent')
  expect(flat).not.toContain('主模式')
})

test('⑬ AC11 preset 缺省/非法 → focused 语义化面板（client 只渲染下发 preset）', async () => {
  const { loaderCalls } = await loadBundle()
  for (const preset of [undefined, 'bogus']) {
    const { flat } = seedPanel(loaderCalls, snapPayload({ preset }))
    expect(flat).toContain('主模式')
    expect(flat).not.toContain('记忆（notepad 三区）') // full 专属区不出现
  }
})

test('⑭ AC7：HUD 节无内置模式目录文案残留（目录单源下发自 lib，client 只渲染）', async () => {
  const code = await readFile(BUNDLE, 'utf8')
  // 配置节 FIELDS 组名/标签含模式中文名（「团队协作 / Team」「深度访谈 / Deep interview」）——属配置文案非模式目录，豁免
  const hudPart = code.slice(0, code.indexOf('CONFIG_ROW_KEY'))
  expect(hudPart.length).toBeGreaterThan(1000) // 防护：切分锚点必须命中
  expect(hudPart).not.toMatch(/自动驾驶|Ralph 循环|团队|共识规划|深度访谈/)
  expect(code).not.toContain('MODE_LABELS')
})

// ---- fixtures：行配置页（plugins.row.config owner 契约 {view, form}） ----

function configValueFixture() {
  return {
    language: 'zh', stateDir: '.omd', roleOverrides: {},
    tiers: { low: 'glm-5.3-flash', medium: 'glm-5.3-flash', high: 'glm-5.3-flash' },
    routing: { defaultTier: 'medium', lowMax: 2, mediumMax: 5 },
    delegate: { provider: 'spawn' },
    autopilot: { maxIterations: 10, maxQaCycles: 5, maxValidationRounds: 3 },
    deepInterview: { ambiguityThreshold: 0.2, maxRounds: 20, softWarningRounds: 10 },
    team: { heartbeatIntervalMs: 60000, staleAfterMs: 300000, maxFixLoops: 3, casRetries: 3 },
    hud: { preset: 'focused', refreshMs: 5000 },
    mcp: {
      transport: 'stdio', serverName: 'omd-state', failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 5 },
    },
    codeIntel: {
      astGrep: true, lspServers: {},
      lsp: { initializeTimeoutMs: 10000, requestTimeoutMs: 15000, shutdownTimeoutMs: 5000, maxRestarts: 2, diagnosticsWaitMs: 1500 },
      search: { defaultMaxResults: 50, hardMaxResults: 500, maxFiles: 2000, skipDirs: ['.git', 'node_modules'] },
    },
    memory: { workingTtlDays: 7 },
  }
}

/** owner form 桩：calls 记录 mutate(ops, rev)；ok=false 模拟宿主拒绝（revision 冲突等）。 */
function configForm(over = {}) {
  const calls = []
  const ok = over.ok ?? true
  return {
    calls,
    state: {
      status: 'ready',
      value: configValueFixture(),
      user: { language: 'zh' }, // 仅 language 有 user 层 → overridden 徽标只落 field 0
      base: {},
      revision: 7,
      writable: true,
      ...(over.state ?? {}),
    },
    mutate: (ops, rev) => {
      calls.push({ ops, rev })
      return { then: (onOk) => onOk(ok) } // 同步 thenable（沙箱不断言异步调度）
    },
  }
}

/** 种子注入渲染配置页：seeds[0]=staged 草稿表（useConfigForm 第 1 个 useState）。 */
function seedConfig(loaderCalls, form, view = 'page', seeds = []) {
  const react = fakeReact(seeds)
  const exports = materialize(loaderCalls[0], react)
  const tree = exports.ConfigPage({ view, form })
  return { react, exports, tree, flat: typeof tree === 'string' ? tree : JSON.stringify(tree) }
}

test('⑮ F3 resolveRefreshMs：缺席/非法→5000，下限 1000，上限 1h', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const r = exports.resolveRefreshMs
  expect(r(null)).toBe(5000)
  expect(r(undefined)).toBe(5000)
  expect(r({})).toBe(5000)
  expect(r({ refreshMs: 'bogus' })).toBe(5000)
  expect(r({ refreshMs: NaN })).toBe(5000)
  expect(r({ refreshMs: Infinity })).toBe(5000)
  expect(r({ refreshMs: 999 })).toBe(5000) // <1000 视为抖动保护下限
  expect(r({ refreshMs: 1000 })).toBe(1000)
  expect(r({ refreshMs: 10000 })).toBe(10000)
  expect(r({ refreshMs: 99999999 })).toBe(3600000) // 上限 1h 防写死面板
})

test('⑯ FIELDS：41 叶 × 9 组，路径唯一、kind/choices/min-max 合法', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const F = exports.FIELDS
  expect(F).toHaveLength(41)
  const kinds = new Set(['text', 'int', 'float', 'enum', 'bool', 'json'])
  const seen = new Set()
  for (const f of F) {
    expect(kinds.has(f.kind)).toBe(true)
    expect(typeof f.label).toBe('string')
    expect(typeof f.hint).toBe('string')
    expect(Array.isArray(f.p) && f.p.length > 0).toBe(true)
    const k = f.p.join('.')
    expect(seen.has(k)).toBe(false) // 路径唯一（与 lib/config.js 叶 1:1）
    seen.add(k)
    if (f.kind === 'enum') expect(f.choices.length).toBeGreaterThan(1)
    if (typeof f.min === 'number' && typeof f.max === 'number') expect(f.min).toBeLessThanOrEqual(f.max)
  }
  expect([...new Set(F.map((f) => f.g))]).toHaveLength(9) // 组顺序=渲染顺序
  expect(seen.has('codeIntel.search.skipDirs')).toBe(true) // F1 新叶在表内
  expect(seen.has('codeIntel.lsp.shutdownTimeoutMs')).toBe(true) // F2 新叶在表内
})

test('⑰ ConfigPage summary 一行文案；page 无 form 时 unavailable 回退', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const summary = exports.ConfigPage({ view: 'summary' })
  expect(typeof summary).toBe('string')
  expect(summary).toContain('41')
  const tree = exports.ConfigPage({ view: 'page' }) // form 缺席（owner 尚未服务该行）
  expect(JSON.stringify(tree)).toContain('配置未就绪')
})

test('⑱ ConfigPage page：SettingsForm 壳 + 41 控件 + 9 分组 + overridden 徽标', async () => {
  const { loaderCalls } = await loadBundle()
  const { tree, flat } = seedConfig(loaderCalls, configForm())
  // 壳：SettingsForm 桩组件 + shell 快照（干净态）
  const shells = findNodes(tree, (n) => n.type === primitivesStub.SettingsForm)
  expect(shells).toHaveLength(1)
  expect(shells[0].props.state).toMatchObject({ available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false })
  expect(typeof shells[0].props.onSave).toBe('function')
  expect(typeof shells[0].props.onDiscard).toBe('function')
  expect(shells[0].props.labels.save).toContain('保存')
  // 41 控件：34 value + 4 select + 3 switch；9 分组
  expect(findNodes(tree, (n) => n.type === primitivesStub.SettingsValueField)).toHaveLength(34)
  expect(findNodes(tree, (n) => n.type === 'select')).toHaveLength(4)
  expect(findNodes(tree, (n) => n.type === primitivesStub.Switch)).toHaveLength(3)
  expect(findNodes(tree, (n) => n.type === 'section')).toHaveLength(9)
  // 值渲染抽查
  const lang = findNodes(tree, (n) => n.type === 'select' && n.props.id === 'omd-cfg-0')
  expect(lang).toHaveLength(1)
  expect(lang[0].props.value).toBe('zh')
  const refresh = findNodes(tree, (n) => n.type === primitivesStub.SettingsValueField && n.props.id === 'omd-cfg-21')
  expect(refresh[0].props.text).toBe('5000')
  expect(refresh[0].props.numeric).toBe(true)
  expect(refresh[0].props.overridden).toBe(false) // fixture user 层无此路径
  const skipDirs = findNodes(tree, (n) => n.type === primitivesStub.SettingsValueField && n.props.id === 'omd-cfg-39')
  expect(skipDirs[0].props.text).toContain('.git') // json 格式化
  const transport = findNodes(tree, (n) => n.type === primitivesStub.SettingsValueField && n.props.id === 'omd-cfg-22')
  expect(transport[0].props.disabled).toBe(true) // transport 只读展示
  expect(transport[0].props.text).toBe('stdio')
  const sw = findNodes(tree, (n) => n.type === primitivesStub.Switch)
  const byLabel = Object.fromEntries(sw.map((n) => [n.props.label, n.props.checked]))
  expect(byLabel['断线重连 / Reconnect']).toBe(true)
  expect(byLabel['ast_grep 开关 / ast_grep switch']).toBe(true)
  expect(byLabel['启动失败阻断插件 / Block on startup failure']).toBe(false)
  // overridden 徽标：仅 user.language presence 的 field 0 落徽标（span 子串匹配，避开 props 复述）
  const badges = findNodes(tree, (n) => n.type === 'span'
    && Array.isArray(n.children) && n.children.some((c) => typeof c === 'string' && c.includes('已覆盖')))
  expect(badges).toHaveLength(1)
  expect(flat).toContain('资产语言')
})

test('⑲ 暂存语义：edit→set op；空草稿/clear→unset op；seed revision 做 fence', async () => {
  const { loaderCalls } = await loadBundle()
  // edit 草稿：language=en（合法）+ refreshMs 清空（→unset）
  const form = configForm()
  const { tree } = seedConfig(loaderCalls, form, 'page', [{ 0: { type: 'edit', text: 'en' }, 21: { type: 'edit', text: '' } }])
  const shell = findNodes(tree, (n) => n.type === primitivesStub.SettingsForm)[0]
  expect(shell.props.state).toMatchObject({ dirty: true, invalid: false })
  shell.props.onSave()
  expect(form.calls).toHaveLength(1)
  expect(form.calls[0].rev).toBe(7) // seed revision 做 fence
  expect(form.calls[0].ops).toEqual([
    { op: 'set', path: ['language'], value: 'en' },
    { op: 'unset', path: ['hud', 'refreshMs'] }, // 空草稿=unset（重置语义）
  ])
  // reset 暂存：clear→unset op
  const form2 = configForm()
  const t2 = seedConfig(loaderCalls, form2, 'page', [{ 6: { type: 'clear' } }])
  const shell2 = findNodes(t2.tree, (n) => n.type === primitivesStub.SettingsForm)[0]
  expect(shell2.props.state.dirty).toBe(true)
  shell2.props.onSave()
  expect(form2.calls[0].ops).toEqual([{ op: 'unset', path: ['routing', 'defaultTier'] }])
})

test('⑳ 非法草稿阻塞保存：enum/int/float/json 越界均不触 mutate', async () => {
  const { loaderCalls } = await loadBundle()
  const cases = [
    { 0: { type: 'edit', text: 'fr' } }, // language ∉ zh/en/both
    { 21: { type: 'edit', text: '500' } }, // refreshMs < 1000
    { 21: { type: 'edit', text: '12x' } }, // int 非数字
    { 13: { type: 'edit', text: '1.5' } }, // ambiguityThreshold > 1
    { 2: { type: 'edit', text: '{oops' } }, // roleOverrides json 坏串
  ]
  for (const staged of cases) {
    const form = configForm()
    const { tree } = seedConfig(loaderCalls, form, 'page', [staged])
    const shell = findNodes(tree, (n) => n.type === primitivesStub.SettingsForm)[0]
    expect(shell.props.state.invalid).toBe(true)
    shell.props.onSave()
    expect(form.calls).toHaveLength(0)
  }
})

/** configForms 桩：get(id) 记录 id，返回包在 owner form 桩上的控制器（第一方控制器契约）。 */
function configFormsStub(form, seen) {
  return {
    get: (id) => {
      seen.push(id)
      return {
        getSnapshot: () => form.state,
        subscribe: () => () => {},
        mutate: (ops, rev) => form.mutate(ops, rev),
      }
    },
  }
}

function ctxWithConfigForms(form, seen, slotInjects, slotRegs) {
  return {
    sidebarRightTabs: { register: () => {} },
    slots: {
      inject: (seat, fn) => { slotInjects.push(seat); return fn() },
      register: (meta, component) => { slotRegs.push({ meta, component }); return () => {} },
    },
    configForms: configFormsStub(form, seen),
  }
}

test('㉑ 包配置页：configForms.get(行 id) 自取 + 包名 key 注册 + 41 控件全渲染 + 保存直通', async () => {
  const { loaderCalls } = await loadBundle()
  const form = configForm()
  const react = fakeReact()
  const exports = materialize(loaderCalls[0], react)
  const seen = []
  const slotInjects = []
  const slotRegs = []
  const warns = []
  const orig = console.warn
  console.warn = (m) => warns.push(String(m))
  try {
    exports.apply(ctxWithConfigForms(form, seen, slotInjects, slotRegs))
  } finally { console.warn = orig }
  expect(warns).toHaveLength(0) // configForms 在位：无告警
  expect(seen).toEqual(['oh-my-dsh']) // 表单 id = loader 行 id（宿主 formFor(rowId) 同源）
  expect(slotInjects).toEqual(['sidebar.right.pane.tab', 'plugins.row.config', 'plugins.bundle.config'])
  expect(slotRegs).toHaveLength(3)
  expect(slotRegs[2].meta).toMatchObject({ name: 'plugins.bundle.config', key: '@sakura12/oh-my-deepseekharness' })
  expect(slotRegs[2].component).toBe(exports.BundleConfigPage)
  // owner 只传 {view}：组件自取表单后复用 ConfigPage（fake React 不渲染元素，手动展开一层）
  const elem = exports.BundleConfigPage({ view: 'page' })
  expect(elem.type).toBe(exports.ConfigPage)
  expect(elem.props.view).toBe('page')
  expect(elem.props.form.state).toBe(form.state)
  expect(typeof elem.props.form.mutate).toBe('function')
  const tree = elem.type(elem.props)
  const shells = findNodes(tree, (n) => n.type === primitivesStub.SettingsForm)
  expect(shells).toHaveLength(1)
  expect(shells[0].props.state).toMatchObject({ available: true, writable: true, dirty: false })
  expect(findNodes(tree, (n) => n.type === primitivesStub.SettingsValueField)).toHaveLength(34)
  expect(findNodes(tree, (n) => n.type === 'select')).toHaveLength(4)
  expect(findNodes(tree, (n) => n.type === primitivesStub.Switch)).toHaveLength(3)
  expect(findNodes(tree, (n) => n.type === 'section')).toHaveLength(9)
  // 保存直通：edit 草稿经控制器 mutate 落宿主，seed revision 做 fence
  const react2 = fakeReact([form.state, { 0: { type: 'edit', text: 'en' } }, false, false])
  const exports2 = materialize(loaderCalls[0], react2)
  exports2.apply(ctxWithConfigForms(form, { push: () => {} }, [], []))
  const elem2 = exports2.BundleConfigPage({ view: 'page' })
  const tree2 = elem2.type(elem2.props)
  const shell2 = findNodes(tree2, (n) => n.type === primitivesStub.SettingsForm)[0]
  expect(shell2.props.state).toMatchObject({ dirty: true, invalid: false })
  shell2.props.onSave()
  expect(form.calls).toHaveLength(1)
  expect(form.calls[0].rev).toBe(7)
  expect(form.calls[0].ops).toEqual([{ op: 'set', path: ['language'], value: 'en' }])
})

test('㉒ 包配置页：控制器缺席（apply 未执行）回退 unavailable，不抛错', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact()) // 不 apply：bundleFormCtl 恒 null
  const tree = exports.BundleConfigPage({ view: 'page' })
  expect(JSON.stringify(tree)).toContain('配置未就绪')
})
