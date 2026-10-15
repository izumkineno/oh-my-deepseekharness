// tests/lib/index.test.js
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, setup, name, inject, Config } from '../../lib/index.js'

function mockCtx() {
  const reg = { sections: [], contexts: [], skills: [], commands: [], tools: [], effects: [] }
  return {
    reg,
    ctx: {
      systemPrompt: { section: (s) => reg.sections.push(s), context: (c) => reg.contexts.push(c) },
      skills: { register: (s) => reg.skills.push(s) },
      commands: { register: (c) => reg.commands.push(c) },
      tools: { register: (t) => reg.tools.push(t) },
      // 宿主真实 API 形状（§7-7 核验）：domain.open → Domain，table 同步 get / 异步 put+delete
      storage: {
        domain: {
          open: async () => ({
            table: () => ({ get() {}, async put() {}, async delete() {} }),
            async close() {},
          }),
        },
      },
      effect: (fn) => reg.effects.push(fn),
      on: () => {},
    },
  }
}

test('插件导出符合 cordis 约定', () => {
  expect(name).toBe('oh-my-dsh')
  expect(inject).toContain('systemPrompt')
  expect(inject).toContain('skills')
  expect(inject).toContain('commands')
  expect(inject).toContain('tools')
  // M1.1：storage 必须进 inject（cordis 未 inject 服务访问抛错；dsh-base 保证其存在）
  expect(inject).toContain('storage')
  expect(typeof Config.parse).toBe('function')
})

test('apply 全量注册：1 section + 1 context + 40 skill + 19 角色 + 2 命令 + 3 记忆工具', async () => {
  const { ctx, reg } = mockCtx()
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  await writeFile(join(assetsRoot, 'agents', 'r.zh.md'), '---\nname: omd-agent-r\ndescription: d\ntier: low\n---\nrole\n')
  // defineTool 经 opts 注入（计划任务 14 步骤 4 授权）：测试传 identity，实装默认 import @deepseek-ai/dsh-tools
  await apply(ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(reg.sections).toHaveLength(1)
  expect(reg.contexts).toHaveLength(1)
  expect(reg.skills).toHaveLength(2)   // 1 skill + 1 role（fixture 规模；真实 assets 是 40+19）
  expect(reg.commands).toHaveLength(2)
  expect(reg.tools).toHaveLength(3)
  // §7-2 核验：dsh-system-prompt 的 section/context 均强制有限 order；text 必须同步求值
  expect(Number.isFinite(reg.sections[0].order)).toBe(true)
  expect(Number.isFinite(reg.contexts[0].order)).toBe(true)
  expect(typeof reg.sections[0].text()).toBe('string')
  expect(typeof reg.contexts[0].text()).toBe('string')
  // domain close 已经 ctx.effect 注册（cordis 配置变更重放插件时 dispose）
  expect(reg.effects.length).toBeGreaterThan(0)
})

// M1.1 核心回归：storage 探测 ok 时记忆工具真实注册（修复前 inject 缺 storage →
// cordis 访问抛错 → 误判 unavailable → 记忆工具永远不注册）
test('storage ok → probeReport.storage=ok 且 3 个记忆工具真实注册', async () => {
  const { ctx, reg } = mockCtx()
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  const { probeReport } = await setup(ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(probeReport.storage.status).toBe('ok')
  expect(probeReport.memoryTools.status).toBe('ok')
  expect(reg.tools.map(t => t.name).sort()).toEqual(['omd_memory_delete', 'omd_memory_get', 'omd_memory_set'])
  // hooksBridge unavailable 不进降级公告（二期前置项）
  expect(reg.contexts[0].text()).not.toContain('hooksBridge')
})

test('核心服务缺失时 apply 启动即报错（规格 §6.1 例外条款）', async () => {
  const { ctx } = mockCtx()
  delete ctx.systemPrompt
  await expect(apply(ctx, Config.parse({}), { assetsRoot: '/nonexistent' })).rejects.toThrow()
})

// ---------- ⑤ MCP 挂载快照（Config mcp/team/memory 段 → ctx.plugin 参数 + 子进程 env） ----------

test('setup 挂载 MCP：mcp.* 进 plugin 参数；team/memory/codeIntel 深解包进 env 快照', async () => {
  const { ctx } = mockCtx()
  let captured
  ctx.plugin = async (_def, cfg) => { captured = cfg }
  ctx.logger = { info() {}, warn() {} }
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  const { probeReport } = await setup(ctx, Config.parse({
    stateDir: '.omd-test',
    mcp: { serverName: 'omd-e2e', failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 1 } },
    team: { maxFixLoops: 5, casRetries: 7 },
    memory: { workingTtlDays: 30 },
    codeIntel: { lsp: { maxRestarts: 9 } },
  }), { assetsRoot, defineTool: (x) => x })
  expect(probeReport.mcpServer.status).toBe('ok')
  expect(captured.transport).toBe('stdio')
  expect(captured.serverName).toBe('omd-e2e')
  expect(captured.command).toBe(process.execPath)
  expect(captured.args.join('/').replaceAll('\\', '/')).toContain('mcp-server/index.mjs')
  expect(captured.failOnStartupError).toBe(true)
  expect(captured.reconnect).toEqual({ enabled: false, initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 1 })
  // env 快照：纯值（volatile 已深解包——直接 JSON.stringify(volatile) 会塌成 {}，此处必须能解析出值）
  expect(captured.env.OMD_STATE_DIR).toBe('.omd-test')
  expect(JSON.parse(captured.env.OMD_TEAM)).toMatchObject({ maxFixLoops: 5, casRetries: 7, staleAfterMs: 300000, heartbeatIntervalMs: 60000 })
  expect(JSON.parse(captured.env.OMD_MEMORY)).toEqual({ workingTtlDays: 30 })
  expect(JSON.parse(captured.env.OMD_CODE_INTEL)).toMatchObject({ lsp: expect.objectContaining({ maxRestarts: 9 }) })
})

test('setup 挂载 MCP：ctx.plugin 缺席（旧宿主）→ failure 降级，不阻断插件', async () => {
  const { ctx } = mockCtx()
  ctx.logger = { info() {}, warn() {} }
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  const { probeReport } = await setup(ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(probeReport.mcpServer.status).toBe('failure')
  expect(probeReport.memoryTools.status).toBe('ok') // 其余注册不受影响
})
