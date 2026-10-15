# oh-my-deepseekharness dsh Web GUI 配置列表设计（t3）

> 状态：设计稿（待 t4 实施）。输入：t1《dsh-context Web GUI 配置机制调研》+ t2《当前项目可配置项审计》。
> 目标：参考 https://github.com/bowenliang123/dsh-context，为 oh-my-deepseekharness 补齐**最详细**的 dsh Web GUI 配置列表。
> 路径约定：未注明根时，相对仓库根 `E:\Code\_git_public\oh-my-deepseekharness`。

---

## 0. 设计原则（来自 t1 的硬约束，先摆结论）

| # | 原则 | 来源 |
|---|---|---|
| P1 | **GUI 可编辑 ⟺ `.volatile()`**：dsh-settings 只投影 volatile 字段。凡本设计要进 GUI 的叶键，schema 侧一律加 `.volatile()` | t1 §1 |
| P2 | **分组 = 嵌套 object**（前端按嵌套折叠展示，`.collapse()` 控制折叠）；**枚举 = `union(const)`**（前端渲染为下拉 choices） | t1 §1 |
| P3 | 值语义：effective = user 层 > composition 层 > schema default；reset = unset 恢复继承；home patch / 命令行 overlay 更高，冲突写被拒 | t1 §1 |
| P4 | 链路：宿主 Config → dsh-settings 形态投影 → `settings describe mirror(ctx.configForms)` → Plugins 页槽位 → SettingsForm 表单套件 → revision-fenced mutate 写 profile `cordis.patch.yml` → HMR 即时重组（`apply` 重放） | t1 总览 |
| P5 | **默认值必须等于现状行为**：凡从硬编码提升为配置键的项，default 取代码现有常量值，保证“零配置升级行为零变化” | 本设计新增约束 |
| P6 | 读面分两类：**插件进程直读**（`setup/apply` 闭包内直接读 `config.*`）与 **MCP 进程 env 透传**（`mcp-server` 独立进程，只能经 `OMD_*` 环境变量拿配置；现状仅 `OMD_STATE_DIR` + `OMD_CODE_INTEL`，见 `mcp-server/index.mjs:3,18-19`）。凡 MCP 侧消费的新键必须同步设计 env 透传 | t2 + 本设计实测 |

### 非目标

- 不改 dsh 宿主 / dsh-settings / schemastery 任何行为；只改 omd 侧 `Config` + 消费点读配置 + 文档。
- 不做 client 自动建页（`autoGenerate` 尚无 shipped client 消费，t1 §1）；GUI 落点是宿主 **Settings → Plugins → oh-my-dsh** 的 schema 投影表单。

---

## 1. 分组总览

9 组 **39 叶**（现有 21 叶全部保留 + 新增 18 叶；另有 1 个隐藏兼容别名）。

| 组 | schema 路径 | 叶数 | 状态构成 | GUI 呈现 |
|---|---|---|---|---|
| G0 基础 | `language`、`stateDir`（顶层扁平） | 2 | 2 存量 | 顶层表单区 |
| G1 HUD 显示 | `hud.*` | 2 | 2 新增（P0×1、P2×1） | 折叠组 `hud` |
| G2 模型与路由 | `tiers.*`、`roleOverrides`、`routing.*`、`delegate.*` | 8 | 5 存量 + 3 新增（P1×2、P2×1） | 折叠组 ×4 |
| G3 Autopilot | `autopilot.*` | 3 | 3 存量 | 折叠组 |
| G4 深度访谈 | `deepInterview.*` | 3 | 3 存量（1 项补校验 P0） | 折叠组 |
| G5 团队协作 | `team.*` | 4 | 2 存量 + 2 新增（P1×1、P2×1） | 折叠组 |
| G6 MCP 挂载 | `mcp.*`（含 `reconnect.*` 二级组） | 7 | 7 新增（P1×7，1 项只读） | 折叠组 + 二级组 |
| G7 代码智能 | `codeIntel.*`（含 `lsp.*`、`search.*` 二级组） | 9 | 2 存量（1 项补子键 P0）+ 7 新增（P1×2、P2×5） | 折叠组 + 二级组 |
| G8 记忆 | `memory.*` | 1 | 1 新增（P2×1） | 折叠组 |

优先级定义：**P0** = 隐藏项补齐 / 校验缺口（GUI 正确性所必需，t4 必做）；**P1** = 高价值硬编码提升（建议 t4 同批做）；**P2** = 长尾可调项（t4 可做，至少 schema 预留位）。

---

## 2. G0 基础（存量 2 叶，原样保留）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C1 | `language` | 资产语言 / Asset language | 枚举下拉（`zh`/`en`/`both`） | `zh` | 三选一 | 存量（`lib/config.js:5`） |
| C2 | `stateDir` | 状态目录名 / State directory | 文本输入 | `.omd` | 非空；建议 `pattern: ^[^/\\]+$`（单段目录名，禁路径穿越） | 存量（`:19`） |

- C1 中文说明：技能与角色卡渲染语言：`zh` 中文 / `en` 英文 / `both` 中文正文 + 英文术语。切换后 HMR 重放即时生效（`loadAssets` 按语言选资产）。
- C1 English: Asset rendering language: `zh` Chinese, `en` English, `both` Chinese body with English terms. Takes effect immediately via HMR replay.
- C2 中文说明：项目状态目录名（`<cwd>/<stateDir>/` 下落 state/team/notepad/trace 等运行时数据）。绝对路径亦可（测试/自定义场景），但 GUI 内建议只填单段目录名。
- C2 English: Project state directory name. Runtime data (state/team/notepad/trace) lives under `<cwd>/<stateDir>/`. Prefer a single-segment name in the GUI.
- 消费点：C1 → `lib/index.js:59`（`loadAssets`）、`lib/skills.js`；C2 → `lib/index.js:114`（`OMD_STATE_DIR` 透传 MCP）、`lib/routing.js:107`、`lib/heartbeat.js:22`、`lib/hud-route.js:49` 等全链路默认参数。
- GUI 映射：C1 `union(const)` → 下拉 choices；C2 `string` → 文本框；两项均 `.volatile()`。

---

## 3. G1 HUD 显示（新增组，P0×1 + P2×1）

> 动机：`lib/hud-route.js:21-23` 的 `resolvePreset(config)` 读 `config.hudPreset`，但 schema **从未声明**该键（t2-B1）——GUI 上改不了面板预设，这是 P0 缺口。

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C3 | `hud.preset` | HUD 面板预设 / HUD panel preset | 枚举下拉（`minimal`/`focused`/`full`） | `focused` | 三选一 | **新增 P0**（补 t2-B1；权威枚举 `lib/hud.js:73-74`） |
| C4 | `hud.refreshMs` | HUD 刷新间隔（毫秒）/ HUD refresh interval (ms) | 数字输入（步进 500） | `5000` | `min: 1000`（低于 1s 视为抖动保护下限），`step: 500` | **新增 P2**（提升 `lib/client.js:36` `REFRESH_MS`） |

