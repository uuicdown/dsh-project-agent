# 项目三栏 UI 规格（H1 + 状态排序）

> 决策（2026-11-07）：层级用 H1 —— 项目 > 主会话 > 子会话；工作区降为路径属性。
> 子会话按状态排序：待回答 > 失败/受阻 > 进行中 > 完成。

## 侧栏结构

```
▾ <项目名>                          [项目行]
   ● 主会话 · 调度台          N 单    [主会话行，置顶]
     ├ ◦ <工单标题>  状态点  [子会话行，缩进]
     ├ ◦ ...
     └ ◦ ...
   ▸ 未派单的会话                    [原生浏览器接管]
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

`/orchestrator/api/state` 需要新增（或提供新端点）：

```json
{
  "projects": [
    {
      "id": "p_xxx",
      "name": "dsh 插件开发",
      "mainSessionId": "orchestrator-…",
      "tickets": [
        {
          "id": "dispatch-…",
          "title": "凭据迁移",
          "stage": "working",
          "workerSessionId": "worker-dispatch-…",
          "skills": ["gongwen"],
          "model": { "provider": "deepseek-account", "model": "deepseek-flash" },
          "updatedAt": "2026-11-07T…"
        }
      ]
    }
  ]
}
```

## 实现步骤

1. **Host 侧**：`src/app/http.ts` 的 state 路由补 `tickets`（目前只有 setup/load/masterId/paused/health）；字段来自 `store.tickets.open()` + `ticketStage`。
2. **Worker 目录隔离**：ticket 目录固定在 `stateDir/work/<ticket>`；侧栏隐藏这类 workspace（或在 client 侧过滤 `--…-projtest-state--` 之外的工单目录）。
3. **Client 侧**：`src/client/index.tsx` 增加 `ctx.slots.inject('sidebar.projects', …)` 注册，渲染上面的树；复用 `provider.tsx` 的轮询与 `marks.ts` 的状态映射。
4. **排序**：客户端按 stage 权重排序，同权重按 `updatedAt`。
5. **原生浏览器**：只保留「未派单的会话」，即不属于任何 ticket 的会话。

## 验收

- 侧栏出现「项目 > 主会话 > 子会话」三层，主会话带「主」徽标。
- 派单后子会话立即出现，状态点随 report 变化。
- 子会话不出现在工作区分组里。
- 待回答的工单排在最前。
