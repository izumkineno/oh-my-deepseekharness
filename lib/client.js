/**
 * omd HUD client half —— dsh web 客户端插件（v0.4 P2-D；ralplan-hud-clarity 呈现层重写）。
 *
 * 形态：dsh client-modules 懒加载 CJS bundle（window.__ModuleLoader__.load 注册工厂，
 * 工厂执行只注册、不运行副作用；首次物化时才执行本体）。**手工维护，无构建步骤**——
 * 保持与工厂格式逐字对齐（参照第一方包 lib/client.js 产物形态）；改动时同步
 * tests/lib/client-bundle.test.js 的沙箱断言。
 *
 * 行为：
 * 1. 注册右侧边栏 tab 类型（ctx.sidebarRightTabs.register，page 类型无 patterns，
 *    guide 胶囊进引导页，id='omd-hud-panel' / kind='omd-hud'）
 * 2. 注册 tab 体组件（seat 'sidebar.right.pane.tab'，key=定义 id；会话作用域座，
 *    组件不消费 per-tab props——HUD 是项目级摘要）
 * 3. 面板轮询 node 数据面 GET /oh-my-dsh/hud.json（lib/hud-route.js；loopback 同源），
 *    只渲染数据面下发内容：preset 三档（minimal/focused/full，缺省 focused）、
 *    modeCatalog 模式目录（单源自 lib 常量，本文件不内置任何目录文案）、
 *    detail（主模式卡 + 次要模式，中文标签：模式/阶段/轮次/任务/记忆）；
 *    tier 色档（ok/warn/danger，CSS 变量三档 + 文字标记；判定输入=detail，
 *    payload 带 detail.tier 时优先采用，缺省走 AC10 三条件的 client 侧受锁副本——
 *    本 bundle 无法 import lib ESM，同 stale 文案的 A1 处置，见 lib/hud.js buildHudView）；
 *    minimal 预设与 detail 缺席回退呈现 <pre> 卡文本（与 MCP 卡同源的至多 8 行中文卡）；
 *    刷新间隔=数据面下发 refreshMs（Config hud.refreshMs，缺省 5s），卸载停止
 *
 * 4. 注册行配置页（seat 'plugins.row.config'，key=包名#行 id）：omd 行的 Configure
 *    入口，渲染 41 叶暂存表单（first-party 同款语义：staged/Only-save/离页丢弃/
 *    overridden 徽标/Reset=unset/invalid 阻塞保存/revision-fenced mutate；owner 经
 *    props.form 下发 {state, mutate}）。宿主无 schema 自动建页（dsh-settings
 *    README 实证：no shipped client does so）——不注册此槽位，Plugins 页永无配置 GUI。
 *
 * 5. 注册包配置页（seat 'plugins.bundle.config'，key=包名）：包页直接渲染与行
 *    配置页同源的 41 叶暂存表单（owner 不下发 form——组件经 configForms.get 自取，
 *    语义与保存路径和行页完全一致）。configForms 经 tryGet 可选接入（probe.js
 *    同款；缺席仅跳过包页，HUD 与行页不受影响）。
 *
 * 依赖面（inject）：slots（槽位系统）、sidebarRightTabs（tab 类型注册表）——
 * 二者均为 web 组合出厂服务；缺失时 apply 告警直通（console.warn），不炸页面。
 * configForms 为可选服务（tryGet 接入，不进 inject：缺席仅跳过包配置页）。
 * 表单控件（SettingsForm/SettingsValueField/Switch）经 require 取自平台基线
 * @deepseek-ai/dsh-client-ui-primitives（第一方同款裸包名 require，无需 dsh.client 声明）。
 */