- C3 中文说明：右侧边栏 omd HUD 面板的三档呈现：`minimal` 极简（同源 8 行中文卡 `<pre>` 文本）、`focused` 聚焦（主模式卡 + 记忆一行 + 取数时间，默认）、`full` 完整（全部模式卡 + 记忆三区明细 + 数据面元信息）。经 `hud.json` 下发，client 只渲染不自决；非法值回退 `focused`。
- C3 English: HUD sidebar panel density: `minimal` (8-line card text), `focused` (primary mode + memory line, default), `full` (all modes + memory breakdown + fetch metadata). Delivered via `hud.json`; invalid values fall back to `focused`.
- C4 中文说明：HUD 面板轮询 `GET /oh-my-dsh/hud.json` 的间隔。改小更实时但增加宿主取数压力；改大更省。经 `hud.json` 下发 `refreshMs`，client 优先采用下发值（缺省 5000，见 §10 实现注）。
- C4 English: Polling interval for `GET /oh-my-dsh/hud.json`. Smaller = more live but more host load. Delivered via `hud.json`; the client prefers the delivered value.
- **兼容别名（隐藏，不计数）**：顶层 `hudPreset` 保留为 `.deprecated('请改用 hud.preset').hidden()` 的解析兼容键；`resolvePreset` 改为 `config?.hud?.preset ?? config?.hudPreset ?? 'focused'`。GUI 不展示（hidden），老 profile 手写值不断（deprecated 只打标仍解析）。⚠️ `hidden` 在 dsh-settings 投影中的隐藏语义需 t4 实证；若不生效则回退为可见 + deprecated badge。
- 消费点：C3 → `lib/hud-route.js:21-23,44`；C4 → `lib/hud-route.js`（下发）+ `lib/client.js:52-66`（轮询周期，bundle 改动见 §10）。
- GUI 映射：`hud` 对象组 `.collapse()`；C3 下拉；C4 数字框。

**G1 不暴露清单**：`HUD_ROUTE_PATH`（`/oh-my-dsh/hud.json`，改之则 client 失联，属内部契约）、`TIER_TEXT/TIER_COLOR`（呈现常量）、`TAB_ID/TAB_KIND`（槽位契约）——理由：改动即破坏面板接线，无用户可调语义。

---

## 4. G2 模型与路由（存量 5 + 新增 3）

### 4.1 `tiers.*` + `roleOverrides`（存量）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C5 | `tiers.low` | 低档模型 / Low-tier model | 文本输入（模型 id） | `glm-5.3-flash` | 非空；`inherit` 表继承主会话 | 存量（`:8`） |
| C6 | `tiers.medium` | 中档模型 / Medium-tier model | 同上 | `glm-5.3-flash` | 同上 | 存量（`:9`） |
| C7 | `tiers.high` | 高档模型 / High-tier model | 同上 | `glm-5.3-flash` | 同上 | 存量（`:10`） |
| C8 | `roleOverrides` | 角色级模型覆盖 / Per-role model overrides | 键值表（role → 模型 id） | `{}` | key 为角色卡名（`omd-agent-*`）；value 模型 id 或 `inherit` | 存量（`:14`） |

- C5–C7 中文说明：档位 → 模型映射。值可为部署可解析的模型 id（如 `glm-5.3-flash`，可带 `provider/` 前缀写复合格式 `provider/model`），或 `inherit`（继承主会话模型）。默认值对齐部署 LLM 服务；不可用 id 由 `omd_delegate` 派发前校验显式报错，绝不静默继承。
- C5–C7 English: Tier-to-model mapping. Value is a resolvable model id (optionally `provider/model`) or `inherit` (inherit the main session model). Unresolvable ids fail loudly at dispatch time, never silently inherit.
- C8 中文说明：角色级覆盖，优先级高于档位表，如 `{ "omd-agent-code-reviewer": "provider/model" }`。解析规则见 `resolveModel`（`lib/config.js:54-58`）：`roleOverrides > tiers`，`inherit → undefined`。
- C8 English: Per-role overrides, taking precedence over the tier table, e.g. `{ "omd-agent-code-reviewer": "provider/model" }`. Resolution: `roleOverrides > tiers`; `inherit` resolves to undefined.
- 消费点：`resolveModel` → `lib/protocol.js:13-16`（模型路由表渲染）、`lib/delegate.js:146-147`（硬路由派发）。
- GUI 映射：`tiers` 折叠组内三文本框；`roleOverrides` 为 `dict` → 键值对编辑器（可增删行）。

### 4.2 `routing.*`（存量 1 + 新增 2）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C9 | `routing.defaultTier` | 会话默认档 / Default tier | 枚举下拉（`low`/`medium`/`high`） | `medium` | 三选一 | 存量（`:17`） |
| C10 | `routing.lowMax` | 自适应路由 low 分带上限 / Adaptive-routing low band max | 数字输入 | `2` | `min: 0`，`max: 8`；须 ≤ C11（跨键约束，GUI 文案提示，见下） | **新增 P1**（提升 `lib/routing.js:24` `TIER_BANDS.lowMax`） |
| C11 | `routing.mediumMax` | 自适应路由 medium 分带上限 / Adaptive-routing medium band max | 数字输入 | `5` | `min: 0`，`max: 8`；须 ≥ C10 | **新增 P1**（提升 `TIER_BANDS.mediumMax`） |

- C9 中文说明：c3 自适应路由的表外任务 fallback 档：角色不在路由表时落此档，并在权威 run-state 记 `fallback:true`（可审计）。同值在 `lib/routing.js:68`（`routeOnce` 签名默认）与 `lib/delegate.js:53`（`?? 'medium'`）有两处硬兜底——GUI 只暴露本键，t4 顺手把两处兜底改为读本键（行为不变）。
- C9 English: Fallback tier for off-table roles in c3 adaptive routing. Misses land here and are audited with `fallback:true` in run-state.
- C10/C11 中文说明：4 特征静态评分（任务类型/接触面/失败可逆性/上下文自包含性，每特征 0–2 分，总分 0–8）到建议档的映射：总分 ≤ lowMax → `low`；≤ mediumMax → `medium`；其余 → `high`。最终档 = min(建议档, 角色表定档)（只降不升）。⚠️ schemastery 无跨键校验：`lowMax ≤ mediumMax` 靠 GUI description 文案 + `suggestTier` 运行时断言（非法即抛错，不静默）共同保证。
- C10/C11 English: Score-band mapping for the 4-feature static assessment (total 0–8): score ≤ lowMax → `low`; ≤ mediumMax → `medium`; else `high`. Final tier = min(suggested, role table cap). The `lowMax ≤ mediumMax` invariant is enforced by a runtime assertion, not the schema.
- 消费点：C9 → `lib/delegate.js:53,58`、`lib/routing.js:68,80`、`lib/protocol.js:59`；C10/C11 → `lib/routing.js:27-36`（t4 需把 `suggestTier` 的常量读改为经 `routeOnce`/`resolveDispatch` 线程传入，见 §10；`TIER_BANDS` 保留为 schema default 的同源常量）。
- GUI 映射：`routing` 折叠组；C9 下拉；C10/C11 数字框（`min/max` 进 schema，`step: 1`）。

