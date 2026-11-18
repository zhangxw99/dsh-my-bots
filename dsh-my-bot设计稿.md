# **DSH 多 Bot 插件完整设计稿（V1.0）**

技术方案 · 面向本地 Agent 实施 · 2026-11-18

这次我会调整上一版设计中的一个核心问题：

**DSH 的 Bot 必须基于&#x20;**`@deepseek-ai/dsh-agent-preset`**&#x20;实现，而不是自己创建一套平行的 Agent Runtime。**

这意味着我们要把两个概念分清楚：

- **Agent Preset：定义一个 Bot 是谁、拥有什么工具、遵循什么指令。**
- **Bot Manager：负责管理这些 Preset 对应的 Bot 身份、会话、关系、消息和协作。**

这才是符合 DSH 原生架构的设计。

我查阅了 DSH 的 Agent Preset Registry、Preset 机制、Subagent 机制，以及现有的 `dsh-grokbot` 实现。DSH 的 Preset 可以在同一进程内为不同 Session 提供不同的 Agent 组合；而且一个 Preset 的组合可以被多个 Session 复用。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub+2



还有一个特别重要的约束：

**Preset 是 Session 创建时确定的组合，不能把一个已经运行的 Session 直接切换到另一个 Preset。**

因此，Bot 的身份与它当前使用的 Session 必须分开管理。更换 Bot 的 Preset，应创建新的 Session，而不是强行改变现有 Session 的 Agent 组成。

