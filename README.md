# dsh-my-bots

DSH 多 Bot 组织插件：将长期 Bot 身份绑定到真实 DSH Agent Preset，在原生 DSH 会话中运行，支持 Preset Fork、持久化与重启恢复。

依据 [dsh-my-bot设计稿.md](./dsh-my-bot设计稿.md) 实施，宿主版本 **DSH 0.2.2-rc.3（Desktop）**。

## 仓库结构

```
├── dsh-my-bot设计稿.md      # 产品与技术设计稿（V1.0）
├── dsh-bots/                # 插件本体（DSH bundle：host 半体 + web client 半体）
│   ├── index.js             # Host 入口（apply / inject / 装配）
│   ├── client.js            # Client 入口（左侧栏面板 + 主区域工作台）
│   ├── cordis.patch.yml     # bundle patch：insert 插件行
│   └── src/                 # 存储 / Preset Adapter / BotManager / SessionManager / Forker / REST API
├── tests/                   # 单测 + client harness + 双执行回归 + Electron 页面探针
└── docs/                    # Phase 0 API 调研 / 架构设计 / 数据模型 / 实施计划 / 验证报告
```

## 安装（Desktop）

Plugins → **Add plugin** → 指向 `dsh-bots/` 目录。重启后左侧栏出现 **DSH Bots** 面板。

## 功能（Milestone 1）

- Bot 身份 CRUD，核心绑定 `presetId`（不复制 Persona/工具配置）
- 每 Bot 独立原生 DSH Session（`meta.agentPreset` 绑定，历史会话组合锁定）
- Direct Chat（persist-first 转录 + 原生 agent 驱动）
- Preset Fork：读取组合 → 生成 bundle → 自动安装
- REST API `/api/plugins/bots/*`；storageDomain 持久化 + 重启恢复

## 测试

```sh
node tests/unit.mjs           # 纯模块 + REST 路由 + Fork 生成
node tests/client-harness.mjs # client 模块：侧栏面板 + main 页注册
node tests/client-reexec.mjs  # client 脚本双执行回归（防顶层声明冲突）
```