### 4.3 `delegate.*`（新增 1，高级）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C12 | `delegate.provider` | 派发后端（高级）/ Dispatch provider (advanced) | 文本输入 | `spawn` | `pattern: ^[A-Za-z0-9_-]+$` | **新增 P2**（提升 `lib/delegate.js:15` `DELEGATE_PROVIDER`；标记 `.experimental()` 高级项） |

- 中文说明：`omd_delegate` 硬路由派发所用的宿主 subagent provider 注册名。默认 `spawn`（宿主 in-process 后端）。除非自研 provider，否则勿改；provider 未注册时派发前显式报错并列出已注册名。
- English: Host subagent provider name used by `omd_delegate` hard-routing dispatch. Default `spawn` (in-process backend). Do not change unless you ship a custom provider; an unregistered name fails loudly at dispatch.
- 消费点：`lib/delegate.js:170,189`（`getProvider`/`start`）。
- GUI 映射：`delegate` 折叠组 + `.experimental()` 角标（t1 §1：experimental 渲染 badge）。

---

## 5. G3 Autopilot（存量 3，原样保留）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C13 | `autopilot.maxIterations` | 最大迭代轮数 / Max iterations | 数字输入 | `10` | `min: 1`（存量已有） | 存量（`:21`） |
| C14 | `autopilot.maxQaCycles` | QA 循环上限 / Max QA cycles | 数字输入 | `5` | `min: 1` | 存量（`:22`） |
| C15 | `autopilot.maxValidationRounds` | 复验轮数上限 / Max validation rounds | 数字输入 | `3` | `min: 1` | 存量（`:23`） |

- C13 中文说明：autopilot/goal 循环的最大迭代轮数；同时是 `create_goal` 的 `max_goal_rounds` 默认建议值（协议段渲染）。
- C13 English: Max autopilot/goal loop iterations; also the suggested default for `create_goal`'s `max_goal_rounds`.
- C14 中文说明：单轮内 QA 循环次数上限；同错误出现 3 次提前停（该 3 为 skill 内约定的停机口径，非本键语义，见 §9 不暴露清单）。
- C14 English: Max QA cycles per iteration. (The "same error 3 times → early stop" rule is a skill-level policy, not this key.)
- C15 中文说明：re-validation 复验轮数上限。
- C15 English: Max re-validation rounds.
- 消费点：`lib/protocol.js:98-99`（协议段渲染进模型可见约束；模型运行时无法读插件 Config，故走渲染）。
- GUI 映射：`autopilot` 折叠组；三数字框。**不追加上界 `.max()`**（决定：避免收紧存量大值用户的解析行为；超大值属用户自担）。

---

## 6. G4 深度访谈（存量 3，其中 1 项补校验 P0）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C16 | `deepInterview.ambiguityThreshold` | 歧义度阈值 / Ambiguity threshold | 滑杆/数字（步进 0.05） | `0.2` | **新增** `min: 0`，`max: 1`，`step: 0.05` | 存量 + **补校验 P0**（现无范围，`:28`） |
| C17 | `deepInterview.maxRounds` | 访谈硬上限轮数 / Hard max rounds | 数字输入 | `20` | `min: 1` | 存量（`:29`） |
| C18 | `deepInterview.softWarningRounds` | 软提醒轮数 / Soft-warning rounds | 数字输入 | `10` | `min: 1` | 存量（`:30`） |

- C16 中文说明：deep-interview skill 的模糊度门禁阈值（0–1）：高于阈值追问，低于阈值放行。0 = 永远追问（最严），1 = 几乎不问（最松）。
- C16 English: Fuzziness gate for the deep-interview skill (0–1): above threshold → ask; below → proceed. 0 = always ask (strictest), 1 = rarely ask.
- C17/C18 中文说明：访谈轮数硬上限（到顶强制收敛）与软提醒轮数（到轮数时提醒主持人准备收敛）。建议 `softWarningRounds ≤ maxRounds`（跨键约束，文案提示，无运行时断言——访谈是 skill 内软执行）。
- C17/C18 English: Hard cap on interview rounds (forced convergence) and the soft-warning round (nudge to wrap up). Keep `softWarningRounds ≤ maxRounds`.
- 消费点：`lib/protocol.js:88-89`（渲染进协议段 `## deep-interview 配置`）。
- GUI 映射：`deepInterview` 折叠组；C16 滑杆（`min/max/step` 进 schema，前端按 range 渲染）；C17/C18 数字框。

---

## 7. G5 团队协作（存量 2 + 新增 2）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C19 | `team.heartbeatIntervalMs` | 心跳检测周期（毫秒）/ Heartbeat interval (ms) | 数字输入（步进 1000） | `60000` | `min: 0`；`0` = 关闭插件侧定时器（按需扫描仍可用） | 存量（`:33`） |
| C20 | `team.staleAfterMs` | 队员 stale 阈值（毫秒）/ Worker stale threshold (ms) | 数字输入（步进 1000） | `300000` | `min: 1` | 存量（`:34`） |
| C21 | `team.maxFixLoops` | fix 循环上限 / Max fix loops | 数字输入 | `3` | `min: 1` | **新增 P1**（提升 `lib/team.js:48` `DEFAULT_MAX_FIX_LOOPS`；调用面无覆盖，最值得暴露） |
| C22 | `team.casRetries` | run-state CAS 重试预算 / Run-state CAS retry budget | 数字输入 | `3` | `min: 0`（0 = 冲突直接覆盖写 + warning 行） | **新增 P2**（提升 `lib/runstate.js:83` `retries = 3`；调用级 `retries` 参数保留覆盖权） |

- C19 中文说明：插件侧 team 心跳周期检测定时器间隔。`0` 关闭定时器（`probe.teamHeartbeat=skipped`，协议 runtime 段不公告）；领队仍可用 `team_heartbeat_scan` 按需扫描。定时器只检测 + 日志告警，绝不自动杀队员（催促归领队模型）。
- C19 English: Plugin-side periodic heartbeat scan interval. `0` disables the timer (on-demand scan still available). Detection + alerting only — never auto-kills workers.
- C20 中文说明：队员 `now - lastHeartbeatAt > staleAfterMs` 即标 stale（粘性：下次心跳复位）。`scanHeartbeat` 读时计算，不持久化标记（跨进程零写，评审修复结论）。
- C20 English: Worker is flagged stale when `now - lastHeartbeatAt > staleAfterMs` (sticky; reset on next heartbeat). Computed at read time, never persisted.
- C21 中文说明：阶段状态机 `team-fix → team-exec` 回边允许次数。超限后只允许转 `failed`/`cancelled`，绝不无限循环。写入 `phase.json` 的 `maxFixLoops`（run 粒度快照：改配置只影响新 run，已有 run 沿用快照值——GUI 文案必须写明）。
- C21 English: Allowed `team-fix → team-exec` loop-backs. Past budget, only `failed`/`cancelled` transitions are allowed. Snapshotted per run in `phase.json`: config changes affect new runs only.
- C22 中文说明：c6 run-state 镜像写的 CAS 冲突重试次数：冲突 → warning 日志行 → 重读最新值重试；预算耗尽 → 以最新读值覆盖写 + warning 行（全程 version 严格 +1）。调用级 `retries` 参数可覆盖本键。
- C22 English: CAS-conflict retry budget for run-state mirror writes: conflict → warning line → re-read & retry; budget exhausted → overwrite with latest + warning line (version always +1).
- 消费点：C19/C20 → `lib/heartbeat.js:19,23`（插件进程直读）、`lib/team.js:341`（`scanHeartbeat` 默认 `DEFAULT_STALE_AFTER_MS`，与 C20 同值——t4 改为透传，保留常量作 MCP 直调回退）；C21 → `lib/team.js:63,87`（`initialPhaseState`/`transitionPhase`，**执行在 MCP 进程** → 需 env 透传 §10）；C22 → `lib/runstate.js:82-83`（同需 env 透传）。
- GUI 映射：`team` 折叠组；四数字框。