[image](https://www.google.com/s2/favicons?domain=https://deepseek-plugin.org\&sz=32)

DeepSeek 插件目录



## **0. 项目定位与目标**

项目暂定名称：

- 插件包名：`dsh-bots`
- 插件显示名：`DSH Bots`
- 核心定位：Persistent Multi-Bot Organization System
- 运行方式：DSH 原生插件，Out-of-tree
- Agent 执行：DSH 原生 Agent Runtime
- Agent 个性化：DSH Agent Preset
- 持久化：插件独立状态目录
- UI：DSH Web 插件界面

### **0.1 产品目标**

构建一个类似 Grok Bot 的长期 Bot 团队系统。

用户可以：

1. 创建多个长期存在的 Bot。
2. 为每个 Bot 指定一个 Agent Preset。
3. 为每个 Bot 指定独立的工作区、模型和权限。
4. 与 Bot 独立聊天。
5. 创建群聊，把多个 Bot 放入同一个团队。
6. 让 Bot 之间互相发送消息。
7. 让 Bot 委派任务给其他 Bot。
8. 让主 Bot 统一管理团队和任务。
9. 为 Bot 分配 Skill。
10. 查看每个 Bot 的实时运行状态和任务进度。

### **0.2 非目标**

V1 不做以下事情：

- 不实现自己的 LLM Agent Loop。
- 不实现自己的模型 Provider。
- 不修改 DSH 原生 Agent Runtime。
- 不复制一套 DSH Session 系统。
- 不让 Bot 直接访问其他 Bot 的私有 Session。
- 不要求每个 Bot 使用独立进程。
- 不默认允许 Bot 无限制自主委派。
- 不在第一版实现复杂的可视化 DAG 工作流。

这些能力应该由 DSH 或后续独立模块承担。

## **1. 核心架构原则：Bot = Preset + Identity + Session Collection**

这是整个设计最重要的抽象。

不要直接把 DSH 的 Agent 对象包装成 Bot，也不要把 Bot 设计成一个独立的 Agent 实例。

建议采用以下关系：

**Bot Identity**

长期身份：researcher

名字、头像、描述、团队归属、默认工作区

绑定

**Agent Preset**

researcher-v1

Persona、Tools、Prompt Sections、Skills、Restrictions

创建会话时使用

**Session Collection**

Direct Session

与用户私聊

Group Session

参与团队群聊

Task Session

执行独立任务

Inbox Session

处理消息与委派

### **1.1 设计规则**

| 规则                        | 说明                                      |
| ------------------------- | --------------------------------------- |
| 一个 Bot 可以绑定一个默认 Preset    | 必须                                      |
| 多个 Bot 可以绑定同一个 Preset     | 允许                                      |
| 一个 Bot 可以拥有多个 Session     | 必须                                      |
| 每个 Session 创建时绑定一个 Preset | 必须                                      |
| 同一个 Session 中途切换 Preset   | 禁止已产生内容的 Session                        |
| Bot 修改 Preset             | 只影响后续创建的 Session                        |
| Bot 更换 Preset             | 保留旧 Session，不删除历史                       |
| Preset 删除                 | 如果仍被 Bot 或历史 Session 引用，必须阻止直接删除或执行安全归档 |

### **1.2 Bot 和 Preset 的版本关系**

举例：

```
Bot: Researcher

Default Preset:
  researcher-v2

Sessions:
  session-001 -> researcher-v1
  session-002 -> researcher-v1
  session-003 -> researcher-v2
```

Researcher 修改了 Preset 后，之前的聊天仍然按照原来的 Preset 运行。

这样可以保证：

- 历史会话可追溯。
- 工具调用记录不会失去原有定义。
- 不同版本的 Bot 可以共存。
- 可以通过新建 Session 实现安全升级。

特别注意：DSH Registry 对 Preset 声明和历史 Agent Composition 有自己的生命周期管理。插件不能自行假设修改一个 Preset 文件就能让所有已有 Agent 自动更新。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub+1



## **2. Agent Preset 集成规范**

这是给实现 Agent 的最高优先级技术要求。

### **2.1 不自己实现 Preset**

必须优先使用 DSH 官方提供的：

- `@deepseek-ai/dsh-agent-preset`
- `@deepseek-ai/dsh-agent-preset-registry`
- `@deepseek-ai/dsh-client-ui-agent-preset`（如果宿主已提供对应 UI）

Preset 的配置是一个独立组合，主要决定：

1. Persona
2. System Prompt Sections
3. Tools
4. Skills
5. Variables
6. Restrictions

参考：

[DSH Agent Presets 官方架构说明](https://dsh.hicyou.com/en/docs/user-guide/presets?utm_source=chatgpt.com)。

### **2.2 Bot 配置**

Bot 只记录 Preset ID，不重复存储一份 Persona、Tools 配置。

```
interface BotDefinition {
  id: string;

  name: string;
  description: string;
  avatar?: string;

  presetId: string;

  workspace?: string;

  modelOverride?: {
    providerId: string;
    modelId: string;
  };

  teamId: string;

  enabled: boolean;

  createdAt: number;
  updatedAt: number;
}
```

其中：

- `presetId` 是核心。
- `modelOverride` 是可选覆盖项，必须使用 DSH 支持的模型路由机制。
- `workspace` 是工作环境配置，不是 Agent Preset 的替代品。
- 不在 BotDefinition 中再次定义 Persona 和 Tool List。

### **2.3 创建 Bot 的流程**

```
用户点击 Create Bot
        |
        v
选择一个已有 Agent Preset
        |
        v
填写 Bot 名称、头像、描述
        |
        v
选择是否复制 Preset
        |
        +------ 不复制 ------> 直接引用原 Preset
        |
        +------ 复制 --------> 创建独立 Preset
                                  |
                                  v
                         修改 Persona / Tools / Skills
                                  |
                                  v
                         验证 Preset 可用性
                                  |
                                  v
                            保存 Bot
```

这里建议支持两种模式：

**Reference 模式**

Bot 直接使用现有 Preset。

适合多个 Bot 使用相同的能力配置，但有不同身份标签、团队位置和工作区的情况。

**Fork 模式**

通过 DSH 支持的 Preset Copy 机制复制一个 Preset，然后修改副本。

适合为某个 Bot 建立专属角色、工具集和技能配置。

注意：Fork 不是让插件自行拼接一份 YAML。必须调用或遵循当前 DSH 版本支持的 Preset 管理机制。

### **2.4 Preset 目录约定**

对于用户自定义 Preset，DSH 文档给出的用户目录为：

```
~/.dsh/.agent-presets/
```

每个 Preset 是一个目录，包含：

```
researcher/
├── agent.cordis.yml
├── preset.yml
└── skills/
    ├── web-research/
    │   └── SKILL.md
    └── report-writing/
        └── SKILL.md
```

其中：

- `agent.cordis.yml` 是 Agent 组合。
- `preset.yml` 是展示元数据。
- `skills/` 可以包含 Preset 所需的技能资料。

具体目录、复制和发现行为必须以目标 DSH 版本的实际实现为准。

[image](https://www.google.com/s2/favicons?domain=https://dsh.hicyou.com\&sz=32)

DeepSeek Harness Bluebook+1



### **2.5 Preset 生命周期管理**

插件需要提供一个 Preset Adapter，负责：

```
interface PresetAdapter {
  list(): Promise<PresetInfo[]>;

  inspect(id: string): Promise<PresetInfo | null>;

  validate(id: string): Promise<PresetValidation>;

  copy(
    sourceId: string,
    newId: string,
    name?: string
  ): Promise<PresetInfo>;

  getForSession(
    sessionId: string
  ): Promise<string | null>;
}
```

以上是插件内部的抽象接口，不代表 DSH 已存在完全相同的方法签名。

实现 Agent 必须先检查当前 DSH 依赖和源码，找到真实的 Preset API，再编写适配器。

尤其禁止：

- 自己维护一套与 DSH 脱节的 Preset Registry。
- 通过修改 DSH 内部数据库来更换 Preset。
- 在已有 Session 中强制替换工具组合。
- 未经验证直接修改全局 Profile Patch。
- 通过修改 Preset ID 伪造历史 Session 的身份。

### **2.6 Preset 失效处理**

Bot 引用的 Preset 可能被删除、损坏或无法加载。

应显示：

Preset unavailable

但不要删除 Bot。

处理流程：

1. Bot 保持可见。
2. 禁止新建执行 Session。
3. 允许查看旧 Session。
4. 显示错误原因。
5. 提供重新绑定 Preset 的入口。
6. 重新绑定后，只对新 Session 生效。

这点也符合 DSH Registry 对失败 Preset 保留定义可见性的设计。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



## **3. Bot Organization：组织管理系统**

这一层不负责执行 Agent，只负责 Bot 的组织关系。

### **3.1 Team**

Team 是一组 Bot 的逻辑容器。

```
interface BotTeam {
  id: string;
  name: string;
  description?: string;

  chiefBotId?: string;

  memberBotIds: string[];

  createdAt: number;
}
```

V1 默认只创建一个 Team：

`My AI Team`

但底层允许多个 Team。

### **3.2 Bot 角色**

不要把组织权限和 Agent Preset 的专业角色混淆。

例如：

| Bot        | 专业身份            | 组织身份        |
| ---------- | --------------- | ----------- |
| Chief      | 项目管理 Preset     | Team Leader |
| Researcher | Research Preset | Member      |
| Developer  | Coding Preset   | Member      |
| Reviewer   | Review Preset   | Member      |

专业身份来自 Preset，组织身份来自 Bot Manager。

一个 Bot 可以在不同 Team 中承担不同的组织职责，但 V1 暂时只允许一个 Team。

### **3.3 组织权限**

定义四种基础权限：

```
type BotRole =
  | "owner"
  | "admin"
  | "member"
  | "observer";
```

| 操作        | Owner | Admin | Member | Observer |
| --------- | ----- | ----- | ------ | -------- |
| 查看团队      | ✓     | ✓     | ✓      | ✓        |
| 创建 Bot    | ✓     | ✓     | -      | -        |
| 删除 Bot    | ✓     | ✓     | -      | -        |
| 修改成员      | ✓     | ✓     | -      | -        |
| 发起任务      | ✓     | ✓     | ✓      | -        |
| 给 Bot 发消息 | ✓     | ✓     | ✓      | -        |
| 修改团队权限    | ✓     | -     | -      | -        |
| 管理 Preset | ✓     | 可授权   | -      | -        |

注意：这里的权限是插件自己的组织权限，并不自动替代 DSH 对工具、文件和系统操作的授权。

## **4. Session Manager：统一会话管理**

我建议所有 Bot 聊天都通过统一的 Session Manager。

不要让 Bot Chat、Group Chat 和 Task Manager 各自实现 Session 创建逻辑。

### **4.1 会话类型**

```
type BotSessionType =
  | "direct"
  | "group"
  | "task";
```

分别解释：

- `direct`：用户与一个 Bot 私聊。
- `group`：Bot 参与团队群聊。
- `task`：某个 Bot 执行一个独立委派任务。

Inbox 是消息来源，不必单独定义成一种 Session 类型。

### **4.2 Session 数据结构**

```
interface BotSessionBinding {
  id: string;

  botId: string;

  type: BotSessionType;

  dshSessionId: string;

  presetId: string;

  presetRevision?: string;

  teamId: string;

  groupId?: string;

  taskId?: string;

  workspace?: string;

  status:
    | "active"
    | "idle"
    | "completed"
    | "archived"
    | "error";

  createdAt: number;
  updatedAt: number;
}
```

`dshSessionId` 必须对应 DSH 原生 Session。

插件只负责记录绑定关系，不重复保存完整的 Agent 对话历史。

### **4.3 Session 创建流程**

```
Bot Manager
    |
    v
读取 BotDefinition
    |
    v
验证 Preset 是否存在
    |
    v
解析 Model Override
    |
    v
解析 Workspace
    |
    v
调用 DSH 原生 Session 创建接口
    |
    v
指定 Bot 对应的 presetId
    |
    v
保存 dshSessionId 与 botId 的关系
    |
    v
启动原生 Agent 执行
```

如果 DSH 的原生创建接口不支持某个字段，不允许通过猜测 RPC 方法或内部对象来实现。

先以目标版本的 Session API 为准。

### **4.4 Session 与 Preset 不一致时**

例如：

```
Bot:
  researcher
  current preset = researcher-v2

Old Session:
  session-001
  preset = researcher-v1
```

如果用户打开旧 Session：

- 必须显示它运行的是 `researcher-v1`。
- 不得把它伪装成 `researcher-v2`。
- 可以继续使用原 Session（前提是 DSH 恢复成功）。
- 新建会话才使用 `researcher-v2`。

如果旧 Preset 已经不存在，必须明确显示恢复失败或历史配置不可用，不能假装它仍然使用当前 Preset。

## **5. Bot Messaging：消息通信系统**

### **5.1 消息类型**

```
type BotMessageType =
  | "chat"
  | "task"
  | "task_result"
  | "notification"
  | "approval_request"
  | "system";
```

### **5.2 消息实体**

```
interface BotMessage {
  id: string;

  teamId: string;

  fromBotId?: string;
  toBotId?: string;

  groupId?: string;

  type: BotMessageType;

  content: string;

  taskId?: string;

  replyTo?: string;

  metadata?: Record<string, unknown>;

  createdAt: number;
}
```

消息投递状态单独管理：

```
interface MessageDelivery {
  messageId: string;

  recipientBotId: string;

  status:
    | "pending"
    | "delivered"
    | "processing"
    | "completed"
    | "failed";

  attempts: number;

  lastError?: string;

  updatedAt: number;
}
```

这样一条群聊消息可以有多个接收者，而不需要复制多份 Message 内容。

### **5.3 Direct Message**

示例：

```
Assistant -> Researcher

请调研 DSH Agent Preset 的机制。
整理 Preset 的创建、修改和生命周期。
```

消息进入 Researcher Inbox 后：

1. 验证发送者权限。
2. 保存消息。
3. 查找对应的 Bot Session。
4. 创建或恢复 Session。
5. 将消息交给 Researcher 执行。
6. 保存结果。
7. 通知 Assistant。

### **5.4 Message Delivery 机制**

```
Message Created
      |
      v
Persistent Inbox
      |
      v
Authorization
      |
      v
Delivery Queue
      |
      v
Bot Session Resolver
      |
      v
DSH Session
      |
      v
Native Agent Execution
      |
      v
Result Message
```

消息系统必须持久化，不能只依赖内存 EventEmitter。

需要考虑：

- DSH 重启。
- 消息重复投递。
- Bot 执行超时。
- Session 创建失败。
- Bot 忙碌。
- 用户取消任务。
- 任务执行过程中插件卸载。

建议使用 SQLite 或 DSH 已有的持久化设施，具体选择以宿主提供的能力为准。

消息投递必须有幂等键，至少保证同一条消息不会因重试而创建多个重复执行任务。

## **6. Group Chat：多 Bot 群聊**

群聊是多 Bot 系统最重要的交互方式之一。

### **6.1 群聊模型**

```
interface BotGroup {
  id: string;

  teamId: string;

  name: string;
  description?: string;

  memberBotIds: string[];

  ownerBotId?: string;

  createdAt: number;
  updatedAt: number;
}
```

每个群聊对应一个 DSH 原生 Group Session 或一组明确关联的 DSH Agent Sessions。

这里需要区分两种实现：

**方案 A：共享 DSH Session**

多个 Bot 共享同一个 Session。

不建议采用。因为一个 Session 在 DSH 中对应一个 Agent Composition，不能简单地让多个 Bot 同时拥有不同 Preset。

**方案 B：群聊 Transcript + 独立 Agent Sessions**

推荐

- Group 有一个统一的消息记录。
- 每个 Bot 有自己的 DSH Session。
- 群聊消息作为上下文传递给对应 Bot。
- 每个 Bot 使用自己的 Preset 执行。
- Bot 的回复进入统一群聊。

这更符合 DSH 的 Agent Preset 机制。

### **6.2 群聊交互规则**

支持：

| 交互            | 行为              |
| ------------- | --------------- |
| 普通消息          | 只记录，不自动唤醒所有 Bot |
| `@Researcher` | 唤醒 Researcher   |
| `@Developer`  | 唤醒 Developer    |
| `@all`        | 广播给全部成员         |
| `@Chief`      | 请求 Chief 处理     |
| Bot 回复        | 进入群聊 Transcript |

默认不要每条消息都唤醒全部 Bot，否则会造成不必要的模型调用。

### **6.3 群聊执行过程**

```
User:
  我们讨论一下多 Bot 插件架构。

        |
        v

Group Transcript
        |
        v

@Researcher
        |
        v

Researcher Session
        |
        v

Researcher Reply
        |
        v

Group Transcript
        |
        v

@Developer
        |
        v

Developer Session
        |
        v

Developer Reply
        |
        v

Chief 汇总
```

### **6.4 群聊上下文注入**

不要把群聊所有历史无限注入每次请求。

建议：

```
interface GroupContext {
  groupId: string;

  recentMessages: BotMessage[];

  summary?: string;

  activeTaskIds: string[];

  maxMessages: number;
}
```

上下文组装策略：

1. 最近 N 条群聊消息。
2. 当前任务相关的历史消息。
3. 群聊摘要。
4. 当前 Bot 的私有 Session 历史。

群聊消息应该作为明确标注的外部协作上下文，而不是直接写进 Bot 的长期私人记忆。

## **7. Task Manager：任务委派系统**

这部分借鉴 Grok Bot 的派发与回流思想。

### **7.1 Task 数据模型**

```
interface BotTask {
  id: string;

  teamId: string;

  title: string;
  description: string;

  createdBy: string;

  assignedBotId: string;

  parentTaskId?: string;

  status:
    | "pending"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";

  result?: string;

  error?: string;

  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}
```

### **7.2 Task 生命周期**

1. **Pending**

   任务已经创建，等待执行。
2. **Running**

   Bot 正在执行任务。
3. **Waiting**

   等待其他 Bot、用户审批或外部结果。
4. **Completed / Failed**

   任务结束，记录最终结果和执行信息。

### **7.3 Task 与 DSH Subagent 的关系**

这里需要特别强调：

DSH 原生 `@deepseek-ai/dsh-tool-subagent` 是一个托管委派工具，它适合启动有边界的子任务；它并不等于我们定义的长期 Bot。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



因此：

| 场景                 | 推荐实现                            |
| ------------------ | ------------------------------- |
| 长期 Bot 之间通信        | Bot Messaging + 独立 Session      |
| Bot 之间正式委派         | Task Manager                    |
| 一次性并行子任务           | DSH Subagent                    |
| 需要不同专业 Preset 的子任务 | DSH Subagent 指定允许的 Agent Preset |
| 需要持续参与团队讨论         | 长期 Bot Session                  |

不应该为了每次委派都创建一个全新的、没有长期身份的 Subagent。

### **7.4 任务执行接口**

```
interface TaskDispatcher {
  create(input: CreateTaskInput): Promise<BotTask>;

  dispatch(taskId: string): Promise<void>;

  cancel(taskId: string): Promise<void>;

  get(taskId: string): Promise<BotTask | null>;

  list(teamId: string): Promise<BotTask[]>;
}
```

执行过程：

```
Chief
  |
  v
Create Task
  |
  v
Task Manager
  |
  v
Resolve Target Bot
  |
  v
Resolve Target Preset
  |
  v
Create / Resume DSH Session
  |
  v
Execute Task
  |
  v
Persist Result
  |
  v
Notify Chief
  |
  v
Chief Review
```

### **7.5 任务约束**

默认配置：

```
interface TaskPolicy {
  maxDelegationDepth: number; // 2
  maxParallelTasks: number;   // 3
  maxRetries: number;         // 2
  timeoutMs: number;          // 600000
  requireApprovalFor: string[];
}
```

要求：

- 禁止无限委派。
- 禁止循环委派。
- 禁止同一任务重复启动。
- 失败后可重试。
- 重试时保留任务历史。
- 取消任务后禁止继续提交新操作。
- 不允许 Bot 越权操作其他 Bot 的工作区。

## **8. Memory：记忆与上下文管理**

V1 不需要自己实现复杂的向量数据库。

先区分三种数据：

| 类型             | 存储内容        | 权限      |
| -------------- | ----------- | ------- |
| Private Memory | Bot 自己的长期记忆 | 仅该 Bot  |
| Group Memory   | 团队共享决策      | Team 成员 |
| Task Context   | 任务执行过程与结果   | 任务参与者   |

建议目录：

```
~/.dsh/bots/
├── bots/
│   ├── chief/
│   │   └── memory/
│   ├── researcher/
│   │   └── memory/
│   └── developer/
│       └── memory/
│
├── teams/
│   └── default/
│       ├── memory/
│       └── groups/
│
└── tasks/
    └── task-001/
        ├── task.json
        └── result.md
```

但要注意，目录只是逻辑组织建议。实现时应优先利用 DSH 自带的 Session 和 Workspace 能力，避免与原生存储产生冲突。

### **8.1 Memory 写入策略**

不要把所有消息都自动转化为长期记忆。

只在以下情况写入：

- 用户明确要求记住。
- Bot 完成重要任务并提炼出长期有用的信息。
- 团队确定重要决策。
- 项目产生稳定的约束或规范。

### **8.2 Memory 权限**

Bot 可以读取：

- 自己的 Private Memory。
- 所在 Team 授权的 Group Memory。
- 当前任务相关的 Task Context。

Bot 默认不能读取：

- 其他 Bot 的 Private Memory。
- 未授权的其他 Team。
- 未参与的私有任务。

## **9. Skill Management**

Skill 与 Preset 的关系需要非常清楚。

**Preset 决定 Agent 拥有哪些 Skill；Skill 负责描述具体工作方法。**

例如：

```
Researcher Preset
  |
  +-- web-search
  +-- academic-research
  +-- report-writing

Developer Preset
  |
  +-- code-review
  +-- debugging
  +-- testing
```

V1 不再实现一套独立的 Skill 执行引擎。

只提供：

- Skill 目录浏览。
- Preset 中 Skill 清单展示。
- Bot 当前 Skill 展示。
- Fork Preset 后的 Skill 配置。
- Preset 验证。

如果要跨 Bot 共享 Skill，应该通过 Preset Copy 或官方支持的 Skill 机制完成，不应该让 Bot 在运行中随意修改其他 Bot 的技能配置。

## **10. Routine：自动化与定时任务**

V1 先预留接口，V2 接入 DSH 原生任务调度。

```
interface BotRoutine {
  id: string;

  botId: string;

  name: string;

  trigger: {
    type: "cron" | "event" | "webhook";
    expression?: string;
  };

  prompt: string;

  enabled: boolean;
}
```

执行时：

1. Routine Trigger 触发。
2. 找到所属 Bot。
3. 获取 Bot 默认 Preset。
4. 创建或恢复对应任务 Session。
5. 执行。
6. 保存结果。
7. 通知用户。

不要为定时任务创建独立的 Agent Loop。

## **11. UI 设计：Bot Workbench**

UI 建议做成 DSH 内部原生插件页面，不要独立打开一个外部网站。

### **11.1 整体布局**

**DSH Bots**

Team Online

**MY TEAM**

Chief

Researcher

Developer

Reviewer

GROUPS



# **Architecture**





# **Development**



TASKS

Active · 2

## **Chief**

Team leader · chief-preset

Chief

你好，我可以帮你协调团队成员、拆分任务和检查交付结果。

Researcher 已完成调研任务。

整理了 Agent Preset 和多 Bot Session 的技术方案。

Message Chief...

概念布局示意，实际实现应使用 DSH 的原生 UI 插件框架。

### **11.2 主要页面**

| 页面          | 功能                           |
| ----------- | ---------------------------- |
| Home        | 团队概览、Bot 状态、最近任务             |
| Bots        | Bot 列表与创建                    |
| Bot Detail  | Bot 信息、Preset、Session、Memory |
| Direct Chat | 单 Bot 聊天                     |
| Groups      | 群聊与成员管理                      |
| Tasks       | 任务列表、状态和结果                   |
| Presets     | Preset 浏览与关联                 |
| Settings    | 默认 Bot、权限、存储设置               |

### **11.3 Bot Detail**

必须能够查看：

- Bot 名称、头像、描述。
- 当前 Preset。
- Preset 状态。
- 工作区。
- 模型覆盖设置。
- 当前 Session。
- 历史 Session。
- Private Memory。
- 当前可用 Skills。
- 运行状态。
- 最近执行任务。

### **11.4 实时状态**

定义：

```
type BotRuntimeStatus =
  | "offline"
  | "idle"
  | "working"
  | "waiting"
  | "error";
```

状态不能只是前端自己维护的标志。

必须从 DSH Agent / Session 事件和插件自己的任务状态中推导。

## **12. 插件 API 设计**

建议提供 REST API 给前端和外部系统使用。

统一前缀：

`/api/plugins/bots`

### **Bot API**

| Method | Path                 | 说明         |
| ------ | -------------------- | ---------- |
| GET    | `/bots`              | 获取 Bot 列表  |
| POST   | `/bots`              | 创建 Bot     |
| GET    | `/bots/:id`          | 获取 Bot 详情  |
| PUT    | `/bots/:id`          | 修改 Bot     |
| DELETE | `/bots/:id`          | 删除 Bot     |
| POST   | `/bots/:id/chat`     | 向 Bot 发送消息 |
| GET    | `/bots/:id/sessions` | 获取会话列表     |
| POST   | `/bots/:id/sessions` | 创建新会话      |

### **Group API**

| Method | Path                         | 说明     |
| ------ | ---------------------------- | ------ |
| GET    | `/groups`                    | 获取群聊   |
| POST   | `/groups`                    | 创建群聊   |
| GET    | `/groups/:id`                | 获取群聊详情 |
| PUT    | `/groups/:id`                | 修改群聊   |
| POST   | `/groups/:id/members`        | 添加成员   |
| DELETE | `/groups/:id/members/:botId` | 移除成员   |
| GET    | `/groups/:id/messages`       | 获取群聊消息 |
| POST   | `/groups/:id/messages`       | 发送群聊消息 |

### **Task API**

| Method | Path                | 说明     |
| ------ | ------------------- | ------ |
| GET    | `/tasks`            | 获取任务   |
| POST   | `/tasks`            | 创建任务   |
| GET    | `/tasks/:id`        | 获取任务详情 |
| POST   | `/tasks/:id/cancel` | 取消任务   |
| POST   | `/tasks/:id/retry`  | 重试任务   |

### **Preset API**

| Method | Path                    | 说明           |
| ------ | ----------------------- | ------------ |
| GET    | `/presets`              | 获取 Preset 清单 |
| GET    | `/presets/:id`          | 获取 Preset 详情 |
| POST   | `/presets/:id/validate` | 验证 Preset    |
| POST   | `/presets/copy`         | 复制 Preset    |

所有 API 都需要进行参数校验、权限校验、错误处理和必要的并发控制。

API 只提供插件级操作，不直接暴露 DSH 内部 Agent 对象。

## **13. 数据存储设计**

推荐使用 SQLite 保存结构化数据，使用文件系统保存较大的 Markdown 记忆和附件。

```
~/.dsh/bots/
│
├── database.sqlite
│
├── bots/
│   ├── chief/
│   ├── researcher/
│   └── developer/
│
├── teams/
│   └── default/
│
├── groups/
│   ├── architecture/
│   └── development/
│
├── tasks/
│   ├── task-001/
│   └── task-002/
│
├── inbox/
│
├── attachments/
│
└── logs/
```

### **13.1 核心数据库表**

| 表                    | 用途                   |
| -------------------- | -------------------- |
| `bots`               | Bot 身份及 Preset 绑定    |
| `teams`              | 团队                   |
| `team_members`       | 团队成员和权限              |
| `bot_sessions`       | Bot 与 DSH Session 映射 |
| `groups`             | 群聊                   |
| `group_members`      | 群聊成员                 |
| `messages`           | 消息记录                 |
| `message_deliveries` | 消息投递状态               |
| `tasks`              | 任务记录                 |
| `task_events`        | 任务事件历史               |
| `routines`           | 定时任务                 |
| `memory_refs`        | 记忆文件引用               |

### **13.2 数据完整性要求**

- Bot 删除时不删除 DSH 原生 Session。
- Group 删除时不删除参与者的 Session。
- Task 删除建议只归档，不物理删除。
- Preset 删除时检查引用关系。
- 消息记录支持分页。
- 所有任务状态变化都需要有事件记录。
- 数据库迁移必须有版本号。
- 定期备份插件数据。

## **14. 安全设计**

这一层不能忽略。

### **14.1 权限隔离**

Bot A 不能因为知道 Bot B 的 Session ID，就获得 Bot B 的 Session 内容。

每次访问都必须检查：

```
Requester
   |
   v
Organization Permission
   |
   v
Resource Ownership
   |
   v
Session / Workspace Authorization
   |
   v
Allow or Deny
```

### **14.2 工具权限**

工具权限以 Agent Preset 的工具组合和 DSH 原生授权为基础。

Bot Manager 不应偷偷扩大 Bot 的权限。

例如：

- Developer 可以拥有代码编辑工具。
- Reviewer 可以只有读取与检查工具。
- Researcher 可以拥有搜索工具。
- Chief 可以管理团队，但不代表自动获得所有文件的读写权限。

### **14.3 人工审批**

涉及以下操作时，应遵循 DSH 宿主原生审批机制：

- 高风险 Shell 操作。
- 删除文件。
- 覆盖重要文件。
- 外部系统写入。
- 具有不可逆影响的操作。

插件可以提供统一的审批入口，但不能绕过宿主权限系统。

## **15. 异常恢复和生命周期**

必须考虑 DSH 重启与插件重新加载。

| 情况          | 处理                        |
| ----------- | ------------------------- |
| DSH 重启      | 恢复 Bot、任务和消息状态            |
| Bot 执行中断    | 将任务标记为 interrupted，按策略恢复  |
| Session 不存在 | 标记 Session 错误，不伪造 Session |
| Preset 失效   | 禁止新建 Session，保留历史         |
| 数据库损坏       | 提供备份恢复                    |
| 消息投递失败      | 重试并记录失败原因                 |
| 重复消息        | 通过幂等键去重                   |
| Bot 删除      | 保留 Session 历史，解除组织关系      |
| 插件卸载        | 不删除用户数据，除非用户明确选择清理        |

### **15.1 插件生命周期**

```
Plugin Start
    |
    v
Load Database
    |
    v
Run Migrations
    |
    v
Load Bot Registry
    |
    v
Validate Preset References
    |
    v
Recover Pending Messages
    |
    v
Recover Interrupted Tasks
    |
    v
Subscribe to DSH Events
    |
    v
Start API / UI
    |
    v
Ready
```

卸载时需要：

1. 停止接收新任务。
2. 取消插件拥有的后台调度。
3. 处理运行中任务。
4. 关闭事件监听。
5. 关闭数据库。
6. 保留持久化文件。

## **16. 技术目录结构**

推荐使用 TypeScript + DSH Cordis 插件架构。

```
dsh-bots/
│
├── src/
│   │
│   ├── index.ts
│   │
│   ├── core/
│   │   ├── bot-manager.ts
│   │   ├── team-manager.ts
│   │   ├── bot-lifecycle.ts
│   │   └── types.ts
│   │
│   ├── preset/
│   │   ├── preset-adapter.ts
│   │   ├── preset-resolver.ts
│   │   ├── preset-validator.ts
│   │   └── preset-binding.ts
│   │
│   ├── session/
│   │   ├── session-manager.ts
│   │   ├── session-resolver.ts
│   │   └── session-binding.ts
│   │
│   ├── messaging/
│   │   ├── message-manager.ts
│   │   ├── inbox.ts
│   │   ├── delivery.ts
│   │   └── message-bus.ts
│   │
│   ├── groups/
│   │   ├── group-manager.ts
│   │   ├── group-context.ts
│   │   └── mention-router.ts
│   │
│   ├── tasks/
│   │   ├── task-manager.ts
│   │   ├── task-dispatcher.ts
│   │   ├── task-runner.ts
│   │   └── task-recovery.ts
│   │
│   ├── memory/
│   │   ├── memory-manager.ts
│   │   ├── private-memory.ts
│   │   └── group-memory.ts
│   │
│   ├── skills/
│   │   └── skill-catalog.ts
│   │
│   ├── permissions/
│   │   ├── permission-manager.ts
│   │   └── access-control.ts
│   │
│   ├── routines/
│   │   └── routine-manager.ts
│   │
│   ├── storage/
│   │   ├── database.ts
│   │   ├── migrations/
│   │   └── repositories/
│   │
│   ├── api/
│   │   ├── bots.ts
│   │   ├── groups.ts
│   │   ├── tasks.ts
│   │   └── presets.ts
│   │
│   └── client/
│       ├── index.ts
│       ├── pages/
│       ├── components/
│       └── styles/
│
├── tests/
│   ├── preset/
│   ├── session/
│   ├── messaging/
│   ├── groups/
│   ├── tasks/
│   └── integration/
│
├── package.json
├── tsconfig.json
└── cordis.patch.yml
```

模块之间采用依赖注入，不要在每个模块中直接 import 全局单例。

尤其是 DSH Adapter 应该集中处理宿主接口的版本差异。

## **17. 开发阶段与验收标准**

建议拆成四个里程碑，而不是一次性开发所有功能。

### **Milestone 1：Preset-based Bot 基础系统**

P0 · 必须先完成

实现：

- DSH 插件正常加载。
- Preset Adapter。
- Preset 清单读取。
- Bot 创建、编辑、删除。
- Bot 与 Preset 绑定。
- Preset Fork。
- 独立 DSH Session。
- Bot 私聊。
- Session 历史管理。
- Bot 基础 UI。

验收：

1. 可以创建 Researcher Bot。
2. 可以选择一个已有 Agent Preset。
3. 可以复制 Preset 并修改副本。
4. 可以创建多个 Bot，分别使用不同 Preset。
5. 每个 Bot 有独立 DSH Session。
6. 修改 Bot 的 Preset 不会影响已有 Session。
7. DSH 重启后 Bot 和 Session 映射仍然存在。

### **Milestone 2：多 Bot Communication**

P0 · 核心功能

实现：

- Team Manager。
- Group Manager。
- Inbox。
- Message Bus。
- Direct Message。
- Group Transcript。
- `@Bot` 路由。
- Bot 状态展示。

验收：

1. Assistant 可以给 Researcher 发消息。
2. Researcher 可以完成任务并返回结果。
3. 可以创建多人群聊。
4. `@Researcher` 只唤醒 Researcher。
5. `@all` 可以广播。
6. DSH 重启后未完成的消息可以恢复。
7. 不同 Bot 的 Session 和 Preset 不会混淆。

### **Milestone 3：Task Orchestration**

P1 · 任务协作

实现：

- Task Manager。
- Task Dispatch。
- Task Result。
- Task History。
- Parallel Tasks。
- Retry。
- Cancel。
- Chief 汇总。

验收：

用户向 Chief 发送：

```
研究一下 DSH 的 Agent Preset 机制，
然后让 Developer 设计一个插件实现方案，
最后交给 Reviewer 审核。
```

系统可以：

1. Chief 创建任务。
2. Researcher 执行调研。
3. Researcher 返回结果。
4. Chief 委派 Developer。
5. Developer 返回方案。
6. Chief 委派 Reviewer。
7. Reviewer 返回审核结果。
8. Chief 汇总交付。

整个过程能够在 UI 中查看。

### **Milestone 4：Memory、Routine 和高级协作**

P2 · 增强功能

实现：

- Private Memory。
- Group Memory。
- Routine。
- Webhook。
- 外部 Inbox。
- Subagent Integration。
- 更完善的并行调度。

## **18. 给本地 Agent 的实施要求**

这一部分非常重要。建议让你的本地 Agent 先阅读，再开始写代码。

# DSH Bots — Implementation Instructions

## Project Goal

Implement a persistent multi-Bot organization plugin for DeepSeek Harness (DSH).

The plugin must use DSH's native Agent Preset mechanism as the foundation of every Bot.

Core architecture:

- Bot Identity is a persistent plugin-owned entity.
- Agent Preset defines the actual Agent composition.
- DSH Agent Runtime executes all Bot sessions.
- DSH Session is the source of truth for conversation history.
- Bot Manager manages identities, teams and relationships.
- Messaging provides inter-Bot communication.
- Task Manager provides persistent task delegation.

Do NOT implement a parallel LLM Agent Runtime.

## Critical Architecture Constraints

1. Every Bot must reference a real DSH Agent Preset ID.
2. Never duplicate Preset persona, tool configuration or skills into Bot configuration.
3. Use DSH native Session creation and Agent execution APIs.
4. Each Bot can own multiple independent DSH Sessions.
5. Each Session must preserve its original Preset identity.
6. Changing a Bot's default Preset only affects newly created Sessions.
7. Never force a Preset change on a non-empty existing Session.
8. Use DSH's native model routing, tool authorization and approval mechanisms.
9. Do not modify DSH core source code.
10. Do not invent undocumented APIs.

## Mandatory Repository Investigation

Before implementation:

1. Inspect the actual DSH version and installed package versions.
2. Inspect `@deepseek-ai/dsh-agent-preset`.
3. Inspect `@deepseek-ai/dsh-agent-preset-registry`.
4. Inspect DSH Session creation and restoration APIs.
5. Inspect Agent scope and preset resolution.
6. Inspect native Agent lifecycle events.
7. Inspect DSH plugin API and UI extension points.
8. Inspect the native subagent mechanism.
9. Review the reference project:\
   [https://github.com/nescafe2009/dsh-grokbot](https://github.com/nescafe2009/dsh-grokbot)
10. Review the official Preset documentation:\
    [https://dsh.hicyou.com/en/docs/user-guide/presets](https://dsh.hicyou.com/en/docs/user-guide/presets)

Do not assume the APIs in online documentation exactly match the installed runtime.

Produce an architecture investigation report before writing implementation code.

## Core Entities

Implement:

- BotDefinition
- BotTeam
- BotSessionBinding
- BotGroup
- BotMessage
- MessageDelivery
- BotTask
- TaskEvent
- BotRoutine

BotDefinition must contain `presetId`.

BotSessionBinding must contain:

- botId
- dshSessionId
- presetId
- session type
- workspace
- status

## Required Modules

1. Bot Manager
2. Preset Adapter
3. Session Manager
4. Team Manager
5. Message Manager
6. Group Manager
7. Task Manager
8. Permission Manager
9. Storage Layer
10. API Layer
11. UI Layer

## Preset Requirements

- Read actual DSH Preset definitions.
- Validate Preset availability.
- Support selecting existing Presets.
- Support copying Presets using supported DSH mechanisms.
- Bind Bot identities to Preset IDs.
- Preserve historical Session Preset bindings.
- Handle missing or invalid Presets safely.
- Never create a parallel Preset Registry.

## Session Requirements

Each Bot must have:

- Direct Sessions
- Group Sessions
- Task Sessions

Use native DSH Sessions.

A Group must use a shared transcript and independent Agent Sessions, not one shared Agent Session with multiple conflicting Presets.

## Messaging Requirements

Support:

- Direct Messages
- Group Messages
- Task Handoffs
- Broadcast
- Result Messages

Messages must be persistent and recoverable after restart.

Implement idempotency and delivery retry.

## Task Requirements

Support:

- Task creation
- Task assignment
- Task execution
- Task completion
- Task failure
- Retry
- Cancellation
- Task history

Set safe default delegation depth, parallelism and timeout limits.

Use native DSH Subagent functionality only for bounded child tasks, not as a replacement for persistent Bot identities.

## Security Requirements

- Enforce Bot and Team access control.
- Prevent unauthorized cross-Bot Session access.
- Never bypass DSH tool authorization.
- Respect workspace isolation.
- Preserve native approval workflows.
- Validate all external API inputs.

## Storage Requirements

Use SQLite or an existing DSH-supported persistence facility for structured data.

Preserve native DSH Session storage separately.

Do not delete native Session history when deleting a Bot.

Implement database migrations and recovery.

## Development Process

Implement in this order:

Phase 0: DSH API investigation and architecture report.

Phase 1: Preset Adapter and Bot Registry.

Phase 2: Native Session integration and Direct Chat.

Phase 3: Team, Messaging and Group Chat.

Phase 4: Task Manager and Delegation.

Phase 5: Memory, Skills and Routines.

Do not implement all phases at once.

Each phase must:

- Compile successfully.
- Pass type checks.
- Pass unit tests.
- Pass integration tests where applicable.
- Include an implementation report.
- Document any API assumptions.

## First Deliverable

Before writing the full plugin, deliver:

1. DSH API investigation report.
2. Verified Preset integration design.
3. Verified Session integration design.
4. Plugin architecture and dependency diagram.
5. Database schema.
6. MVP implementation plan.
7. Identified compatibility risks.

Then proceed with Phase 1.

## Definition of Done

The system must support multiple persistent Bot identities, each bound to a real DSH Agent Preset, with independent native DSH Sessions, persistent messaging, group collaboration and task delegation.

The result must be an out-of-tree DSH plugin with no DSH core modifications.

## **19. 我建议本次设计坚持的几个取舍**

| 设计问题                    | 最终选择             |
| ----------------------- | ---------------- |
| Bot 是独立 Agent 进程吗？      | 否                |
| Bot 基于什么创建？             | DSH Agent Preset |
| Bot 有独立记忆吗？             | 是                |
| Bot 有独立 Session 吗？      | 是                |
| Bot 能共享 Preset 吗？       | 是                |
| 群聊是否共用一个 Agent Session？ | 否                |
| 是否自己实现 LLM Loop？        | 否                |
| 是否使用 DSH Subagent？      | 使用，但只做有边界的子任务    |
| 是否修改 DSH 核心？            | 否                |
| Bot 修改 Preset 是否影响旧会话？  | 否                |

### **参考资料**

以下是建议你的本地 Agent 优先阅读的资料：

1. [dsh-grokbot](https://github.com/nescafe2009/dsh-grokbot?utm_source=chatgpt.com)：Grok Bot 式长期团队的 DSH 插件实现，重点看它的生命周期、群聊、派发和审批。
2. [DSH Agent Presets](https://dsh.hicyou.com/en/docs/user-guide/presets?utm_source=chatgpt.com)：Preset 机制及会话绑定规则。
3. [Agent Preset Registry](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/preset/agent-preset-registry?utm_source=chatgpt.com)：Preset 注册和生命周期。
4. [DSH Tool Subagent](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent/tool-subagent?utm_source=chatgpt.com)：原生任务委派。
5. [Agent Preset UI](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-agent-preset?utm_source=chatgpt.com)：Preset 管理界面。

**关于 Patato：** 目前还没有确认它对应的具体项目地址，因此这版没有编造 Patato 的内部实现细节。上面的组织、通信和协作接口已经留有扩展空间，拿到它的准确 GitHub 地址后，可以再做一次针对性的架构对照。

## **20. 最后的架构建议**

我认为这套系统真正值得投入精力的，不是创建 Bot 的 UI，而是三个核心：

**第一：Preset-based Identity**

让 Bot 成为有长期身份、专业能力和独立会话的主体。

**第二：Persistent Communication**

让 Bot 可以真正地互相通信、协作、交接工作，而不是简单地启动几个 Subagent。

**第三：Task Orchestration**

让 Bot 从简单聊天角色升级成有任务、有进度、有结果、有审核的团队成员。

我的最终建议是：**先把 Preset 与 Bot Identity 的映射做正确，再做独立 Session，最后做 Message Bus 和 Task Manager。**

不要先做群聊 UI，也不要先做复杂的 Agent Swarm。

只要这几个底层抽象正确，后续无论你想做 Grok Bot 式团队、Patato 式多 Bot 协作，还是多个专业 Agent 组成的虚拟公司，都不需要推翻基础架构。