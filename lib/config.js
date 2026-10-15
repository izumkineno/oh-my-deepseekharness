// lib/config.js
// oh-my-dsh 插件 Config（schemastery 校验；dsh Web GUI 配置列表的唯一来源）。
//
// GUI 暴露规则（@deepseek-ai/dsh-settings）：只有标 `.volatile()` 的字段才进 Web GUI
// 表单；嵌套 object = 分组（`.collapse()` 折叠渲染）；union(const) 枚举 = 下拉。
// volatile 约束（schemastery validateVolatileSchema，源码实证）：
// - 只许固定对象路径上的字段标 volatile，禁止 enclosing volatile（组和叶二选一标）；
// - dict 值/array 元素/union 成员内禁止标（blocked）——lspServers 整体标、条目内键不标。
// 因此：41 个 GUI 叶标 volatile，组只标 collapse；hudPreset 兼容别名故意不标
// （仅文件配置可写，GUI 不展示）+ `.hidden()`（schema 驱动渲染器隐藏该节点）。
//
// 运行时语义：volatile 叶经 Config.parse 后是 cosmokit Volatile 引用（读 `.get()`，
// 第一方插件 dsh-bash-local 同款 `config.timeoutMs.get()`）。omd 读面统一经本文件
// `configValue()` 解包（兼容手写纯对象 config——测试/旧调用方直传不受影响）；
// 需序列化处（MCP env JSON）用 `plainConfig()` 深解包——Volatile 直接 JSON.stringify
// 会塌成 `{}`，绝不直接串行化。
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  language: z.union([z.const('zh'), z.const('en'), z.const('both')]).default('zh')
    .description('资产语言：zh 中文 / en 英文 / both 中文正文+英文术语 / Asset language: zh Chinese / en English / both Chinese body + English terms')
    .volatile(),
  tiers: z.object({
    low: z.string().default('glm-5.3-flash')
      .description('low 档模型标识（或 "inherit" 继承主会话）/ Model id for the low tier ("inherit" = inherit main session)')
      .volatile(),
    medium: z.string().default('glm-5.3-flash')
      .description('medium 档模型标识（或 "inherit" 继承主会话）/ Model id for the medium tier')
      .volatile(),
    high: z.string().default('glm-5.3-flash')
      .description('high 档模型标识（或 "inherit" 继承主会话）/ Model id for the high tier')
      .volatile(),
  }).description('档位→模型映射。默认值对齐部署 LLM 服务（S1 差分证据：glm-5.3-flash 可解析、deepseek-* 不可解析）；'
    + '不可用 id 由 omd_delegate 派发前校验显式报错，不静默继承 / Tier→model map. Defaults match the deployed LLM service.')
    .collapse(),
  roleOverrides: z.dict(z.string()).default({})
    .description('角色级覆盖，优先于 tiers，如 { "omd-agent-code-reviewer": "provider/model" } / Per-role overrides, take precedence over tiers')
    .volatile(),
  routing: z.object({
    defaultTier: z.union([z.const('low'), z.const('medium'), z.const('high')]).default('medium')
      .description('c3 会话默认档：表外角色落此档 + fallback 审计 / Default tier for off-table roles (with fallback audit)')
      .volatile(),
    lowMax: z.natural().max(8).default(2)
      .description('c3 分带：特征总分 ≤ 此值 → low。必须 ≤ mediumMax（suggestTier 运行时断言）/ Score ≤ this → low. Must be ≤ mediumMax')
      .volatile(),
    mediumMax: z.natural().max(8).default(5)
      .description('c3 分带：特征总分 ≤ 此值 → medium，其余 → high。必须 ≥ lowMax / Score ≤ this → medium, else high. Must be ≥ lowMax')
      .volatile(),
  }).description('c3 自适应路由：4 特征静态评分（每特征 0–2 分，总分 0–8）→ 建议档 → 角色表上限钳制（只降不升）/ Adaptive routing: feature scores → suggested tier → table-cap clamp')
    .collapse(),
  stateDir: z.string().default('.omd')
    .description('项目状态目录名 / Project state directory name')
    .volatile(),
  autopilot: z.object({
    maxIterations: z.natural().min(1).default(10)
      .description('autopilot 最大轮次（create_goal 的 max_goal_rounds 默认值）/ Max autopilot iterations')
      .volatile(),
    maxQaCycles: z.natural().min(1).default(5)
      .description('QA 循环上限 / Max QA cycles')
      .volatile(),
    maxValidationRounds: z.natural().min(1).default(3)
      .description('re-validation 轮次上限 / Max re-validation rounds')
      .volatile(),
  }).description('autopilot/ralph 循环界限（渲染进协议段，由模型执行）/ Loop bounds, rendered into the protocol for the model')
    .collapse(),
  // 终审修复 #3：deep-interview skill 引用的配置键（源 OMC 读 .claude/settings.json 的
  // omc.deepInterview.*）——模型运行时无法读插件 Config，由 protocol.js 渲染进协议段。
  deepInterview: z.object({
    ambiguityThreshold: z.number().min(0).max(1).step(0.05).default(0.2)
      .description('歧义度阈值：超此值追问而非假设（0–1，步长 0.05）/ Ambiguity threshold: ask above it instead of assuming (0–1, step 0.05)')
      .role('slider').volatile(),
    maxRounds: z.natural().min(1).default(20)
      .description('访谈硬上限轮次 / Hard cap of interview rounds')
      .volatile(),
    softWarningRounds: z.natural().min(1).default(10)
      .description('软提醒轮次（到此轮次提醒收敛）/ Soft-warning round (nudge to converge)')
      .volatile(),
  }).description('deep-interview 访谈参数（渲染进协议段）/ Interview parameters, rendered into the protocol')
    .collapse(),
  team: z.object({
    heartbeatIntervalMs: z.natural().default(60_000)
      .description('插件侧 heartbeat 周期检测间隔 ms（0=关闭定时器，team_heartbeat_scan 按需扫描仍可用）/ Heartbeat scan interval in ms (0 = timer off)')
      .volatile(),
    staleAfterMs: z.natural().min(1).default(300_000)
      .description('队员无心跳 stale 阈值 ms / Stale threshold in ms for workers without heartbeat')
      .volatile(),
    maxFixLoops: z.natural().default(3)
      .description('team-fix→exec 回边上限（新 run 写入 phase.json；存量 run 沿用旧值）/ Max fix→exec loops for new runs')
      .volatile(),
    casRetries: z.natural().default(3)
      .description('run-state CAS 冲突重试预算（耗尽覆盖写 + warning）/ CAS conflict retry budget for run-state writes')
      .volatile(),
  }).description('team 运行时心跳/阶段机参数 / Team runtime heartbeat / phase-machine parameters')
    .collapse(),
  codeIntel: z.object({
    astGrep: z.boolean().default(true)
      .description('ast_grep_* 开关（@ast-grep/napi 缺席时工具显式报错）/ ast_grep_* on/off switch')
      .volatile(),
    lspServers: z.dict(z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      languages: z.array(z.string()).default([]),
      env: z.dict(z.string()).default({}),
      initializeTimeoutMs: z.natural().min(1).default(10_000)
        .description('该 server initialize 握手超时 ms（覆盖 lsp.initializeTimeoutMs 全局值）/ Per-server initialize timeout in ms (overrides the global lsp value)'),
    })).default({})
      .description('LSP 注册表：{ <name>: { command, args?, languages?, env?, initializeTimeoutMs? } }——'
        + '语言服务器本体由用户环境提供，omd 只做进程管理（单实例/崩溃重启≤maxRestarts/随 MCP server 退出回收）/ '
        + 'LSP registry. Server binaries come from the user environment; omd only manages processes.')
      .volatile(),
    lsp: z.object({
      initializeTimeoutMs: z.natural().min(1).default(10_000)
        .description('LSP initialize 握手超时 ms（注册项自带值优先）/ Global LSP initialize timeout in ms')
        .volatile(),
      requestTimeoutMs: z.natural().min(1).default(15_000)
        .description('LSP 请求（documentSymbol/references/definition）超时 ms / LSP request timeout in ms')
        .volatile(),
      shutdownTimeoutMs: z.natural().min(1).default(5_000)
        .description('lsp_stop 等 shutdown 回应超时 ms / Timeout in ms for the shutdown handshake in lsp_stop')
        .volatile(),
      maxRestarts: z.natural().default(2)
        .description('单 server 崩溃重启预算（lsp_stop 显式复位）/ Crash-restart budget per server (reset by explicit lsp_stop)')
        .volatile(),
      diagnosticsWaitMs: z.natural().default(1500)
        .description('lsp_diagnostics 等 publishDiagnostics 默认等待 ms（调用可覆盖）/ Default wait in ms for publishDiagnostics')
        .volatile(),
    }).description('LSP 进程管理全局参数 / Global LSP process-management parameters')
      .collapse(),
    search: z.object({
      defaultMaxResults: z.natural().min(1).default(50)
        .description('ast_grep_search 默认返回上限（调用可覆盖，不超 hardMaxResults）/ Default result cap for ast_grep_search')
        .volatile(),
      hardMaxResults: z.natural().min(1).default(500)
        .description('检索/重写硬上限（任何调用不得超过）/ Hard cap for search/rewrite results')
        .volatile(),
      maxFiles: z.natural().min(1).default(2000)
        .description('单次检索扫描文件上限（超限截断并显式标记 filesTruncated）/ Max files scanned per search (truncation is explicitly flagged)')
        .volatile(),
      skipDirs: z.array(z.string()).default(['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'])
        .description('检索目录遍历跳过的目录名（空数组=一个不跳）/ Directory names skipped during search traversal (empty array = skip none)')
        .volatile(),
    }).description('ast-grep 检索有界参数 / Bounded-search parameters for ast-grep')
      .collapse(),
  }).description('代码智能 MCP：ast 开关 + LSP 注册表 + 全局参数 / Code-intel MCP: ast switch + LSP registry + global parameters')
    .collapse(),
  hud: z.object({
    preset: z.union([z.const('minimal'), z.const('focused'), z.const('full')]).default('focused')
      .description('HUD 面板预设：minimal 极简卡 / focused 主模式卡（默认）/ full 全量 / HUD panel preset')
      .volatile(),
    refreshMs: z.natural().min(1000).default(5000)
      .description('HUD 面板轮询间隔 ms（经 hud.json 下发，client 自适应；≥1000）/ HUD panel poll interval in ms (delivered via hud.json)')
      .volatile(),
  }).description('HUD 面板（client half + /oh-my-dsh/hud.json 数据面）/ HUD panel (client half + data route)')
    .collapse(),
  delegate: z.object({
    provider: z.union([z.const('spawn'), z.const('subprocess'), z.const('queue')]).default('spawn')
      .description('omd_delegate 派发后端（高级：仅 spawn 已实现并校验注册；其余保留位）/ Dispatch backend (advanced: only spawn is implemented)')
      .experimental().volatile(),
  }).description('omd_delegate 硬路由派发 / Hard-route dispatch for omd_delegate')
    .collapse(),
  mcp: z.object({
    transport: z.const('stdio').default('stdio')
      .description('omd-state MCP 挂载传输层（当前仅 stdio：子进程 stdio 挂载，GUI 只读展示）/ MCP transport (stdio only, read-only)')
      .disabled().volatile(),
    serverName: z.string().default('omd-state')
      .description('omd-state MCP server 注册名（工具前缀 mcp__<name>__ 来源）/ MCP server name (source of the mcp__<name>__ tool prefix)')
      .volatile(),
    failOnStartupError: z.boolean().default(false)
      .description('MCP 启动失败是否阻断插件（false=降级：协议指导文件直读兜底）/ Whether an MCP startup failure blocks the plugin (false = degrade)')
      .volatile(),
    reconnect: z.object({
      enabled: z.boolean().default(true)
        .description('MCP 断线重连开关 / Reconnect on MCP disconnect')
        .volatile(),
      initialDelayMs: z.natural().default(1000)
        .description('重连初始延迟 ms / Initial reconnect delay in ms')
        .volatile(),
      maxDelayMs: z.natural().min(1).default(30_000)
        .description('重连延迟上限 ms（指数退避封顶）/ Max reconnect delay in ms (backoff cap)')
        .volatile(),
      maxAttempts: z.natural().default(5)
        .description('重连最大尝试次数（0=失败即放弃）/ Max reconnect attempts (0 = give up on first failure)')
        .volatile(),
    }).description('MCP 断线重连策略 / MCP reconnect policy')
      .collapse(),
  }).description('omd-state MCP server 挂载参数（lib/index.js 运行时动态挂载）/ omd-state MCP mount parameters')
    .collapse(),
  memory: z.object({
    workingTtlDays: z.natural().min(1).default(7)
      .description('notepad working 区条目存活天数（过期自动清理；priority/manual 不动）/ TTL in days for notepad working-zone entries')
      .volatile(),
  }).description('记忆面（mcp-server notepad）/ Memory surface (mcp-server notepad)')
    .collapse(),
  // 兼容别名：旧配置 `hudPreset: full` 仍生效（hud-route 读 hud.preset ?? hudPreset）。
  // 故意不标 volatile（GUI 不展示）+ hidden（schema 驱动渲染器隐藏）。新配置请写 hud.preset。
  hudPreset: z.union([z.const('minimal'), z.const('focused'), z.const('full')]).default('focused')
    .description('兼容别名（已废弃，请用 hud.preset）/ Deprecated alias, use hud.preset instead')
    .hidden(),
})