**G5 不暴露**：`team_dispose` 的 `reason` 默认 `'verified'`（`mcp-server/tools/team.mjs:35` → `lib/worktree.js:148`）——属**单次调用语义**（每次拆除理由不同），设全局默认无政策意义；调用级参数已覆盖。`TERMINAL_STATES`、`TRANSITIONS`、`SAFE_ID` 为状态机契约，不暴露。

---

## 8. G6 MCP 挂载（新增组，直抄 `lib/index.js:107-118` 硬编码）

> 现状：`ctx.plugin(mcp, {...})` 的 7 个叶值全部硬编码。提升为 `mcp.*` 组后，`setup` 内改为读 `config.mcp.*`（`command/args/env` 仍内部构造：`command=process.execPath`、`args=[包内 mcp-server/index.mjs]`、`env={OMD_STATE_DIR, OMD_CODE_INTEL(+新增 §10)}`，不进 GUI）。

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C23 | `mcp.transport` | 传输方式（只读）/ Transport (read-only) | 下拉（唯一选项 `stdio`，禁用） | `stdio` | `const('stdio')` + `.disabled()` | **新增 P1（只读展示位）** |
| C24 | `mcp.serverName` | MCP 服务名 / MCP server name | 文本输入 | `omd-state` | `pattern: ^[A-Za-z0-9_-]+$` | **新增 P1** |
| C25 | `mcp.failOnStartupError` | 启动失败即阻断插件 / Fail plugin on startup error | 开关 | `false` | — | **新增 P1** |
| C26 | `mcp.reconnect.enabled` | 断线重连 / Auto-reconnect | 开关 | `true` | — | **新增 P1** |
| C27 | `mcp.reconnect.initialDelayMs` | 重连初始延迟（毫秒）/ Reconnect initial delay (ms) | 数字输入 | `1000` | `min: 0` | **新增 P1** |
| C28 | `mcp.reconnect.maxDelayMs` | 重连最大延迟（毫秒）/ Reconnect max delay (ms) | 数字输入 | `30000` | `min: 0`；建议 ≥ C27（文案提示） | **新增 P1** |
| C29 | `mcp.reconnect.maxAttempts` | 重连最大次数 / Max reconnect attempts | 数字输入 | `5` | `min: 1` | **新增 P1** |

- C23 中文说明：当前仅支持 `stdio`（包内 server 子进程）。保留为只读展示位：让 GUI 如实呈现生效值，未来支持新传输时再开放编辑。
- C23 English: Only `stdio` (bundled server subprocess) is supported today. Read-only display slot; editable once new transports land.
- C24 中文说明：挂载到宿主 mcp-client 的服务名，即工具前缀 `mcp__<serverName>__*` 的中段。改名后协议段/文档中的 `mcp__omd-state__*` 示例需同步理解（协议段为静态渲染，不自动跟随——**改名属危险操作，GUI 文案警告**）。
- C24 English: Service name mounted on the host mcp-client (the `mcp__<serverName>__*` tool prefix). Renaming is dangerous: protocol text examples won't follow automatically.
- C25 中文说明：`false`（默认）= MCP 挂载失败时插件降级存活（协议层降级为文件直读，`probe.mcpServer=failure` 公告）；`true` = 启动即抛错，插件整体不可用。仅在“无状态工具则宁可不用插件”的强一致场景开启。
- C25 English: `false` (default) = survive MCP mount failure in degraded mode; `true` = fail the whole plugin at startup. Only for strict setups.
- C26–C29 中文说明：stdio 子进程意外退出后的重连策略：`enabled` 总开关；`initialDelayMs → maxDelayMs` 退避区间；`maxAttempts` 耗尽后放弃（记 `probe.mcpServer` 失败并 warn 日志）。
- C26–C29 English: Reconnect policy for the stdio subprocess: master switch, backoff window `initialDelayMs → maxDelayMs`, give up after `maxAttempts`.
- 消费点：`lib/index.js:107-118`（插件进程直读，`ctx.plugin` 第二参）。
- GUI 映射：`mcp` 折叠组 + `reconnect` 二级折叠组；C23 `.disabled()` 禁用下拉；C25/C26 开关；余数字框。

---

## 9. G7 代码智能（存量 2 + 新增 7；子组 `lsp.*` / `search.*`）

### 9.1 存量 + P0 子键补齐

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C30 | `codeIntel.astGrep` | ast-grep 开关 / ast-grep switch | 开关 | `true` | — | 存量（`:38`） |
| C31 | `codeIntel.lspServers` | LSP 注册表 / LSP registry | 字典表（name → `{command, args, languages, env, initializeTimeoutMs}`） | `{}` | 每条目 `command` 必填；`initializeTimeoutMs` 见下 | 存量 + **条目新增 `initializeTimeoutMs` P0**（补 t2-B2：`mcp-server/tools/codeintel.mjs:308` 已读，schema 未声明） |

- C30 中文说明：`ast_grep_search` / `ast_grep_replace` 总开关。`false` = 配置性关闭（`probe.codeIntel=skipped`，协议不公告）；`@ast-grep/napi` 缺席时工具显式报错，绝不静默降级成文本 grep。LSP 工具不受本键影响。
- C30 English: Master switch for `ast_grep_search` / `ast_grep_replace`. `false` = configured-off. A missing `@ast-grep/napi` fails loudly, never degrades to text grep. LSP tools are unaffected.
- C31 中文说明：语言服务器注册表，如 `{ typescript: { command: "typescript-language-server", args: ["--stdio"], languages: ["typescript"], env: {}, initializeTimeoutMs: 10000 } }`。语言服务器本体由用户环境提供，omd 只做进程管理（单实例 / 崩溃重启 ≤ `lsp.maxRestarts` / 随 MCP server 退出回收）。`env` 透传给子进程——⚠️ 勿填长期密钥，优先用宿主进程环境变量。
- C31 English: Language-server registry. Server binaries come from the user environment; omd only manages processes (single instance / crash restarts ≤ `lsp.maxRestarts` / reaped on MCP exit). `env` is passed to the child — avoid long-lived secrets there.
- C31 条目子键 `initializeTimeoutMs`：中文“单 server LSP initialize 握手超时（毫秒），缺省 10000” / English "Per-server LSP initialize handshake timeout (ms), default 10000"。类型 natural，`min: 1`，`.default(10000)`（老条目无此键时解析自动补默认，零迁移）。
- 关于 `env` 是否标 `role('secret')` 的决定：**不标**（可编辑性优先；secret role 会 redact 成 presence marker，t1 §1）。补偿措施 = 上述 ⚠️ 文案。P2 可选实证 `z.dict(z.string().role('secret'))` 的细粒度语义后再议。
- 消费点：C30 → `lib/index.js:193-202`（插件进程探测）+ MCP 工具门控；C31 → `OMD_CODE_INTEL` → `mcp-server/tools/codeintel.mjs:308` 等。
- GUI 映射：`codeIntel` 折叠组；C30 开关；C31 字典编辑器（每条目展开为对象表单：command 文本必填 + args/languages 列表 + env 键值表 + initializeTimeoutMs 数字）。

