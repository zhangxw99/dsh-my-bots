# dsh-bots MVP 实施计划（Phase 1 / Milestone 1）

目标：交付设计稿 M1 十项能力，验收七条全部可演示。实现顺序遵循设计稿 §18 Development Process。

## 1. 骨架（第 1 步）

- `package.json`：`name: "dsh-bots"`，`dsh.bundle.patch: "./cordis.patch.yml"`，`dsh.client: { inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"], platform: "web" }`；peerDeps `@deepseek-ai/dsh-*` 锁 `0.2.2-rc.3`（optional）；tsdown 构建，产物入库。
- `cordis.patch.yml`：仅 `insert` 本插件行（config: `stateDir`、`taskPolicy` 默认值）；**不** re-enable 任何工具行。
- `src/index.ts`：`export const inject = ['agents','agentPresets','webServer','sessionQuery','storageDomain']`；`apply(ctx, config)` 装配各域并 `ctx.effect` 清理。

## 2. 交付顺序

| 步 | 内容 | 验证 |
|---|---|---|
| 1 | `storage/domain-spec.ts` + `core/types.ts`（§03 全部表，M1 只写 bots/sessions/global） | 单测：open/roundtrip/迁移 |
| 2 | `preset/preset-adapter.ts`：list/resolve/readDocument 三方法薄封装 + 可用性探测 | 单测 + 宿主实测 roster |
| 3 | `core/bot-manager.ts`：CRUD + preset 绑定校验 + unavailable 状态 | 单测 |
| 4 | `session/session-handle.ts`：borrow→create/resume→竞态回退；`session-manager.ts`：统一创建（`meta.agentPreset` + `agentOptions`）+ binding 落库 | 集成测试：创建→followup→whenIdle→重启用 resume 续聊 |
| 5 | `api/bots.ts`：REST（bots CRUD、`/chat`、`/sessions`） | curl 冒烟 |
| 6 | `preset/preset-forker.ts`：readDocument→编辑→生成 bundle→install_bundle→回退 | 集成：fork 后 roster 出现新 id，新会话运行新 preset |
| 7 | client 最小 UI：Bots 列表/创建（选 preset，Reference|Fork）/聊天（经 `/chat`，流式用 follow） | 手工 UX 走查 |
| 8 | 重启恢复：binding 持久、preset 失效降级 | restart 测试（仿 grokbot） |

## 3. M1 验收映射（设计稿 §17 M1 七条）

1. 创建 Researcher Bot → BotManager.create。
2. 选择已有 preset → PresetAdapter.list（宿主 roster）。
3. 复制并修改 preset → PresetForker + install_bundle（⚠️ 途径已修正，非目录复制）。
4. 多 Bot 不同 preset → 多行 binding。
5. 独立 Session → 每 Bot 独立 sessionId + `meta.agentPreset`。
6. 改 Bot preset 不影响旧会话 → 旧 binding 不变；宿主 resume 无 preset 参数，`agent-preset/locked` 兜底；UI 用 session 投影展示旧 preset 名。
7. 重启后映射仍在 → domain 持久化 + resume 实测。

## 4. 工程要求（设计稿 §18 逐条落实）

- 每步交付：编译通过 + `tsc --noEmit` + 单测 +（涉及宿主时）集成测试 + 本文件勾更。
- API 假设记录：所有对 `ctx.agents`/`agentPresets` 内部面的调用集中在 `session/`、`preset/` 两个适配文件，文件头维护"已核实签名 vs 假设"清单；启动探针失败→能力降级并在 UI 明示。
- 版本锁 + 探针测试：`tests/host-probe.test.ts`（仿 grokbot original-function-probe），CI 外也在插件启动时执行。

## 5. M2–M4 排期要点

- M2 起启用 Inbox/Delivery/Groups 域与 `@mention` 路由；消息幂等键上线（`${messageId}:${botId}`）。
- M3 TaskManager + 团队工具（`team_send_task` 等，`setup()` 注入）；端到端剧本测试（Chief→Researcher→Developer→Reviewer）。
- M4 Memory 分层 + Routine 接 `ctx.schedule`（delivery 建任务会话）+ `webhookRuntime` 外部入口。

## 6. 已识别风险（引用 01 报告 §6）

宿主内部 API 耦合（高，探针+锁版本）；Fork 依赖安装链路（中，回退 Reference）；会话双开竞态（中，SessionHandle 三段式）；HMR/重启语义（中，持久状态优先）；Inspect input 序列化（低）；`agent-preset/locked` UX（低，转新建会话提示）。
