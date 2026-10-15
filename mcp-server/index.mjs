// mcp-server/index.mjs
// omd 自带 stdio MCP server（规格 §5.2）。启动方式：process.execPath index.mjs
// 环境变量：OMD_STATE_DIR（默认 .omd）；OMD_CODE_INTEL（插件 Config codeIntel 段 JSON：
//   astGrep 开关 + lspServers 注册表 + lsp/search 全局参数，lib/index.js 挂载时注入）；
//   OMD_TEAM（Config team 段 JSON：staleAfterMs/maxFixLoops/casRetries）；OMD_MEMORY
//   （Config memory 段 JSON：workingTtlDays）。每工具调用经参数传 cwd/sessionId。
//   注：MCP 进程配置 = 挂载时 env 快照（GUI 改值后宿主重放 apply() 触发重挂载）。
//   env.* 损坏 JSON 一律回退 {}（各工具再取默认值），绝不阻断 server 启动。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerStateTools } from './tools/state.mjs'
import { registerNotepadTools } from './tools/notepad.mjs'
import { registerPrdTools } from './tools/prd.mjs'
import { registerHandoffTools } from './tools/handoff.mjs'
import { registerTeamTools } from './tools/team.mjs'
import { registerTraceTools } from './tools/trace.mjs'
import { registerHudTools } from './tools/hud.mjs'
import { registerCodeIntelTools } from './tools/codeintel.mjs'

const server = new McpServer({ name: 'omd-state', version: '0.1.0' })
const parseEnvJson = (v) => { try { return JSON.parse(v || '{}') } catch { return {} } }
const env = {
  stateDir: process.env.OMD_STATE_DIR || '.omd',
  codeIntel: parseEnvJson(process.env.OMD_CODE_INTEL),
  team: parseEnvJson(process.env.OMD_TEAM),
  memory: parseEnvJson(process.env.OMD_MEMORY),
}
registerStateTools(server, env)
registerNotepadTools(server, env)
registerPrdTools(server, env)
registerHandoffTools(server, env)
registerTeamTools(server, env)
registerTraceTools(server, env)
registerHudTools(server, env)
registerCodeIntelTools(server, env)
await server.connect(new StdioServerTransport())
