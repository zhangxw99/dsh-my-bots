# dsh-bots Phase 1 验证报告（2026-11-18）

**最终状态：Desktop 用户确认 UI 已出现（composer 下方 "🤖 Bots" 入口），M1 端到端打通。**

验证方式：**独立测试 profile + `dsh` 命令行 headless/web 启动**（遵照用户要求，未直接触碰 Desktop profile）。
测试 profile：`~/.dsh/profiles/bots-web`（web 模板 + `@local/dsh-bots`），Desktop profile 已在误装后完全清理恢复。

## 1. 修复的缺陷（均在 headless 测试中发现，Desktop 不受影响）

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | storageDomain 域名 `dsh-bots` 违反 `UNIT_NAME_RE=/^[a-z][a-z0-9_]*$/` → **fatal load failure**（这就是上次 Desktop 启动报错的根因） | 域名改为 `dsh_bots` |
| 2 | REST 路由误用 `:id` 模式；`WebRoute` 只有 exact/prefix | 改为单 prefix 路由 + 内部分发 |
| 3 | `ctx.agents.create/resume` 返回 `AgentHandle{agent,dispose}`，直接当 Agent 用 → `followup is not a function` 且**崩溃宿主进程** | 取 `handle.agent` |
| 4 | 会话串行链 `chatSerial` 保留 rejection → 未处理拒绝使进程退出 | 链上 `catch(() => {})`，调用方仍见错误 |
| 5 | 未注入 `pluginManager` → Fork 无法自动安装 | inject 增加 `pluginManager` |
| 6 | 会话无模型时 turn 静默失败 | 接入 `agentDefaultModel.currentSelection()` 兜底；失败以 `Turn failed: <原因>` 明确返回 |
| 7 | **测试服务器与 Desktop 抢同一 storage domain**（域名为机器级单例）→ Desktop `DomainError: already open` **致命崩溃**（20:58/20:59 两次） | 测试改用隔离 DSH_HOME；插件 apply 捕获冲突降级运行（API 返回 503 + 解释），绝不 crash 宿主 |
| 8 | **client.js 顶层 `const` 声明**：脚本被 combo + 单资源 URL 执行两次时 `Identifier already declared` → SyntaxError，dock 注册失败 | 重写为 shipped 产物形状：全部声明在 factory 闭包内，可重复执行；`tests/client-reexec.mjs` 双执行验证 |

## 2. M1 验收对照（设计稿 §17 M1）

| 验收条目 | 结果 | 证据 |
|---|---|---|
| 1. 创建 Researcher Bot | ✅ | `POST /bots` 返回 bot + 派生工作区 |
| 2. 选择已有 Agent Preset | ✅ | `GET /presets` 返回宿主 roster（standard/ptc/minimal/cordis） |
| 3. 复制 Preset（Fork） | ✅（部分） | `POST /presets/copy`：读取 standard 组合 127 行 → 生成 bundle → `installBundle` 返回 "installed and applied"，新 preset 进 roster。**组合的 UI 编辑器未实现**（副本文件可直接编辑后重装） |
| 4. 多 Bot 不同 Preset | ✅ | Researcher=standard、Researcher V1=researcher-v1 |
| 5. 每 Bot 独立 DSH Session | ✅ | 各自 sessionId（`bots-<botId>-direct-…`），`meta.agentPreset` 绑定 |
| 6. 改 Bot preset 不影响旧会话 | ✅ | Bot 改绑 standard 后，旧 binding 仍为 `researcher-v1`（宿主 resume 无 preset 参数 + `agent-preset/locked` 兜底） |
| 7. 重启后 Bot/Session 映射仍在 | ✅ | 重启 3 次均恢复；chat 复用重启前同一 dshSessionId（resume 路径验证） |

额外验证：无效 preset 创建被拒（宿主错误信息透传）；Fork bundle patch 结构正确（`@deepseek-ai/dsh-agent-preset` 行 + 缩进组合）；`GET /bots/:id/events` 诊断端点可读会话事件流。

## 3. 已知限制

- **端到端模型回复未跑通**：测试环境无任何 LLM key（GLM_API_KEY 在 Desktop 进程环境；DEEPSEEK_API_KEY 未配置）。turn 失败被正确捕获并以明确错误返回，进程稳定。在 Desktop（已有可用模型）中即可完成真实对话验证。
- Fork 组合编辑器、群聊、任务派发：M2/M3 范围。
- `ctx.agents.*` 为宿主内部 API 面，已锁版本 0.2.2-rc.3（与桌面安装一致）。

## 4. 复现步骤

```sh
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
export ELECTRON_RUN_AS_NODE=1
DSH_NODE="$DSH_NODE_EXECUTABLE"
"$DSH_NODE" "$CLI" --profile bots-web --no-open   # 启动测试 profile（后台）
curl http://127.0.0.1:3080/api/plugins/bots/status
```

单元测试：`node tests/unit.mjs`（纯模块 + API 路由 + Fork 生成，全部通过）。