### 9.2 `codeIntel.lsp.*`（新增二级组：P1×1 + P2×2）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C32 | `codeIntel.lsp.requestTimeoutMs` | LSP 请求超时（毫秒）/ LSP request timeout (ms) | 数字输入 | `15000` | `min: 1` | **新增 P1**（提升 `:103` `DEFAULT_REQUEST_TIMEOUT_MS`；覆盖 documentSymbol/references/definition 三读面 `:392,418,429`） |
| C33 | `codeIntel.lsp.shutdownTimeoutMs` | LSP 关闭超时（毫秒）/ LSP shutdown timeout (ms) | 数字输入 | `5000` | `min: 1` | **新增 P2**（提升 `:104` `SHUTDOWN_TIMEOUT_MS`） |
| C34 | `codeIntel.lsp.maxRestarts` | LSP 崩溃重启预算 / LSP crash-restart budget | 数字输入 | `2` | `min: 0`（0 = 崩溃即停不再拉起） | **新增 P2**（提升 `:101` `MAX_RESTARTS`；仅显式 `lsp_stop` 复位预算） |

- 消费点：全 MCP 进程 → 经 `OMD_CODE_INTEL` JSON 自动透传（`lib/index.js:114` 已全量序列化 `config.codeIntel`，新子键零 plumbing），server 侧 `??` 同值回退。
- GUI 映射：`lsp` 二级折叠组；三数字框。

### 9.3 `codeIntel.search.*`（新增二级组：P1×1 + P2×3）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C35 | `codeIntel.search.maxResults` | ast-grep 默认结果上限 / ast-grep default result limit | 数字输入 | `50` | `min: 1` | **新增 P1**（提升 `:35` `DEFAULT_MAX_RESULTS`；调用级 `maxResults` 可覆盖） |
| C36 | `codeIntel.search.hardMaxResults` | ast-grep 硬上限 / ast-grep hard limit | 数字输入 | `500` | `min: 1`；建议 ≥ C35（文案提示） | **新增 P2**（提升 `:36` `HARD_MAX_RESULTS`；钳制 `min(max(1,maxResults), hard)`，`:162`） |
| C37 | `codeIntel.search.maxFiles` | ast-grep 收集文件上限 / ast-grep max files collected | 数字输入 | `2000` | `min: 1` | **新增 P2**（提升 `:59` `collectFiles maxFiles`；超限 `truncated:true` 显式告知，不静默） |
| C38 | `codeIntel.search.skipDirs` | ast-grep 跳过目录 / ast-grep skipped directories | 字符串列表 | `[".git","node_modules",".omd","dist","build","out",".next","coverage"]`（8 项，实测 `:34`——t2“9 项”系笔误） | 每项非空目录名（不含 `/`） | **新增 P2**（提升 `:34` `SKIP_DIRS`） |

- 消费点：全 MCP 进程 → `OMD_CODE_INTEL` 自动透传同上。
- GUI 映射：`search` 二级折叠组；三数字框 + 一列表编辑器。

---

## 10. G8 记忆（新增组，P2×1）

| ID | 配置键 | 中文标签 / EN label | 类型·控件 | 默认值 | 校验 | 状态 |
|---|---|---|---|---|---|---|
| C39 | `memory.workingTtlDays` | 工作记忆保留天数 / Working-memory retention (days) | 数字输入 | `7` | `min: 1` | **新增 P2**（提升 `mcp-server/tools/notepad.mjs:8` `WORKING_TTL_MS = 7×86400_000`；规格 §5.3 口径） |

- 中文说明：`notepad working` 区条目的存活天数（按条目日期惰性清理：`read` 触发过滤不落盘，`prune` 落盘；无日期条目永不过期）。priority 区永久、manual 区手动维护，不受本键影响。单位用“天”（GUI 友好），server 侧换算毫秒。
- English: Lifetime in days for `notepad working` entries (lazily expired by entry date; undated entries never expire). Priority (permanent) and manual zones are unaffected. Days in GUI, converted to ms server-side.
- 消费点：MCP 进程 → **需新增 env 透传**（`OMD_MEMORY` JSON，见 §11；`notepad.mjs` 经 `makeNotepadTools(env)` 读 `env.memory.workingTtlDays ?? 7`）。
- GUI 映射：`memory` 折叠组；数字框。

---

## 11. 读面与 env 透传总表（t4 接线依据）

### 11.1 插件进程直读（`setup/apply` 闭包，零 env）

| 键 | 消费文件:行 | 接线改动 |
|---|---|---|
| C1/C2 | `lib/index.js:59,114` 等 | 加 `.volatile()` 即可，消费不动 |
| C3 | `lib/hud-route.js:21-23` | `resolvePreset` 改为 `hud?.preset ?? hudPreset ?? 'focused'` + 兼容别名 |
| C4 | `lib/hud-route.js:30-46` + `lib/client.js:52-66` | `hudSnapshot` 下发 `refreshMs`；client `tick` 周期改读 `snap.refreshMs ?? 5000`（bundle + 单测同步） |
| C5–C9 | `lib/config.js:54-58`、`lib/delegate.js`、`lib/protocol.js` | 加 `.volatile()`；C9 顺手统一 `routing.js:68` 与 `delegate.js:53` 的硬兜底为读配置 |
| C10/C11 | `lib/routing.js:27-36` | `suggestTier(features, bands?)` 新增可选参，`routeOnce`/`resolveDispatch` 线程传入 `config.routing`；`TIER_BANDS` 保留为 default 同源常量 |
| C12 | `lib/delegate.js:170,189` | `registerDelegateTool` 闭包读 `config.delegate.provider ?? 'spawn'`；常量保留作回退 |
| C13–C18 | `lib/protocol.js:88-99` | C16 加 `min/max/step`；消费不动（渲染式消费） |
| C19/C20 | `lib/heartbeat.js:19,23` | 加 `.volatile()`；`??` 回退保留（与 default 同值） |
| C23–C29 | `lib/index.js:107-118` | `ctx.plugin` 第二参改读 `config.mcp.*`（`command/args/env` 仍内部构造） |

### 11.2 MCP 进程（必须 env 透传）

