# dsh-project-agent 实现计划

> 由 `dsh-superagent-prototype` fork 而来。目标：项目工作台 —— 主会话（Router）只派活，
> 每个子任务一个持久 worker Session，技能按任务裁剪，用户可直连子会话。

## 现状

- 基线：`pnpm typecheck` ✔、`pnpm build` ✔；`pnpm test` 的 38 个失败均为 Windows 平台差异
  （symlink EPERM、缺 gh/lark-cli、Unix 权限位、路径分隔符、POSIX 信号）。
- 包名已改为 `dsh-project-agent`。
- 代码 15,205 行；Trigger/Thread/Source 各有 400+ 次引用、50+ 文件——**不要硬删**。

## 决策

走最小路径：**保留原型领域，新增「派单」入口**；先跑通
`派单 → Ticket → Assignment → worker Session → report → 主会话`。
硬删 Source/Policy/Eval 是后续重构，不是 MVP。

## 两条实现路线

### A. 最小 ProjectSource（推荐）

把「用户在项目里的指令」变成一个 Trigger，复用现有 `receive → decide → Ticket` 全链路。

要改：
1. `src/sources/project.ts` 新增 `SourceKind`（kind=`project`）：
   - `schema`：空对象即可；
   - `fields`：空数组；
   - `health: []`；
   - 不提供 `channel` / `threadContext`（MVP 不需要）。
2. 在 bundle 的 `cordis.patch.yml` 注册该 Source 实例；禁用 `dsh-superagent-github`。
3. `policy.ts`：给 `project` kind 放行全部发件人（MVP）。
4. 主会话新增工具 `project_dispatch({title, task, skills[]})`：写一条 Trigger
   （`source: 'project'`, `actor: 'user'`, `text: task`），再 `engine.decide(accept)`。

### B. Engine 级 dispatch（更小，但偏离架构）

1. `src/core/tickets.ts` 新增 `createDirect(id, request, skills, at)`：
   不依赖 Trigger 引用的建单路径（参考 `create()` 第 36–56 行）。
2. `src/core/engine.ts` 暴露 `dispatch(...)`，加入 `EngineForMainSession`。
3. `src/app/tools/main.ts` 注册 `project_dispatch` 工具。

风险：与现有 Evals/Policy 两套建单逻辑并存。

## 技能分配（两条路线都要）

1. `Ticket` 增加 `skills?: readonly string[]`（`src/core/model.ts`）。
2. `project_dispatch` 把 `skills` 写入 Ticket。
3. `src/app/sessions.ts` 创建 worker Session 时把技能列表注入：
   - 优先：会话级 skill 白名单配置（需确认 `@deepseek-ai/dsh-skill-filesystem` 是否支持 per-session 过滤）；
   - 兜底：写进 assignment 文本，让模型只使用列出的技能。
4. worker 的 `orchestrator_report` 已有，无需改。

## 验证

```bash
export PATH="/c/Users/Soren/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
cd project-agent-src
node "<pnpm.mjs>" run typecheck
node "<pnpm.mjs>" run build
```

端到端：启动 DSH → 主会话发一句派单 → 观察 worker Session 被创建、执行、回报。

## 未决问题

- per-session 技能白名单是否被 `dsh-skill` 支持（决定技能是真隔离还是提示词约束）。
- 主会话是否要彻底关掉 bash（目前 preset 只关了 fs 的 write/edit）。
- 子会话在侧栏如何呈现（已加 `sidebar.projects` 槽，需要 client 插件）。
