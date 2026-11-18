# DSH API 调研报告（dsh-bots 插件 · Phase 0）

调研日期：2026-11-18 · 调研对象：本机运行的 DeepSeek Harness 安装

## 0. 环境事实

| 项 | 值 |
|---|---|
| Profile | `desktop`（`/Users/vivi/.dsh/profiles/desktop`） |
| 安装形态 | Desktop app.asar（Electron） |
| DSH 版本 | **0.2.2-rc.3**（`@deepseek-ai/dsh` 及全部相关包同版本） |
| 关键包 | `dsh-agent-preset` / `dsh-agent-preset-registry` / `dsh-agent` / `dsh-api-session-controller` / `dsh-storage-domain` / `dsh-tool-subagent` 全部 0.2.2-rc.3 |

调研方法：Cordis Inspect（Host Service 目录）+ 直接阅读安装内包源码（`dsh-agent`、`dsh-api-session-controller`、`dsh-agent-preset-registry`、`dsh-storage-domain` 的 src）。以下所有 API 签名均来自当前安装，非文档转述。

## 1. Agent Preset 体系（核实结果）

### 1.1 Preset 的真实形态 —— 与设计稿的重要偏差 ⚠️

设计稿 §2.4 假设 Preset 存放在 `~/.dsh/.agent-presets/<id>/` 目录（含 `agent.cordis.yml`/`preset.yml`/`skills/`）。**当前版本（0.2.2-rc.3）不是这样**：

- Registry README 原文："The registry **neither scans directories nor accepts preset paths**"。
- Preset 是 **profile patch 中的插件行**：一行 `name: '@deepseek-ai/dsh-agent-preset'`，config 为 `PresetDefinition`：

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard        # 未指定 preset 的会话使用的默认值
- id: preset-researcher
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: researcher           # 会话持久化保存的 preset 身份
    name: Researcher         # 展示名
    description: ...
    plugins: [ ... ]         # 子插件组合（Persona/Tools/Skills 等都是插件行）
```

- `PresetDefinition`（源码核实）：`{ id, name?, description?, order?, plugins: EntryOptions[] }`。
- 每个声明 eager 创建 registry 拥有的 scope + 内存 Loader 树；更新/删除声明会 retire 旧 revision，**已存在的 Agent 保留其创建时的组合引用**——这正是设计稿 §1.1 规则的宿主原生实现。
- 失败的定义保持可见（roster 中带 `broken` 原因），对应设计稿 §2.6 的"Preset 失效处理"。

**结论（Fork 机制修正）**：设计稿 §2.3 的 Fork 模式不能靠复制目录实现，正确路径是：

1. `readDocument(agentPreset)` 读取源 preset 的组合（渲染为 entry-list YAML，含 `!!js` 表达式）；
2. 生成一个小的 bundle patch（`insert` 一行新的 `@deepseek-ai/dsh-agent-preset`，`config.id` 为新 ID，`plugins` 为（可修改的）拷贝）；
3. 通过 `plugin_manager install_bundle` 安装进 profile（或写入用户 profile patch 层）。

插件可以进一步提供便捷封装：内置 "preset 工坊" 生成器直接产出这个 bundle 目录并调用安装。**插件绝不能自建平行 Registry**（设计稿 §2.5 禁令成立且必须遵守）。

### 1.2 `agentPresets` 服务（Host，签名核实）

| 方法 | 用途 |
|---|---|
| `list(): Promise<AgentPreset[]>` | Preset 清单（Preset Adapter.list() 的直接实现） |
| `resolve(id?): Promise<AgentPreset>` | 解析（缺省取默认）；不存在抛 `agent-preset/not-found`（附 available 列表） |
| `readDocument(agentPreset): Promise<AgentPresetDocument>` | 读组合 YAML（Fork 的数据源；`Remote('read')` 可从客户端调） |
| `inspectCompositions(ctx?)` | 组合审计信息 |
| `register(definition): Promise<disposer>` | **运行时注册**一个 PresetDefinition（进程内，不落盘；不适用于持久 Fork） |
| `presetForSession(session): string \| null` | 查会话运行的 preset（校验历史绑定） |
| `recompose(ctx, id)` / `mount(ctx, id?)` / `acquireScope(id)` | scope 与重组合管理 |
| `remoteExportList()` (`Remote('list')`) | 客户端 roster（含 broken 项） |

错误码（Typert 已声明）：`agent-preset/not-found`、`agent-preset/invalid`、**`agent-preset/locked`（会话已有内容时组合锁定，sessionId+agentPreset）** —— 设计稿 §1.1 "禁止中途切换 Preset" 由宿主强制执行，插件只需正确处理该错误。

事件：`agent-preset/selected(sessionId, agentPreset)` —— Bot 状态/绑定层可订阅。Session 投影 `SessionProjectionMap.agentPreset`：每个会话的 preset 身份可从投影读取，用于旧会话展示"运行于 researcher-v1"。

## 2. Session / Agent 创建与驱动（核实结果）

两条集成路线，都已核实：

### 路线 A：进程内 Agent Registry（推荐给 Bot 执行引擎）✅

`ctx.agents` / `ctx.agentLoop`（grokbot 同款路线，签名在 0.2.2-rc.3 仍一致）：

```ts
// 创建（dsh-agent/src/index.ts:66 核实）
ctx.agents.create({
  sessionId: mintedId,
  meta: {
    cwd: botWorkspace,        // Bot 工作区
    agentPreset: 'researcher' // ⭐ meta 原生支持 agentPreset —— Bot↔Preset 绑定的官方入口
  },
  agentOptions: { provider, model },   // Bot 的 modelOverride 落在这里
  setup(agentCtx) { /* 可选：注册 Bot 专属工具/上下文 */ },
})