| 键 | 现有 env | t4 改动 |
|---|---|---|
| C2 `stateDir` | `OMD_STATE_DIR` ✅ | 不动 |
| C30/C31/C32–C38（`codeIntel.*` 全组） | `OMD_CODE_INTEL` ✅（`lib/index.js:114` 全量 JSON） | 不动 plumbing；server 侧新增 `??.` 同值回退读新子键 |
| C21 `team.maxFixLoops`、C22 `team.casRetries` | ❌ 无 | **新增 `OMD_TEAM`**（JSON：`{maxFixLoops, casRetries}`；`mcp-server/index.mjs` 解析并入 `env`；`team.mjs` 的 `initialPhaseState` 调用与 `writeMirror` 默认改读 `env.team.* ?? 同值`） |
| C39 `memory.workingTtlDays` | ❌ 无 | **新增 `OMD_MEMORY`**（JSON：`{workingTtlDays}`；`notepad.mjs` `makeNotepadTools(env)` 读 `env.memory.workingTtlDays ?? 7` 换算毫秒） |

> 选 JSON 整组透传而非多标量 env：与 `OMD_CODE_INTEL` 现有模式一致（`mcp-server/index.mjs:18`），新增键零 plumbing 增量。

---

## 12. schemastery 实现草案（t4 起点，非终稿）

要点：**每可编辑叶 `.volatile()`**；组对象 `.description()` + `.collapse()`；C23 `.disabled()`；兼容别名 `.deprecated().hidden()`；C12 `.experimental()`；C16 补 `min/max/step`；C31 条目补 `initializeTimeoutMs`。

```js
// lib/config.js（草案：只示结构， bilingual 文案以本设计 §2–§10 为准）
import z from '@deepseek-ai/schemastery'

const tierName = z.union([z.const('low'), z.const('medium'), z.const('high')])
const modelId = z.string().volatile() // 明细 description 见 C5–C7

export const Config = z.object({
  language: z.union([z.const('zh'), z.const('en'), z.const('both')])
    .default('zh').volatile()
    .description('资产语言：zh 中文 / en 英文 / both 中文正文+英文术语'),
  stateDir: z.string().default('.omd').volatile()
    .description('项目状态目录名'),
  hud: z.object({
    preset: z.union([z.const('minimal'), z.const('focused'), z.const('full')])
      .default('focused').volatile()
      .description('HUD 面板预设：minimal 极简卡 / focused 聚焦（默认）/ full 完整'),
    refreshMs: z.natural().min(1000).step(500).default(5000).volatile()
      .description('HUD 轮询 /oh-my-dsh/hud.json 的间隔毫秒（经 hud.json 下发）'),
  }).collapse().description('HUD 显示：右侧边栏 omd 面板'),
  // 兼容别名：老 profile 手写 hudPreset 不断；GUI 不展示
  hudPreset: z.union([z.const('minimal'), z.const('focused'), z.const('full')])
    .deprecated('请改用 hud.preset').hidden().optional(),
  tiers: z.object({
    low: modelId.default('glm-5.3-flash'),
    medium: modelId.default('glm-5.3-flash'),
    high: modelId.default('glm-5.3-flash'),
  }).collapse().description('档位→模型映射；"inherit" 继承主会话'),
  roleOverrides: z.dict(z.string()).default({}).volatile()
    .description('角色级覆盖，如 { "omd-agent-code-reviewer": "provider/model" }'),
  routing: z.object({
    defaultTier: tierName.default('medium').volatile(),
    lowMax: z.natural().max(8).default(2).volatile()
      .description('自适应路由 low 分带上限（总分≤此值→low；须≤mediumMax）'),
    mediumMax: z.natural().max(8).default(5).volatile()
      .description('自适应路由 medium 分带上限（总分≤此值→medium）'),
  }).collapse().description('c3 自适应路由'),
  delegate: z.object({
    provider: z.string().pattern(/^[A-Za-z0-9_-]+$/).default('spawn').volatile()
      .experimental().description('派发后端（高级）：宿主 subagent provider 注册名'),
  }).collapse().description('硬路由派发（高级）'),
  autopilot: z.object({
    maxIterations: z.natural().min(1).default(10).volatile(),
    maxQaCycles: z.natural().min(1).default(5).volatile(),
    maxValidationRounds: z.natural().min(1).default(3).volatile(),
  }).collapse().description('autopilot 循环界限（渲染进协议段）'),
  deepInterview: z.object({
    ambiguityThreshold: z.number().min(0).max(1).step(0.05).default(0.2).volatile()
      .description('歧义度阈值 0–1：高于追问，低于放行'),
    maxRounds: z.natural().min(1).default(20).volatile(),
    softWarningRounds: z.natural().min(1).default(10).volatile(),
  }).collapse().description('深度访谈门禁与轮数（渲染进协议段）'),
  team: z.object({
    heartbeatIntervalMs: z.natural().default(60_000).volatile()
      .description('心跳检测周期毫秒（0=关闭定时器，按需扫描仍可用）'),
    staleAfterMs: z.natural().min(1).default(300_000).volatile()
      .description('队员 stale 阈值毫秒'),
    maxFixLoops: z.natural().min(1).default(3).volatile()
      .description('fix 循环上限（只影响新 run，已有 run 沿用 phase.json 快照）'),
    casRetries: z.natural().default(3).volatile()
      .description('run-state CAS 重试预算（调用级 retries 可覆盖）'),
  }).collapse().description('团队协作运行时'),
  mcp: z.object({
    transport: z.const('stdio').default('stdio').volatile().disabled()
      .description('传输方式（只读：当前仅 stdio）'),
    serverName: z.string().pattern(/^[A-Za-z0-9_-]+$/).default('omd-state').volatile()
      .description('MCP 服务名（工具前缀中段；改名危险，协议示例不跟随）'),
    failOnStartupError: z.boolean().default(false).volatile()
      .description('启动失败即阻断插件（默认 false=降级存活）'),
    reconnect: z.object({
      enabled: z.boolean().default(true).volatile(),
      initialDelayMs: z.natural().default(1000).volatile(),
      maxDelayMs: z.natural().default(30000).volatile(),
      maxAttempts: z.natural().min(1).default(5).volatile(),
    }).collapse().description('断线重连策略'),
  }).collapse().description('omd-state MCP 挂载'),
  codeIntel: z.object({
    astGrep: z.boolean().default(true).volatile(),
    lspServers: z.dict(z.object({
      command: z.string().volatile(),
      args: z.array(z.string()).default([]).volatile(),
      languages: z.array(z.string()).default([]).volatile(),
      env: z.dict(z.string()).default({}).volatile()
        .description('透传给语言服务器子进程的环境变量（勿填长期密钥）'),
      initializeTimeoutMs: z.natural().min(1).default(10_000).volatile()
        .description('单 server initialize 握手超时毫秒'),
    })).default({}).volatile().description('LSP 注册表（server 本体由用户环境提供）'),
    lsp: z.object({
      requestTimeoutMs: z.natural().min(1).default(15_000).volatile(),
      shutdownTimeoutMs: z.natural().min(1).default(5_000).volatile(),
      maxRestarts: z.natural().default(2).volatile()
        .description('崩溃重启预算（仅显式 lsp_stop 复位）'),
    }).collapse().description('LSP 超时与重启'),
    search: z.object({
      maxResults: z.natural().min(1).default(50).volatile()
        .description('默认结果上限（调用级 maxResults 可覆盖）'),
      hardMaxResults: z.natural().min(1).default(500).volatile(),
      maxFiles: z.natural().min(1).default(2000).volatile()
        .description('收集文件上限（超限 truncated:true 显式告知）'),
      skipDirs: z.array(z.string()).default(
        ['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'],
      ).volatile().description('收集时跳过的目录名'),
    }).collapse().description('ast-grep 检索界限'),
  }).collapse().description('代码智能 MCP'),
  memory: z.object({
    workingTtlDays: z.natural().min(1).default(7).volatile()
      .description('工作记忆保留天数（priority 永久 / manual 手动，不受影响）'),
  }).collapse().description('记忆留存'),
})
```