window.__ModuleLoader__.load({
  id: '@sakura12/oh-my-deepseekharness',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    var SettingsForm = primitives.SettingsForm;
    var SettingsValueField = primitives.SettingsValueField;
    var Switch = primitives.Switch;
    var e = React.createElement;

    var HUD_ROUTE = '/oh-my-dsh/hud.json';
    var DEFAULT_REFRESH_MS = 5000;
    var MAX_REFRESH_MS = 3600000;
    var TAB_ID = 'omd-hud-panel';
    var TAB_KIND = 'omd-hud';
    var PRESETS = ['minimal', 'focused', 'full'];
    var DEFAULT_PRESET = 'focused';
    var TIER_TEXT = { ok: '状态正常', warn: '警告', danger: '危险' };
    var TIER_COLOR = {
      ok: 'var(--dsh-success, #2a7)',
      warn: 'var(--dsh-warn, #d90)',
      danger: 'var(--dsh-error, #d33)',
    };

    /** 刷新间隔（数据面下发 snap.refreshMs；缺席/非法回退默认；上限 1h 防配置写死面板）。 */
    function resolveRefreshMs(snap) {
      var v = snap && snap.refreshMs;
      if (typeof v !== 'number' || !isFinite(v) || v < 1000) return DEFAULT_REFRESH_MS;
      return Math.min(v, MAX_REFRESH_MS);
    }

    function useHudSnapshot() {
      var s1 = React.useState(null), snap = s1[0], setSnap = s1[1];
      var s2 = React.useState(null), err = s2[0], setErr = s2[1];
      var refreshRef = React.useRef(DEFAULT_REFRESH_MS);
      React.useEffect(function () {
        var stopped = false;
        var timer = 0;
        function schedule() {
          if (stopped) return;
          timer = setTimeout(tick, refreshRef.current);
        }
        function done(data, ex) {
          if (stopped) return;
          if (ex) setErr(String((ex && ex.message) || ex));
          else if (data && data.ok) { setSnap(data); setErr(null); refreshRef.current = resolveRefreshMs(data); }
          else setErr((data && data.error) || 'HUD 数据面返回异常');
          schedule();
        }
        function tick() {
          fetch(HUD_ROUTE + '?_=' + Date.now(), { headers: { accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) { done(data, null); }, function (ex) { done(null, ex); });
        }
        tick();
        return function () { stopped = true; clearTimeout(timer); };
      }, []);
      return { snap: snap, err: err };
    }

    function count(v) { return String(v == null ? 0 : v); }

    /** tier 判定（AC10 三条件；payload 的 detail.tier 为 lib 单源下发时直接采用）。 */
    function resolveTier(detail) {
      if (detail && TIER_TEXT[detail.tier]) return detail.tier;
      var modes = (detail && detail.modes) || [];
      var i, m;
      for (i = 0; i < modes.length; i++) {
        if (modes[i] && modes[i].state === 'failed') return 'danger';
      }
      if (modes[0] && modes[0].stale === true) return 'warn';
      for (i = 0; i < modes.length; i++) {
        m = modes[i];
        if (m && m.current_phase === 'fix') {
          var loops = m.fixLoops != null ? m.fixLoops : m.fix_loops;
          if (Number(loops || 0) >= 2) return 'warn';
        }
      }
      return 'ok';
    }

    function tierBadge(tier) {
      return e('div', { key: 'tier', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 8 } },
        e('span', { 'data-tier': tier, style: { width: 8, height: 8, borderRadius: 8, background: TIER_COLOR[tier], display: 'inline-block' } }),
        e('span', { style: tier === 'ok' ? undefined : { color: TIER_COLOR[tier] } }, TIER_TEXT[tier]));
    }

    function row(label, value) {
      return e('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
        e('span', { style: { opacity: 0.65 } }, label),
        e('span', { style: { fontFamily: 'monospace' } }, String(value)));
    }

    function section(text, key) {
      return e('div', { key: key, style: { fontSize: 11, opacity: 0.6, margin: '12px 0 4px', letterSpacing: 1 } }, text);
    }

    /** <pre> 卡文本（minimal 预设与 detail 缺席回退的正式形态，与 MCP 卡同源）。 */
    function preCard(text) {
      return e('pre', {
        key: 'card',
        style: {
          margin: 0, padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: 'var(--dsh-surface-muted, rgba(127,127,127,0.08))',
          border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
          whiteSpace: 'pre-wrap', fontFamily: 'monospace',
        },
      }, String(text != null ? text : ''));
    }

    function modeBrief(m) { return (m.label != null ? m.label : m.mode) + '（' + m.mode + '）'; }
    function modeNames(arr) { var out = []; for (var i = 0; i < arr.length; i++) out.push(modeBrief(arr[i])); return out; }

    /** 单个模式的语义卡：模式/阶段/轮次/任务 + stale 行（「未更新」为受锁文案）。 */
    function modeCard(m, key) {
      var mm = m || {};
      var kids = [
        row('模式', mm.label != null ? mm.label + '（' + mm.mode + '）' : String(mm.mode != null ? mm.mode : '-')),
        row('阶段', mm.current_phase != null ? String(mm.current_phase) : '-'),
        row('轮次', mm.iteration != null ? String(mm.iteration) : '-'),
        row('任务', Array.isArray(mm.active_agents) ? mm.active_agents.length + ' 个 agent' : '0'),
      ];
      if (mm.stale === true) {
        kids.push(e('div', { key: 'stale', style: { fontSize: 12, marginTop: 4, color: TIER_COLOR.warn } },
          '状态已超过 2 小时未更新（上次更新：' + (mm.updatedAt != null ? mm.updatedAt : '-') + '）'));
      }
      return e('div', {
        key: key,
        style: {
          border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))', borderRadius: 8,
          padding: 10, display: 'grid', gap: 4, fontSize: 12,
        },
      }, kids);
    }

    /** 记忆行（focused/空态）：中文标签 + 三区含义，非裸 working= 计数。 */
    function memoryBrief(todo) {
      return '记忆：工作区 ' + count(todo.working) + ' 条 / 优先区 ' + count(todo.priority) + ' 条 / 手动区 ' + count(todo.manual) +
        ' 条（7 天过期 / 永久 / 手动维护）';
    }

    /** idle 空态引导：渲染下发 modeCatalog（模式名 + 中文名同现），不内置目录。 */
    function catalogView(snap) {
      var kids = [];
      kids.push(e('div', { key: 'idle', style: { marginBottom: 8 } }, '当前没有运行中的 omd 模式。'));
      var cat = Array.isArray(snap.modeCatalog) ? snap.modeCatalog : [];
      for (var i = 0; i < cat.length; i++) {
        kids.push(e('div', { key: 'c' + i, style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0' } },
          e('span', null, String(cat[i].label != null ? cat[i].label : cat[i].mode)),
          e('span', { style: { fontFamily: 'monospace', opacity: 0.75 } }, String(cat[i].mode))));
      }
      kids.push(e('div', { key: 'hint', style: { fontSize: 12, opacity: 0.65, marginTop: 8 } },
        '启动方式：在会话中说出模式关键词并给出目标（CLI 会话可经 MCP hud_render 拿同款摘要）。'));
      return e('div', { key: 'catalog', style: { border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))', borderRadius: 8, padding: 10 } }, kids);
    }

    function isIdle(snap) {
      var s = snap.summary || {};
      if (s.mode === 'idle') return true;
      var d = snap.detail;
      return !!(d && Array.isArray(d.modes) && d.modes.length === 0);
    }

    function panel(children, tier) {
      var props = { style: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box' } };
      if (tier) props['data-tier'] = tier;
      return e('div', props, children);
    }

    /** HUD 面板体（sidebar.right.pane.tab 座组件；不消费 per-tab props——项目级摘要）。 */
    function HudPanel() {
      var st = useHudSnapshot();
      var children = [];
      children.push(e('div', { key: 't', style: { fontWeight: 600, marginBottom: 8 } }, 'omd 编排状态'));
      if (st.err) {
        children.push(e('div', { key: 'e', style: { color: 'var(--dsh-error, #d33)', fontSize: 12 } },
          '数据面不可用：' + st.err + '（确认 dsh web 宿主已加载 omd 插件；或经 MCP hud_render 获取同款摘要）'));
        return panel(children, null);
      }
      if (!st.snap) {
        children.push(e('div', { key: 'l', style: { opacity: 0.6 } }, '加载中…'));
        return panel(children, null);
      }
      var snap = st.snap;
      var preset = PRESETS.indexOf(snap.preset) >= 0 ? snap.preset : DEFAULT_PRESET;
      var detail = snap.detail;
      var todo = (snap.summary && snap.summary.todo) || {};
      var tier = resolveTier(detail);
      children.push(tierBadge(tier));
      if (preset === 'minimal' || !detail) {
        // minimal 预设（正式 <pre> 卡文本档）；detail 缺席回退同款（AC11）
        children.push(preCard(snap.card));
      } else if (isIdle(snap)) {
        children.push(catalogView(snap));
        children.push(e('div', { key: 'mem', style: { fontSize: 12, marginTop: 10, opacity: 0.85 } }, memoryBrief(todo)));
      } else {
        var modes = detail.modes || [];
        children.push(section('主模式', 'sec-p'));
        children.push(modeCard(modes[0], 'p'));
        var minors = modes.slice(1);
        if (minors.length && preset === 'full') {
          children.push(section('其他模式', 'sec-minor'));
          for (var i = 0; i < minors.length; i++) children.push(modeCard(minors[i], 'm' + i));
        } else if (minors.length) {
          children.push(e('div', { key: 'more', style: { fontSize: 12, opacity: 0.65, marginTop: 6 } },
            '另有 ' + minors.length + ' 个模式：' + modeNames(minors).join('、')));
        }
        if (preset === 'full') {
          children.push(section('记忆（notepad 三区）', 'sec-mem'));
          children.push(row('工作区（working）', count(todo.working) + ' 条（7 天过期自动清理）'));
          children.push(row('优先区（priority）', count(todo.priority) + ' 条（永久保留）'));
          children.push(row('手动区（manual）', count(todo.manual) + ' 条（手动维护）'));
          children.push(section('数据面', 'sec-meta'));
          children.push(row('cwd', snap.cwd || '-'));
          children.push(row('最近取数', snap.at || '-'));
        } else {
          children.push(e('div', { key: 'mem', style: { fontSize: 12, marginTop: 10, opacity: 0.85 } }, memoryBrief(todo)));
          children.push(e('div', { key: 'fetch', style: { fontSize: 11, opacity: 0.5, marginTop: 8 } },
            '最近取数 ' + (snap.at || '-') + ' · cwd ' + (snap.cwd || '-')));  // U3/O1：focused 档补取数时间上下文（stale 可信度）
        }
      }
      return panel(children, tier);
    }

    // ------------------------------------------------------------------
    // 行配置页（plugins.row.config）：41 叶暂存表单。
    // 字段表与 lib/config.js 的 volatile 叶 1:1（组顺序=渲染顺序）：
    // kind=text 文本 / int 整数 / float 浮点 / enum 下拉 / bool 开关 / json JSON 文本。
    // 空草稿=unset（重置语义）；min/max 只复述 schema 校验（宿主做全量校验的最终权威）。
    // ------------------------------------------------------------------
    var CONFIG_ROW_KEY = '@sakura12/oh-my-deepseekharness#oh-my-dsh';
    var CONFIG_BUNDLE_KEY = '@sakura12/oh-my-deepseekharness';
    var CONFIG_NS = 'oh-my-dsh'; // settings 命名空间 = loader 行 id（宿主 formFor(rowId) 实证）
    var OMD_SUMMARY = 'omd 编排参数：语言 / 模型 / 路由 / 团队 / MCP / 记忆（41 项可调）'
      + ' / omd settings: language, models, routing, team, MCP, memory (41 tunable keys)';

    var CFG = {
      save: '保存 / Save',
      saving: '保存中… / Saving…',
      saveFailed: '保存未被接受，草稿已保留（可能 revision 冲突，检查后重试）'
        + ' / Save not accepted, drafts kept (possible revision conflict)',
      readOnly: '文档只读，控件已禁用 / Read-only document, controls disabled',
      unavailable: '配置未就绪：宿主尚未服务该行 / Config unavailable: host is not serving this row yet',
      overridden: '已覆盖 / overridden',
      reset: '重置 / Reset',
      invalid: '值无效，保存已阻止 / Invalid value, save blocked',
    };

    var FIELDS = [
      { g: '基础 / Basics', p: ['language'], kind: 'enum', choices: ['zh', 'en', 'both'], label: '资产语言 / Asset language', hint: '技能与角色卡渲染语言 / Asset rendering language' },
      { g: '基础 / Basics', p: ['stateDir'], kind: 'text', label: '状态目录名 / State directory', hint: '运行时数据目录 <cwd>/<stateDir>/，建议单段目录名 / Runtime data dir; prefer a single-segment name' },
      { g: '基础 / Basics', p: ['roleOverrides'], kind: 'json', label: '角色模型覆盖 / Role overrides', hint: 'JSON 对象 { 角色卡名: 模型标识 }，优先于 tiers / JSON object; takes precedence over tiers' },
      { g: '模型与路由 / Models & routing', p: ['tiers', 'low'], kind: 'text', label: 'low 档模型 / Low-tier model', hint: '"inherit" = 继承主会话 / "inherit" inherits the main session' },
      { g: '模型与路由 / Models & routing', p: ['tiers', 'medium'], kind: 'text', label: 'medium 档模型 / Medium-tier model', hint: '"inherit" = 继承主会话 / "inherit" inherits the main session' },
      { g: '模型与路由 / Models & routing', p: ['tiers', 'high'], kind: 'text', label: 'high 档模型 / High-tier model', hint: '"inherit" = 继承主会话 / "inherit" inherits the main session' },
      { g: '模型与路由 / Models & routing', p: ['routing', 'defaultTier'], kind: 'enum', choices: ['low', 'medium', 'high'], label: '默认档 / Default tier', hint: '表外角色落此档（+ fallback 审计）/ Off-table roles fall here' },
      { g: '模型与路由 / Models & routing', p: ['routing', 'lowMax'], kind: 'int', min: 0, max: 8, label: 'low 分带上限 / Low band max', hint: '特征总分 ≤ 此值 → low；必须 ≤ medium 分带上限 / Score ≤ this → low' },
      { g: '模型与路由 / Models & routing', p: ['routing', 'mediumMax'], kind: 'int', min: 0, max: 8, label: 'medium 分带上限 / Medium band max', hint: '≤ 此值 → medium，其余 → high；必须 ≥ low 分带上限 / The rest → high' },
      { g: '模型与路由 / Models & routing', p: ['delegate', 'provider'], kind: 'enum', choices: ['spawn', 'subprocess', 'queue'], label: '派发后端 / Dispatch backend', hint: '仅 spawn 已实现；其余选中即显式报错 / Only spawn is implemented' },
      { g: 'Autopilot', p: ['autopilot', 'maxIterations'], kind: 'int', min: 1, label: '最大轮次 / Max iterations', hint: 'create_goal 的 max_goal_rounds 默认值 / Default max_goal_rounds' },
      { g: 'Autopilot', p: ['autopilot', 'maxQaCycles'], kind: 'int', min: 1, label: 'QA 循环上限 / Max QA cycles', hint: '同一目标 QA 复验轮次上限 / QA re-check round cap' },
      { g: 'Autopilot', p: ['autopilot', 'maxValidationRounds'], kind: 'int', min: 1, label: 're-validation 轮次上限 / Max re-validation rounds', hint: '交付前复验轮次上限 / Pre-delivery re-validation cap' },
      { g: '深度访谈 / Deep interview', p: ['deepInterview', 'ambiguityThreshold'], kind: 'float', min: 0, max: 1, label: '歧义度阈值 / Ambiguity threshold', hint: '0–1：超此值追问而非假设 / Ask above it instead of assuming' },
      { g: '深度访谈 / Deep interview', p: ['deepInterview', 'maxRounds'], kind: 'int', min: 1, label: '访谈硬上限 / Hard round cap', hint: '访谈轮次硬上限 / Hard cap of interview rounds' },
      { g: '深度访谈 / Deep interview', p: ['deepInterview', 'softWarningRounds'], kind: 'int', min: 1, label: '软提醒轮次 / Soft-warning round', hint: '到此轮次提醒收敛 / Nudge to converge' },
      { g: '团队协作 / Team', p: ['team', 'heartbeatIntervalMs'], kind: 'int', min: 0, label: '心跳扫描间隔 ms / Heartbeat interval (ms)', hint: '0 = 关闭定时器（按需扫描仍可用）/ 0 = timer off' },
      { g: '团队协作 / Team', p: ['team', 'staleAfterMs'], kind: 'int', min: 1, label: 'stale 阈值 ms / Stale threshold (ms)', hint: '队员无心跳超此值判 stale / Silent workers go stale beyond this' },
      { g: '团队协作 / Team', p: ['team', 'maxFixLoops'], kind: 'int', min: 0, label: 'fix 回边上限 / Max fix loops', hint: '新 run 生效，存量 run 沿用旧值 / Applies to new runs' },
      { g: '团队协作 / Team', p: ['team', 'casRetries'], kind: 'int', min: 0, label: 'CAS 重试预算 / CAS retry budget', hint: '耗尽覆盖写 + warning / Overwrite + warning when exhausted' },
      { g: 'HUD 显示 / HUD', p: ['hud', 'preset'], kind: 'enum', choices: ['minimal', 'focused', 'full'], label: '面板预设 / Panel preset', hint: 'minimal 极简卡 / focused 主模式卡 / full 全量' },
      { g: 'HUD 显示 / HUD', p: ['hud', 'refreshMs'], kind: 'int', min: 1000, label: '轮询间隔 ms / Poll interval (ms)', hint: 'GET hud.json 周期；≥1000 / Poll period for hud.json' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'transport'], kind: 'text', disabled: true, label: '传输层 / Transport', hint: '当前仅 stdio，只读展示 / stdio only, read-only' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'serverName'], kind: 'text', label: '服务名 / Server name', hint: '工具前缀 mcp__<name>__ 来源；改名属危险操作 / Tool prefix source; renaming is dangerous' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'failOnStartupError'], kind: 'bool', label: '启动失败阻断插件 / Block on startup failure', hint: 'false = 降级为文件直读兜底 / false = degrade to file fallback' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'reconnect', 'enabled'], kind: 'bool', label: '断线重连 / Reconnect', hint: 'MCP 断线自动重连开关 / Reconnect on MCP disconnect' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'reconnect', 'initialDelayMs'], kind: 'int', min: 0, label: '重连初始延迟 ms / Initial delay (ms)', hint: '首次重连前等待 / Wait before the first attempt' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'reconnect', 'maxDelayMs'], kind: 'int', min: 1, label: '重连延迟上限 ms / Max delay (ms)', hint: '指数退避封顶 / Backoff cap' },
      { g: 'MCP 挂载 / MCP', p: ['mcp', 'reconnect', 'maxAttempts'], kind: 'int', min: 0, label: '重连最大次数 / Max attempts', hint: '0 = 失败即放弃 / 0 = give up on first failure' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'astGrep'], kind: 'bool', label: 'ast_grep 开关 / ast_grep switch', hint: '@ast-grep/napi 缺席时工具显式报错 / Missing napi fails loud' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'lspServers'], kind: 'json', label: 'LSP 注册表 / LSP registry', hint: 'JSON { 名称: { command, args?, languages?, env?, initializeTimeoutMs? } }；server 二进制来自用户环境 / Binaries come from the user environment' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'lsp', 'initializeTimeoutMs'], kind: 'int', min: 1, label: 'initialize 超时 ms / Initialize timeout (ms)', hint: '注册项自带值优先 / Per-server value wins' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'lsp', 'requestTimeoutMs'], kind: 'int', min: 1, label: '请求超时 ms / Request timeout (ms)', hint: 'documentSymbol/references/definition 请求上限 / Per-request cap' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'lsp', 'shutdownTimeoutMs'], kind: 'int', min: 1, label: '停止握手超时 ms / Shutdown timeout (ms)', hint: 'lsp_stop 等 shutdown 回应上限 / Cap for the shutdown handshake' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'lsp', 'maxRestarts'], kind: 'int', min: 0, label: '崩溃重启预算 / Crash-restart budget', hint: 'lsp_stop 显式复位 / Reset by explicit lsp_stop' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'lsp', 'diagnosticsWaitMs'], kind: 'int', min: 0, label: 'diagnostics 等待 ms / Diagnostics wait (ms)', hint: '等 publishDiagnostics 默认等待 / Default wait for publishDiagnostics' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'search', 'defaultMaxResults'], kind: 'int', min: 1, label: '默认返回上限 / Default result cap', hint: '调用可覆盖，不超硬上限 / Overridable per call' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'search', 'hardMaxResults'], kind: 'int', min: 1, label: '检索硬上限 / Hard result cap', hint: '任何调用不得超过 / No call may exceed' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'search', 'maxFiles'], kind: 'int', min: 1, label: '扫描文件上限 / Max files scanned', hint: '超限截断并显式标记 / Truncation is flagged' },
      { g: '代码智能 / Code intel', p: ['codeIntel', 'search', 'skipDirs'], kind: 'json', label: '跳过目录 / Skip dirs', hint: 'JSON 数组：检索跳过的目录名 / JSON array of dir names to skip' },
      { g: '记忆 / Memory', p: ['memory', 'workingTtlDays'], kind: 'int', min: 1, label: 'working 区存活天数 / Working-zone TTL (days)', hint: '过期自动清理；priority/manual 不动 / Expired entries auto-purged' },
    ];

    function getPath(obj, path) {
      var cur = obj;
      for (var i = 0; i < path.length; i++) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[path[i]];
      }
      return cur;
    }

    function hasPath(obj, path) {
      var cur = obj;
      for (var i = 0; i < path.length; i++) {
        if (cur === null || typeof cur !== 'object' || !(path[i] in cur)) return false;
        cur = cur[path[i]];
      }
      return true;
    }

    /** 存储值 → 草稿文本（与 parseField 互逆；undefined 恒为空草稿）。 */
    function formatField(f, v) {
      if (v === undefined || v === null) return '';
      if (f.kind === 'json') {
        try { return JSON.stringify(v, null, 2); } catch (ex) { return ''; }
      }
      if (f.kind === 'bool') return v ? 'true' : 'false';
      return String(v);
    }

    /** 草稿文本 → 待写（undefined=不可接受，阻塞保存；空草稿=unset）。 */
    function parseField(f, text) {
      var t = String(text === null || text === undefined ? '' : text);
      if (t === '') return { kind: 'clear' };
      var k = f.kind, n;
      if (k === 'text') return { kind: 'set', value: t };
      if (k === 'enum') return f.choices.indexOf(t) >= 0 ? { kind: 'set', value: t } : undefined;
      if (k === 'bool') return (t === 'true' || t === 'false') ? { kind: 'set', value: t === 'true' } : undefined;
      if (k === 'int') {
        if (!/^-?\d+$/.test(t)) return undefined;
        n = Number(t);
        if (!isFinite(n) || Math.floor(n) !== n) return undefined;
        if (typeof f.min === 'number' && n < f.min) return undefined;
        if (typeof f.max === 'number' && n > f.max) return undefined;
        return { kind: 'set', value: n };
      }
      if (k === 'float') {
        if (t.trim() === '') return undefined;
        n = Number(t);
        if (!isFinite(n)) return undefined;
        if (typeof f.min === 'number' && n < f.min) return undefined;
        if (typeof f.max === 'number' && n > f.max) return undefined;
        return { kind: 'set', value: n };
      }
      if (k === 'json') {
        try { return { kind: 'set', value: JSON.parse(t) }; } catch (ex) { return undefined; }
      }
      return undefined;
    }

    function stagedEmpty(staged) {
      for (var k in staged) { if (Object.prototype.hasOwnProperty.call(staged, k)) return false; }
      return true;
    }

    /** 暂存表单 hook（SettingsFormModel 语义的手写版：嵌套路径 form-model 不支持，故自实现）。
     *  seed=上次干净态快照；干净时自动跟进 owner 下发的新 revision（保存后重定基）；
     *  脏时保留草稿，保存用 seed revision 做 fence（冲突 → failed，草稿保留）。 */
    function useConfigForm(form) {
      var seedRef = React.useRef(null);
      var latestRef = React.useRef(null);
      var s1 = React.useState({}), staged = s1[0], setStaged = s1[1];
      var s2 = React.useState(false), saving = s2[0], setSaving = s2[1];
      var s3 = React.useState(false), failed = s3[0], setFailed = s3[1];
      var state = form ? form.state : undefined;
      latestRef.current = state;
      if (state && state.status === 'ready') {
        if (!seedRef.current) seedRef.current = state;
        else if (stagedEmpty(staged) && state.revision !== seedRef.current.revision) seedRef.current = state;
      }
      var seed = seedRef.current || state;
      var seedValue = seed ? seed.value : undefined;
      var seedUser = seed ? seed.user : undefined;
      var seedBase = seed ? seed.base : undefined;
      var views = [];
      var dirty = !stagedEmpty(staged);
      var invalid = false;
      for (var i = 0; i < FIELDS.length; i++) {
        var f = FIELDS[i];
        var key = String(i);
        var st = Object.prototype.hasOwnProperty.call(staged, key) ? staged[key] : null;
        var v;
        if (st && st.type === 'clear') {
          v = { key: key, text: formatField(f, getPath(seedBase, f.p)), overridden: false, invalid: false };
        } else if (st) {
          var w = parseField(f, st.text);
          if (!w) invalid = true;
          v = { key: key, text: st.text, overridden: !!(w && w.kind === 'set'), invalid: !w };
        } else {
          v = { key: key, text: formatField(f, getPath(seedValue, f.p)), overridden: hasPath(seedUser, f.p), invalid: false };
        }
        views.push(v);
      }
      function edit(key, text) {
        var next = {};
        for (var k in staged) { if (Object.prototype.hasOwnProperty.call(staged, k)) next[k] = staged[k]; }
        next[key] = { type: 'edit', text: String(text === null || text === undefined ? '' : text) };
        setFailed(false);
        setStaged(next);
      }
      function resetOne(key) {
        var next = {};
        for (var k in staged) { if (Object.prototype.hasOwnProperty.call(staged, k)) next[k] = staged[k]; }
        next[key] = { type: 'clear' };
        setFailed(false);
        setStaged(next);
      }
      function discard() { setFailed(false); setStaged({}); }
      function save() {
        if (saving || !dirty || invalid) return;
        if (!form || typeof form.mutate !== 'function') return;
        var ops = [];
        for (var i = 0; i < FIELDS.length; i++) {
          var key = String(i);
          if (!Object.prototype.hasOwnProperty.call(staged, key)) continue;
          var st = staged[key];
          if (st.type === 'clear') { ops.push({ op: 'unset', path: FIELDS[i].p }); continue; }
          var w = parseField(FIELDS[i], st.text);
          if (!w) return; // 不可能：invalid 已阻塞保存
          if (w.kind === 'set') ops.push({ op: 'set', path: FIELDS[i].p, value: w.value });
          else ops.push({ op: 'unset', path: FIELDS[i].p });
        }
        var rev = (seed && typeof seed.revision === 'number') ? seed.revision : undefined;
        setSaving(true);
        setFailed(false);
        function done(ok) {
          setSaving(false);
          if (ok) {
            setStaged({});
            if (latestRef.current) seedRef.current = latestRef.current;
          } else setFailed(true);
        }
        try {
          var r = form.mutate(ops, rev);
          if (r && typeof r.then === 'function') r.then(done, function () { done(false); });
          else done(!!r);
        } catch (ex) { done(false); }
      }
      return {
        shell: {
          available: !!(state && state.status === 'ready'),
          writable: !!(state && state.writable),
          dirty: dirty, invalid: invalid, saving: saving, failed: failed,
        },
        views: views, edit: edit, resetOne: resetOne, discard: discard, save: save,
      };
    }

    function overriddenBadge() {
      return e('span', {
        key: 'ov',
        style: {
          fontSize: 11, fontWeight: 400, marginLeft: 8, padding: '1px 6px', borderRadius: 8,
          background: 'var(--dsh-warn, #d90)', color: '#fff', whiteSpace: 'nowrap',
        },
      }, CFG.overridden);
    }

    function resetButton(key, disabled, resetOne) {
      return e('button', {
        key: 'reset', type: 'button', disabled: disabled,
        onClick: function () { resetOne(key); },
        style: { fontSize: 12, padding: '2px 8px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer' },
      }, CFG.reset);
    }

    function hintLine(text) {
      return e('div', { key: 'hint', style: { fontSize: 12, opacity: 0.65 } }, text);
    }

    function invalidLine() {
      return e('div', { key: 'inv', style: { fontSize: 12, color: 'var(--dsh-error, #d33)' } }, CFG.invalid);
    }

    /** 文本/数字/JSON 行（SettingsValueField 第一方控件；text/disabled 由 caller 定）。 */
    function valueRow(f, st, disabled, edit, resetOne) {
      return e('div', { key: st.key, style: { marginBottom: 12 } },
        e(SettingsValueField, {
          id: 'omd-cfg-' + st.key,
          label: f.label,
          hint: f.hint,
          text: st.text,
          overridden: st.overridden,
          invalid: st.invalid,
          overriddenLabel: CFG.overridden,
          resetLabel: CFG.reset,
          invalidLabel: CFG.invalid,
          numeric: (f.kind === 'int' || f.kind === 'float') ? true : undefined,
          disabled: disabled,
          onEdit: function (text) { edit(st.key, text); },
          onReset: function () { resetOne(st.key); },
        }));
    }

    /** 枚举行（primitives 无 Select，原生 <select>；只产合法值，故 invalid 恒为渲染态）。 */
    function enumRow(f, st, disabled, edit, resetOne) {
      var opts = [];
      for (var i = 0; i < f.choices.length; i++) {
        opts.push(e('option', { key: f.choices[i], value: f.choices[i] }, f.choices[i]));
      }
      return e('div', { key: st.key, style: { display: 'grid', gap: 4, marginBottom: 12 } },
        e('div', { key: 'lab', style: { fontSize: 13, fontWeight: 600 } },
          e('span', { key: 't' }, f.label), st.overridden ? overriddenBadge() : null),
        e('select', {
          key: 'sel', id: 'omd-cfg-' + st.key, value: st.text, disabled: disabled,
          onChange: function (ev) { edit(st.key, ev.target.value); },
          style: { padding: '6px 8px', borderRadius: 6, fontSize: 13, maxWidth: 320 },
        }, opts),
        hintLine(f.hint),
        st.invalid ? invalidLine() : null,
        e('div', { key: 'row' }, resetButton(st.key, disabled, resetOne)));
    }

    /** 布尔行（Switch 第一方开关；切换只进暂存，保存才写）。 */
    function boolRow(f, st, disabled, edit, resetOne) {
      return e('div', { key: st.key, style: { display: 'grid', gap: 4, marginBottom: 12 } },
        e('div', { key: 'lab', style: { display: 'flex', alignItems: 'center', gap: 10 } },
          e(Switch, {
            checked: st.text === 'true', label: f.label, disabled: disabled,
            onChange: function (next) { edit(st.key, next ? 'true' : 'false'); },
          }),
          e('span', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, f.label),
          st.overridden ? overriddenBadge() : null),
        hintLine(f.hint),
        st.invalid ? invalidLine() : null,
        e('div', { key: 'row' }, resetButton(st.key, disabled, resetOne)));
    }

    /** 行配置页（plugins.row.config 座组件；owner 传 {view, form}）。 */
    function ConfigPage(props) {
      var p = props || {};
      var cf = useConfigForm(p.form);
      if (p.view === 'summary') return OMD_SUMMARY;
      if (!p.form) {
        return e('div', { style: { padding: 16, fontSize: 12, opacity: 0.7 } }, CFG.unavailable);
      }
      var sections = [];
      var cur = null;
      var kids = [];
      function flush() {
        if (!cur) return;
        sections.push(e('section', { key: cur, style: { marginBottom: 20 } },
          e('h3', { key: 'h', style: { fontSize: 13, margin: '0 0 10px' } }, cur), kids));
      }
      for (var i = 0; i < FIELDS.length; i++) {
        var f = FIELDS[i];
        if (f.g !== cur) { flush(); cur = f.g; kids = []; }
        var st = cf.views[i];
        var dis = !cf.shell.writable || cf.shell.saving || f.disabled === true;
        if (f.kind === 'enum') kids.push(enumRow(f, st, dis, cf.edit, cf.resetOne));
        else if (f.kind === 'bool') kids.push(boolRow(f, st, dis, cf.edit, cf.resetOne));
        else kids.push(valueRow(f, st, dis, cf.edit, cf.resetOne));
      }
      flush();
      return e(SettingsForm, {
        labels: {
          unavailable: CFG.unavailable, readOnly: CFG.readOnly, saveFailed: CFG.saveFailed,
          save: CFG.save, saving: CFG.saving,
        },
        state: cf.shell,
        onSave: cf.save,
        onDiscard: cf.discard,
      }, sections);
    }

    // ------------------------------------------------------------------
    // 包配置页（plugins.bundle.config）：包页直达的 41 叶暂存表单。
    // owner 只传 {view} 不传 form（plugin-manager PackageDetail 实证）——组件经
    // configForms.get(CONFIG_NS) 自取表单控制器（与宿主 formFor 同源同形状
    // {state, mutate}），订阅快照重渲染后复用 ConfigPage。控制器由 apply() 经
    // tryGet 填充；缺席回退 unavailable（与 ConfigPage 无 form 分支同文案）。
    // ------------------------------------------------------------------
    var STUB_SNAP = { status: 'unavailable' };
    var STUB_FORM = {
      getSnapshot: function () { return STUB_SNAP; },
      subscribe: function () { return function () {}; },
    };
    var bundleFormCtl = null; // apply() 内填充；dispose 时复位

    /** 订阅表单控制器快照（getSnapshot/subscribe/mutate 第一方控制器契约）。 */
    function useFormState(ctl) {
      var c = ctl || STUB_FORM; // hook 恒定调用：缺席走空桩，分支只影响渲染
      var s = React.useState(c.getSnapshot());
      React.useEffect(function () {
        s[1](c.getSnapshot());
        return c.subscribe(function () { s[1](c.getSnapshot()); });
      }, []);
      return s[0];
    }

    function BundleConfigPage(props) {
      var p = props || {};
      var snap = useFormState(bundleFormCtl);
      if (!bundleFormCtl) {
        return e('div', { style: { padding: 16, fontSize: 12, opacity: 0.7 } }, CFG.unavailable);
      }
      var ctl = bundleFormCtl;
      return e(ConfigPage, {
        view: p.view || 'page',
        form: {
          state: snap,
          mutate: function (ops, rev) { return ctl.mutate(ops, rev); },
        },
      });
    }

    /** 可选服务访问必须经 tryGet：cordis 里访问未 inject 的服务会抛
     *  "cannot get property ... without inject"（lib/probe.js 同款；本 bundle
     *  无法 import lib ESM，沙箱内联副本）。 */
    function tryGetService(ctx, name) {
      try { return ctx[name]; } catch (ex) { return undefined; }
    }

    function warn(msg) {
      (typeof console !== 'undefined' && console.warn || function () {})(msg);
    }

    /** client 插件本体：注册 tab 类型 + tab 体。服务缺席告警直通（不炸页面）。
     *  注册经 ctx.effect 托管（评审修复#11：第一方同款——插件重放/HMR 时 disposer
     *  先注销再重注册，裸注册会以 "already has an entry for key" 抛错致面板消失）。 */
    function apply(ctx) {
      if (!ctx || !ctx.sidebarRightTabs || !ctx.slots) {
        (typeof console !== 'undefined' && console.warn || function () {})(
          'oh-my-dsh: sidebarRightTabs/slots 服务缺席，HUD 面板未注册（非 web 组合或服务未挂载）');
        return;
      }
      function registerAll() {
        var disposeTab = ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: function () { return 'omd HUD'; },
          guide: [{
            order: 50,
            title: function () { return 'omd HUD'; },
            description: function () { return 'omd 编排状态五要素摘要卡（mode/round/story/agents/todo）'; },
          }],
        });
        var disposeBody = ctx.slots.inject('sidebar.right.pane.tab', function () {
          // keyed 会话座按 key=tab 定义 id 派发（第一方契约：sidebar-files/documentpreview 同款 key:）
          return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, priority: 50 }, HudPanel);
        });
        // 行配置页：keyed root 座按 key=包名#行 id 派发（第一方契约）；行页只在有条目
        // 点名该行时存在（plugin-manager README）。slots.inject 等座出现，无需排序 hack。
        var disposeConfig = ctx.slots.inject('plugins.row.config', function () {
          return ctx.slots.register({ name: 'plugins.row.config', key: CONFIG_ROW_KEY }, ConfigPage);
        });
        // 包配置页：keyed root 座按 key=包名派发（PackageDetail entryKey=pkg.name 实证）；
        // configForms 可选接入——缺席仅跳过包页（告警一行），HUD/行页不受影响。
        var disposeBundleConfig = null;
        var configForms = tryGetService(ctx, 'configForms');
        if (configForms && typeof configForms.get === 'function') {
          try {
            bundleFormCtl = configForms.get(CONFIG_NS);
            disposeBundleConfig = ctx.slots.inject('plugins.bundle.config', function () {
              return ctx.slots.register({ name: 'plugins.bundle.config', key: CONFIG_BUNDLE_KEY }, BundleConfigPage);
            });
          } catch (ex) {
            bundleFormCtl = null;
            warn('oh-my-dsh: 包配置页注册失败（' + ((ex && ex.message) || ex) + '），行配置页不受影响');
          }
        } else {
          warn('oh-my-dsh: configForms 服务缺席，包配置页未注册（行配置页不受影响）');
        }
        return function () {
          try { typeof disposeBundleConfig === 'function' && disposeBundleConfig(); } catch (e) { /* 注销失败不阻断重放 */ }
          bundleFormCtl = null; // HMR 重放：先复位再由 registerAll 重填（同步段内无渲染穿插）
          try { typeof disposeConfig === 'function' && disposeConfig(); } catch (e) { /* 注销失败不阻断重放 */ }
          try { typeof disposeBody === 'function' && disposeBody(); } catch (e) { /* 同上 */ }
          try { typeof disposeTab === 'function' && disposeTab(); } catch (e) { /* 同上 */ }
        };
      }
      if (typeof ctx.effect === 'function') ctx.effect(registerAll);
      else registerAll(); // 测试/降级环境：裸注册（无重放语义）
    }

    exports.apply = apply;
    exports.inject = ['slots', 'sidebarRightTabs'];
    exports.HudPanel = HudPanel;
    exports.HUD_ROUTE = HUD_ROUTE;
    exports.ConfigPage = ConfigPage;
    exports.BundleConfigPage = BundleConfigPage;
    exports.CONFIG_ROW_KEY = CONFIG_ROW_KEY;
    exports.CONFIG_BUNDLE_KEY = CONFIG_BUNDLE_KEY;
    exports.CONFIG_NS = CONFIG_NS;
    exports.FIELDS = FIELDS;
    exports.resolveRefreshMs = resolveRefreshMs; // F3：导出供沙箱单测（HUD 轮询周期解析）
    return module.exports;
  }
});
