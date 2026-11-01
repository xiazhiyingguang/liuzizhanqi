# AI 新旧策略回归

轩辕接入新对角跳机制后，旧 G 型基线不能直接混比。请用支持新机制的版本，例如
`node scripts/ai/compare-policies.mjs --ref origin/pr-1 --case complex`。
下面旧工作区快照的命令保留为历史复现说明，不适用于当前规则。

运行 `node scripts/ai/compare-policies.mjs`，以及
`node scripts/ai/compare-policies.mjs --mirror`。

- 基线策略从 `git show <ref>:src/core/computer-ai.ts` 读取，默认 HEAD；可用 `--ref <commit>` 固定旧版。
- 旧、新策略及其操作执行器均通过独立模块执行，不让旧策略意外享受到新版执行器的修复；不检出、不覆盖工作区。
- 对局使用当前同一套战斗规则，随机种子为 20261023；每组阵容由新版轮流执掌玩家一和玩家二。
- 每局从引擎首轮初始化开始，避免跨局激战倍率和首轮被动影响比较。
- 普通模式覆盖 7 组不同体系；`--mirror` 让双方采用同一阵容，减少英雄强弱对策略比较的干扰。
- `--case melee|magic|undead|terrain|complex|newcomers|new-support` 可单独复查一组，也可用逗号分隔多组。
- 结果位于 `reports/ai-optimization/policy-comparison*.json`，包含基线提交、胜负、轮次、耗时、兜底次数和实际技能释放次数。
- 另有献祭全灭、终局评分、婉儿借笔、轩辕方向锁定和镜花换人次数的固定战术对照；专项单元测试位于 `tests/core/computer-ai-{safety,movement,random,new-heroes}.test.ts`。

限制：这是小规模回归，不是统计显著的胜率评测。两侧对策略和伤害使用随机数的次数不同，固定种子不意味着实战每次暴击/闪避逐一相同；应结合换边、多个体系和机制断言判断，不能只凭单局胜负调参。

## 比较相邻两轮的工作区策略

本轮开始时保留的只读基线快照位于 `reports/ai-optimization/new-heroes-baseline.ts` 和
`reports/ai-optimization/new-heroes-baseline-hook.ts`（报告目录被 Git 忽略，不会打包到游戏）。

```powershell
node scripts/ai/compare-policies.mjs --case complex,newcomers,new-support --mirror --baseline-file reports/ai-optimization/new-heroes-baseline.ts --baseline-hook-file reports/ai-optimization/new-heroes-baseline-hook.ts
```

两个快照必须一起提供。结果记录基线与当前策略哈希；`newcomers`、`new-support` 带两名替补，用来覆盖镜花换人、补员和多阶段控制权流转。