**待 t4 实证的三处 schemastery 语义**（不阻塞设计，有回退）：

1. `.hidden()` 是否让 dsh-settings 投影跳过该键（回退：可见 + deprecated badge）。
2. `z.const('stdio').disabled()` 的只读渲染形态（回退：`union([const('stdio')])` 单选项下拉）。
3. 双语 description 的 Dict 形态（`Meta.description: string | Dict<string>`，t1 §1）——若键为 locale，t4 把 §2–§10 的中英说明填入 `{ zh, en }`；否则保持中文单串（与仓库现状一致），英文说明进 README/documents。

---

## 13. GUI 渲染映射（类型 → 控件）

| schema 形态 | GUI 控件 | 本设计实例 |
|---|---|---|
| `union(const)` 枚举 | 下拉 choices | C1/C3/C9/C23 |
| `string` | 文本输入 | C2/C5–C7/C24/C12，`pattern` 进校验 |
| `natural`/`number` | 数字输入（`min/max/step` 进控件；C16 可渲染滑杆） | C4/C10–C11/C13–C22/C27–C29/C32–C39（除列表外） |
| `boolean` | 开关 | C25/C26/C30 |
| `dict(string)` | 键值表（可增删行） | C8、lsp 条目 `env` |
| `dict(object)` | 条目表 + 行内展开对象表单 | C31 |
| `array(string)` | 字符串列表编辑器 | C37 的反例是 C38；lsp 条目 `args`/`languages` |
| 嵌套 `object` | 折叠分组（`.collapse()`） | `hud/tiers/routing/delegate/autopilot/deepInterview/team/mcp(+reconnect)/codeIntel(+lsp+search)/memory` |
| `.disabled()` | 禁用态（展示生效值） | C23 |
| `.experimental()` | “高级/实验”角标 | C12（`delegate` 组） |
| `.deprecated()` | 弃用角标 + 迁移提示 | 顶层 `hudPreset` 别名（+ `.hidden()` 期望不展示） |

字段顺序 = schema key 声明序 = 本设计 C1→C39 文档序（GUI 按声明序渲染，组内同理）。

---

## 14. 全量键速查（附录 A）

| ID | 键 | 默认值 | 状态 | 读面 |
|---|---|---|---|---|
| C1 | `language` | `zh` | 存量 | 插件 |
| C2 | `stateDir` | `.omd` | 存量 | 插件 + `OMD_STATE_DIR` |
| C3 | `hud.preset` | `focused` | 新增 P0 | 插件（hud-route） |
| C4 | `hud.refreshMs` | `5000` | 新增 P2 | 插件 → hud.json → client |
| C5–C7 | `tiers.{low,medium,high}` | `glm-5.3-flash` | 存量 | 插件 |
| C8 | `roleOverrides` | `{}` | 存量 | 插件 |
| C9 | `routing.defaultTier` | `medium` | 存量 | 插件 |
| C10 | `routing.lowMax` | `2` | 新增 P1 | 插件（需线程化） |
| C11 | `routing.mediumMax` | `5` | 新增 P1 | 插件（需线程化） |
| C12 | `delegate.provider` | `spawn` | 新增 P2（高级） | 插件 |
| C13 | `autopilot.maxIterations` | `10` | 存量 | 插件（协议渲染） |
| C14 | `autopilot.maxQaCycles` | `5` | 存量 | 插件（协议渲染） |
| C15 | `autopilot.maxValidationRounds` | `3` | 存量 | 插件（协议渲染） |
| C16 | `deepInterview.ambiguityThreshold` | `0.2` | 存量 + 补校验 P0 | 插件（协议渲染） |
| C17 | `deepInterview.maxRounds` | `20` | 存量 | 插件（协议渲染） |
| C18 | `deepInterview.softWarningRounds` | `10` | 存量 | 插件（协议渲染） |
| C19 | `team.heartbeatIntervalMs` | `60000` | 存量 | 插件 |
| C20 | `team.staleAfterMs` | `300000` | 存量 | 插件（+ MCP 默认同值） |
| C21 | `team.maxFixLoops` | `3` | 新增 P1 | MCP（新 `OMD_TEAM`） |
| C22 | `team.casRetries` | `3` | 新增 P2 | MCP（新 `OMD_TEAM`） |
| C23 | `mcp.transport` | `stdio` | 新增 P1（只读） | 插件（ctx.plugin） |
| C24 | `mcp.serverName` | `omd-state` | 新增 P1 | 插件（ctx.plugin） |
| C25 | `mcp.failOnStartupError` | `false` | 新增 P1 | 插件（ctx.plugin） |
| C26–C29 | `mcp.reconnect.{enabled,initialDelayMs,maxDelayMs,maxAttempts}` | `true/1000/30000/5` | 新增 P1 | 插件（ctx.plugin） |
| C30 | `codeIntel.astGrep` | `true` | 存量 | 插件 + MCP |
| C31 | `codeIntel.lspServers`（+条目 `initializeTimeoutMs=10000`） | `{}` | 存量 + P0 子键 | MCP（`OMD_CODE_INTEL`） |
| C32 | `codeIntel.lsp.requestTimeoutMs` | `15000` | 新增 P1 | MCP（`OMD_CODE_INTEL`） |
| C33 | `codeIntel.lsp.shutdownTimeoutMs` | `5000` | 新增 P2 | MCP（`OMD_CODE_INTEL`） |
| C34 | `codeIntel.lsp.maxRestarts` | `2` | 新增 P2 | MCP（`OMD_CODE_INTEL`） |
| C35 | `codeIntel.search.maxResults` | `50` | 新增 P1 | MCP（`OMD_CODE_INTEL`） |
| C36 | `codeIntel.search.hardMaxResults` | `500` | 新增 P2 | MCP（`OMD_CODE_INTEL`） |
| C37 | `codeIntel.search.maxFiles` | `2000` | 新增 P2 | MCP（`OMD_CODE_INTEL`） |
| C38 | `codeIntel.search.skipDirs` | 8 项（§9.3） | 新增 P2 | MCP（`OMD_CODE_INTEL`） |
| C39 | `memory.workingTtlDays` | `7` | 新增 P2 | MCP（新 `OMD_MEMORY`） |
| — | `hudPreset`（顶层兼容别名） | —（optional） | 隐藏 deprecated | 插件（回退读） |

