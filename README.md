# PF2E XP 预算工具

PF2e 系统的遭遇 XP 预算可视化工具，支持精英/弱小模板预览与多策略补差值方案。

## 安装

在 Foundry → **附加模块 → 安装模块** 中粘贴 manifest URL：

```
https://github.com/takaqiao/pf2e-xp-tool/releases/latest/download/module.json
```

兼容性：Foundry VTT v12 ~ v14，PF2e 系统。

## 用法

启用模组后，侧边栏 **宏 (Macros)** 与 **角色 (Actors)** 标签底部会出现 `📐 PF2E XP 预算工具` 蓝色按钮（仅 GM 可见）。

工作流：
1. 在场景中选中要测量的怪物 token（可选 PC token；若无 PC 会弹窗询问队伍人数/等级）
2. 点击按钮 → 工具窗口打开
3. 顶部显示队伍人数 / 等级 / 威胁等级 / 总 XP，进度条标出 4 人等效预算位置
4. 每只怪卡片有 `[弱][普][精]` 切换，实时预览 XP 影响
5. 下方"推荐方案"区按操作数升序展示前 N 个精确补差值组合：
   - **调整** - 仅切换现有怪的精英/弱小模板
   - **添加 / 移除** - 增减若干新怪
   - **复合** - 同时调整 + 加/减
6. 卡片右上 `[预览此方案]` 一键把所有相关 NPC 的 preview 设到方案对应模板
7. 底部 `[应用 N 项模板更改]` 写回 actor

## 设计说明

- **target 锁定为打开瞬间 baseline**：切换 preview 不会让目标跑动；只在你改 partySize/Level 时调整
- **默认只显示精确方案**：勾选"显示近似方案"或在完全无精确解时自动 fallback
- **操作数定义**：1 个精英/弱小切换 = 1 操作；加/减一只怪 = 1 操作（多只多操作）

也可在宏中调用：

```javascript
PF2EXPTool.open();
```

## 发布流程

见 [RELEASE_PROCESS.md](./RELEASE_PROCESS.md)。

## License

MIT