// 恢复（dsh-agent/src/index.ts:127 核实；注意字段名是 resumeSessionId）
ctx.agents.resume({ resumeSessionId, agentOptions, setup })

// 驱动（dsh-agent/src/runtime-types.ts 核实）
agent.followup(userMessage(text))   // 入队一条用户消息
await agent.whenIdle()              // 等待回合结束
agent.cancel({ kind: 'user' })      // 取消
ctx.agents.get(sessionId)           // 借用已活着的管理器（避免与 UI 双开竞态）
```

要点：
- `ResumeAgentOptions` **没有** preset 字段——恢复即沿用持久化组合，架构上强制了"历史会话保持原 Preset"。
- grokbot 的 `openSessionHandle` 模式（先 `get()` 借用活 agent → 失败再 `resume` → 处理 "cannot prepare session ... while it is live" 竞态回退）应在我们的 SessionHandle 中复用。
- `setup` 是"组合而非驱动"的受信回调；Bot 的身份 prompt section、团队工具在 setup 或全局钩子里注入。

### 路线 B：SessionController Remote（给 Web UI / 外部系统）

`ctx.remote.session`（`dsh-api-session-controller`，类型源码核实）：

- `create({ workspaceId? | cwd?, sessionId?, agentPreset? }) → { sessionId, agentPreset }` —— UI 侧"打开一个 Bot 会话"可直接用；
- `prompt({ requestId, sessionId, mode: 'queue'|'steer', content, clientTimeZone })`；
- `selectModel({ sessionId, provider, model })` —— 会话级模型选择；
- `fork({ sessionId, atSeq? })`、`rename`、`cancel`、`events`/`follow`（流式观察）、`state`/`observeState`、`wait`。

**设计决策**：Bot 的无人值守执行（任务、群聊唤醒、Inbox 消化）走路线 A（进程内、可编程、可等待）；用户在 UI 里与 Bot 面对面聊天走路线 B/原生会话视图（同一个 dshSessionId，两侧通过 `agents.get` 借用机制互通）。

## 3. 其他相关服务（签名核实，按需取用）

| 服务 | 关键方法 | 对本插件的意义 |
|---|---|---|
| `sessions` | `create/prepare/get/list/fork` | 内存会话存储（一般经 agents 间接使用） |
| `sessionPersistence` | `create(header)/open(id)/list/stat` | 原生持久化；插件只存 sessionId 引用，不复制历史（符合设计稿 §4.2） |
| `sessionQuery` | `readSession/listEvents/readSurface/observeSession` | Bot 运行状态、群聊转录回读、结果提取 |
| `sessionProjections` | `snapshot(session)` | 读 `agentPreset` 投影做旧会话标注 |
| `subagents` | `startActivation/sendMessage/resolveName/listDescendants/interrupt` | 一次性有边界子任务（设计稿 §7.3 定位不变） |
| `systemPrompt` | `section/context/variable/tools` | Bot 身份注入（`order` 可控，grokbot 用 -20） |
| `approval` | `request/setPolicy` | 沿用宿主审批，不绕过（设计稿 §14.3） |
| `schedule` | `create/edit/list`（RRULE）| Milestone 4 Routine 的原生载体：delivery 会创建/恢复 Session |
| `storageDomain` | `open(spec)` | 见 §5 存储决策 |
| `webServer` | `register(route)` | REST API `/api/plugins/bots/*`；grokbot 已验证该模式 |
| `clientModules` / `dsh.client` | manifest | Web UI 插件半体（Bot Workbench 页面） |
| `workingDirectory` | `set/ensure/get` | Bot 会话工作区切换 |
| `webhookRuntime` | `register(rule)/dispatch` | M4 外部 Inbox/Webhook 入口 |

事件目录（可订阅）：`agent-preset/selected`、`session/event`、`agent/created`、`system-prompt/assemble`、`approval/request`（grokbot 验证过的注入面）。

## 4. dsh-grokbot 参考实现要点（0.6.1，宿主 0.1.0-rc.6 验证）

- 结构：`dsh.bundle.patch` + `dsh.client`（inject client-runtime/ui-slots）双半体；构建产物入库；patch 仅 re-enable 工具行 + insert 插件行。
- 执行：完全走 `ctx.agents.create/resume + followup/whenIdle/cancel`，不自建 LLM loop —— 与设计稿"非目标"一致，已验证可行。
- 持久化：stateDir（`~/.dsh/grokbot/`）自管 JSON/JSONL + 原生 session 持久化；会话映射 `chat-sessions.json`（键 `${conversationId}:${botId}`）。
- 可靠性范本："派发=排队而非运行"、消息先落盘、幂等 ID、重启后 in-flight 标记中断不自动重放、CAS 乐观锁、append-only 转录。
- 审批分层：规则匹配 → 程序化 scope 验证 → LLM 代审（限时 JSON）→ 用户卡片。
- 坑：巨石单文件（4235 行）——我们要按域早拆；依赖非公开承诺 API（`agents.create/resume`、事件名、错误文案匹配）——需锁宿主版本 + 探针测试；它没有用 Preset 体系（自拼 persona），**我们改为 Preset-based 是本插件与它的核心差异，也正是设计稿的主张**。

## 5. 存储层决策（修正设计稿 §13）

设计稿推荐 SQLite。核实结论：

- DSH 不随包分发 better-sqlite3；在 ASAR/Electron 环境打包原生依赖安装风险高。
- 宿主提供 **`@deepseek-ai/dsh-storage-domain`**：声明式 Domain（zod schema 表 + 全局槽 + 版本号 + `compatibleVersions` 迁移 + `backup-and-skip` 策略），由 `dsh-storage` 后端持久化。
- grokbot 用纯 JSON/JSONL 自管文件也稳定运行。

**决策**：结构化数据（bots/teams/sessions/messages/deliveries/tasks）用 `storageDomain.open(spec)` 声明 `dsh-bots` 域（zod schema 即 §03 数据模型，天然获得版本迁移与校验）；大文本（转录、记忆、任务结果）用 stateDir 下 append-only JSONL/Markdown 文件（`dshHomePath('bots')` → `~/.dsh/bots/`）。不引入 SQLite 原生依赖。

## 6. 兼容性风险清单

1. **宿主版本耦合**（高）：`ctx.agents.*`、`agent.followup/whenIdle`、事件名属内部 API 面，0.1→0.2 间签名虽稳定但无兼容承诺。缓解：peerDep 锁 `0.2.2-rc.x`；启动时探针（resolve 一次关键方法），失败则降级只读并明示。
2. **Preset Fork 依赖 plugin_manager 安装链路**（中）：Fork 需生成 bundle 并安装；用户拒绝安装/安装失败时 Bot 只能 Reference 原 preset。缓解：Fork 前预检，失败回退并提示。
3. **Remote input 序列化问题**（低，已在本次调研遇到）：Cordis Inspect 的 input 参数偶发拒绝，UI 侧不要过度依赖一次性大 payload 调用。
4. **会话双开竞态**（中）：插件与用户 UI 同时打开同一 Bot 会话。缓解：grokbot 的 borrow→resume→竞态回退三段式 SessionHandle。
5. **HMR/重启语义**（中）：替换已安装包需重启才加载新 JS 代；消息与任务恢复必须以持久状态为准（"派发≠运行"）。
6. **`agent-preset/locked`**：切换已有会话 preset 会被宿主拒绝——按设计稿要求，把该错误转成 UI 提示"新建会话以使用新 Preset"。