// schemastery 无 zod 式 .parse()：schema 本身是可调用函数（Config(data) 即解析）。
// 此处附加 parse 别名以统一调用面（后续任务请用 Config.parse(data)，语义 = 直接调用）。
Config.parse = (data) => Config(data)

// cosmokit Volatile 识别协议（isVolatile 源码实证：`write in value`，write =
// Symbol.for('cosmokit.volatile.write') 全局注册表符号）——omd 不直引 cosmokit
// （非依赖），用同一全局符号做跨 ESM/CJS 副本识别。
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** 解包 volatile 引用：Volatile → .get() 快照；普通值原样返回（兼容手写纯对象 config）。 */
export function configValue(v) {
  return (typeof v === 'object' && v !== null && VOLATILE_WRITE in v && typeof v.get === 'function') ? v.get() : v
}

/** 深解包：递归解开任意深度的 Volatile 引用，得纯数据（序列化/MCP env JSON 前必经此）。 */
export function plainConfig(value) {
  const v = configValue(value)
  if (Array.isArray(v)) return v.map(plainConfig)
  if (v !== null && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) out[k] = plainConfig(v[k])
    return out
  }
  return v
}

/** 角色→模型解析：roleOverrides > tiers；'inherit' → undefined。 */
export function resolveModel(config, role) {
  const overrides = configValue(config.roleOverrides) ?? {}
  const tiers = config.tiers ?? {}
  const v = overrides[role.name] ?? configValue(tiers[role.tier])
  return v === 'inherit' ? undefined : v
}
