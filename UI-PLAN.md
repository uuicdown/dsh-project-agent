# 项目三栏 UI 规格（H1 + 状态排序）

> 决策（2026-11-07）：层级用 H1 —— 项目 > 主会话 > 子会话；工作区降为路径属性。
> 子会话按状态排序：待回答 > 失败/受阻 > 进行中 > 完成。
>
> 决策（2026-11-09）：**不再接管普通会话**。用户手动新开的会话保持标准模式（不换 preset、不给插件工具），
> 项目由插件自动开一个专属 **Router 会话**（`router-<projectId>`，标题 `Router · <项目名>`，目录 = 项目目录）；
> 侧栏三层 项目 → Router 会话 → 子会话（worker），**子会话默认折叠**。项目行展开显示 Router 会话。
> 升级前已被插件接管（已是 router preset）的老会话继续作为 Router 工作，不会被丢下。
>
> 决策（2026-11-10）：**派单按相关性复用子会话**。主会话（Router）判断新任务与已有子会话是否相关：相关则沿用该子会话，
> 不相关则在本项目下新建子会话；**不跨项目复用**，本项目没有相关子会话时就新建。子会话一次只服务一张工单，
> 侧栏仍按工单列出，同一子会话对应多张工单时点任一行进入同一个 Session。

## 侧栏结构

```
▾ <项目名>                          [项目行，默认展开]
     ● Router 会话            主     [Router 会话行，点开即进入该项目的会话]
       ▸ 子会话 3                   [默认折叠；点开列出 worker]
         ◦ <工单标题>  状态点       [子会话行，点开进入 worker Session]
   未归属                            [不属于任何项目的工单，直接列出]
     ◦ ...
```

## 视觉规则

| 元素 | 规则 |
| --- | --- |
| 项目行 | 实心方块图标 + 项目名；右侧悬停显示 `+ 新会话`、`⋯` 设置 |
| 主会话 | 前置实心 ●，带「主」徽标；行高比子会话大 2px；常驻置顶 |
| 子会话 | 缩进 20px，左侧 1px 竖线连接；图标为工单形状 |
| 状态点 | 待回答 ⚠ 黄；失败/受阻 ● 红；进行中 ● 蓝；完成 ✓ 绿 |
| 子会话副行 | `skills · model` 小标签（如 `gongwen · flash`），不显示目录 |
| 目录 | 只在 hover 卡片显示完整路径 |

## 排序

1. 待回答（attention）
2. 失败 / 受阻
3. 进行中（running / queued）
4. 完成（ended）

同级按 `updatedAt` 倒序。

## 数据需求

`GET /orchestrator/api/projects` 每项带上该项目的 Router 会话 id（由项目 id 推出，不另存记录）；
`GET /orchestrator/api/tickets` 的每行已有 `sessionId`（worker 会话）与 `projectId`，侧栏据此组装三层。

```json
{
  "items": [
    {
      "id": "project-…",
      "name": "dsh 插件开发",
      "path": "C:\\…\\default-workspace",
      "sessionId": "router-project-…",
      "tickets": [
        {
          "id": "dispatch-…",
          "title": "凭据迁移",
          "stage": "working",
          "sessionId": "worker-dispatch-…",
          "skills": ["gongwen"]
        }
      ]
    }
  ]
}
```

## 实现步骤

1. **Host 侧**：`src/app/projects.ts` 提供 `routerSessionId` / `isRouterSession` / `routerTitle` / `projectView` / `projectByPath`。
2. **会话归属**：`src/app/sessions.ts` 只装饰插件自己打开的会话（master 与 `router-*`）；普通会话不再被接管。
3. **自动创建**：`src/app/runtime.ts` 在用户新开项目会话时（`agent/created`，standalone）为该项目开 Router 会话；
   启动时为已有项目补齐；`project_dispatch` 也会补齐。
4. **Client 侧**：`src/client/projects-sidebar.tsx` 渲染三层树，子会话默认折叠；点行进入对应 Session。
5. **排序**：客户端按 stage 权重排序。

## 验收

- 用户手动新开的会话保持标准 preset，插件不给它加工具或提示词。
- 每个项目有且只有一个 Router 会话，标题 `Router · <项目名>`，改项目名后标题跟着改。
- 侧栏出现「项目 > Router 会话 > 子会话」三层，子会话默认折叠，点开才列出 worker。
- 派单后子会话立即出现，状态点随 report 变化。
- 待回答的工单排在最前。