---

## 15. 不暴露清单与理由（附录 B：t4 勿加）

| 常量 | 位置 | 不暴露理由 |
|---|---|---|
| `HUD_ROUTE_PATH`、client `TAB_ID/TAB_KIND/TIER_*` | `lib/hud-route.js:15`、`lib/client.js` | 面板接线契约，改之即失联 |
| `SIGNAL_FEATURES` 四特征枚举 | `lib/routing.js:16-21` | 路由评分语义本身，非可调参数 |
| `TIER_ORDER` | `lib/routing.js:13` | 档位全序契约 |
| `team_dispose reason` 默认 `'verified'` | `team.mjs:35` → `worktree.js:148` | 单次调用语义，无全局政策意义 |
| `TERMINAL_STATES/TRANSITIONS/SAFE_ID/WORKER_STATUSES/MAIL_*` | `lib/team.js` | 状态机/协议契约 |
| `DEFAULT_STALE_AFTER_MS`（lib 常量） | `lib/team.js:328` | 与 C20 同值，保留作 MCP 直调回退，不另立键 |
| M1 `retryBackoff`、`readLatest` 注入点 | `lib/runstate.js:84` | 测试/竞态构造面，非用户语义 |
| `MAX_DETAIL` 4KB、`PROTOCOL_SECTION_ORDER` 等 | `lib/probe.js:6`、`lib/index.js:33-34` | 内部有界/排序常量 |
| skill 内停机口径（同错误 3 次停） | assets skills | skill 文本政策，非 Config 语义 |
| `command/args`（MCP 子进程） | `lib/index.js:112-113` | 包内绝对路径构造，无用户可调性 |
| 关键词注册表 | `lib/keywords.js` | 资产语义，非配置 |

---

## 16. t4 实施拆分建议 + 验收

### 拆分（按依赖排序）

1. **t4-1 schema**：`lib/config.js` 按 §12 草案补键 + 全叶 `.volatile()` + C16 校验 + C31 子键 + 隐藏别名；`tests/lib/config.test.js` 补解析/默认/回退单测。
2. **t4-2 插件进程接线**：`hud-route.js`（C3/C4 下发）、`routing.js` + `delegate.js`（C9 兜底统一、C10/C11 线程化、C12）、`index.js`（C23–C29 ctx.plugin 读配置 + 新增 `OMD_TEAM`/`OMD_MEMORY` env 组装）、`heartbeat.js`（只补 volatile，无逻辑改）。
3. **t4-3 MCP 进程接线**：`mcp-server/index.mjs`（解析 `OMD_TEAM`/`OMD_MEMORY` 并入 env）、`team.mjs`（C21/C22）、`codeintel.mjs`（C32–C38 回退读）、`notepad.mjs`（C39 天→毫秒）；`tests/mcp-server/*` 同步。
4. **t4-4 client**：`lib/client.js` 读下发 `refreshMs`（C4）+ `tests/lib/client-bundle.test.js` 沙箱断言；`hud-route.test.js` 补 preset/refreshMs 下发断言。
5. **t4-5 文档**：README 配置章节指向本设计；§12 待实证三项结论回填。

### 验收标准

- [ ] `Config.parse({})` 全默认与现状行为一致（39 叶逐项断言；老 profile 无新增必填导致解析失败——除 `lspServers[].command` 本就必填外，新增键一律有 default/optional）。
- [ ] 老 profile 手写顶层 `hudPreset` 仍解析且等价于 `hud.preset`。
- [ ] GUI 实测：Settings → Plugins → oh-my-dsh 可见 9 组；枚举下拉/开关/数字/键值表/列表五类控件渲染正常；改值 → HMR 重放 → 行生效（至少抽验 C3、C9、C19、C25、C30）。
- [ ] `npm test`（vitest 全量）通过；新增/改动单测覆盖每个新消费分支。
- [ ] 本设计 §12 三项待实证结论已回填（hidden/disabled/双语形态）。

---

## 17. 参考路径索引（附录 C）

- schema 现状：`lib/config.js:4-48`；消费：`lib/protocol.js:56-99`、`lib/index.js:59,107-118`、`lib/delegate.js`、`lib/heartbeat.js`、`lib/hud-route.js`
- 路由/团队/runstate：`lib/routing.js`、`lib/team.js`、`lib/runstate.js`、`lib/worktree.js`
- MCP：`mcp-server/index.mjs`、`mcp-server/tools/{team,codeintel,notepad}.mjs`
- client：`lib/client.js`、`tests/lib/client-bundle.test.js`
- 机制（第一方）：`dsh-settings/README.md`、schemastery `lib/types/index.d.ts`、`dsh-package-manifest/lib/types/types.d.ts`（见 t1）

---

## 18. 实施勘误（post-t5，单人直修记录）

### 18.1 本设计 §1 的 GUI 落点假设被证伪

本设计假设"宿主按 schema 自动投影表单"（§1 非目标："不做 client 自动建页"）。
宿主源码实证（dsh 0.2.0-rc.2 `node_modules/@deepseek-ai/dsh-settings/README.md:39`）：
`autoGenerate` 只是各表单上报的 bool 值，**没有任何 shipped client 消费它**——
光有 schema，Plugins 页永远不会出现 GUI（用户导入后"没有配置的 GUI"即此因）。

修正：插件自带 browser half——`lib/client.js` 在 `plugins.row.config` 座注册
`ConfigPage`（key=`@sakura12/oh-my-deepseekharness#oh-my-dsh`），owner 以
`{view, form}` 契约下发快照/提交能力；41 叶手写暂存表单（嵌套路径，
`SettingsFormModel` 只支持扁平 section 故不用），空草稿=unset，seed revision
做 fence。GUI 入口：Plugins → oh-my-dsh 行 → Configure。

### 18.2 叶数 39 → 41（t5 遗留 F1/F2 落地）

- F1 `codeIntel.search.skipDirs`（字符串数组，默认 8 项）：提升
  `codeintel.mjs` 原 `SKIP_DIRS` 硬编码；`collectFiles` 新增第 5 参，
  空数组=显式一个不跳（合法值）。
- F2 `codeIntel.lsp.shutdownTimeoutMs`（natural ≥1，默认 5000）：提升原
  `SHUTDOWN_TIMEOUT_MS`；`lspStop` 改读 `limits.shutdownTimeoutMs`。
- 两叶经 `OMD_CODE_INTEL` 整组 JSON 自动透传（`lib/index.js` 全量序列化，
  零 plumbing）；非法值按 `resolveCodeIntelLimits` 既有策略回退默认。
- 同批：F3 `resolveRefreshMs` 导出单测（⑮）、F4 protocol 渲染分支单测
  （bandsLine 矛盾分支 + 四项界限插值双断言）、client-bundle ⑯–⑳
  （FIELDS 自检 + ConfigPage 渲染/暂存/阻塞保存）。
