# 修复问题总结报告

本文件记录了在上一轮对话中修复的游戏逻辑问题、数值调整及功能优化。请在新的对话中参考此文档继续开发。

## 1. 核心机制修复

### 1.1 伤害计算机制重构
- **问题**：原伤害计算公式叠加了英雄基础攻击力（BaseAttack），导致实际伤害与设计不符（如墨阑技能1造成13点伤害而非8点）。
- **修复**：
  - 将所有英雄的 `baseAttack` 属性重置为 **0** (`src/data/heroes.ts`)。
  - 将所有技能的 `scalesWithAttack` 属性设为 `false` (`src/data/skills.ts`)。
  - 确保伤害完全由技能配置的 `baseDamage` 决定。

### 1.2 额外行动系统 (Extra Action)
- **结论**：墨阑机制当前实现基本正确，后续尽量不要再改动此段逻辑。
- **原始问题**：
  - `pendingExtraActionHeroId` 曾是 `gameState` 上的单个槽位，双方都能写入，双墨阑在同一流程内频繁触发时容易互相覆盖，体感像“循环/无限安排额外行动”。
  - 额外行动需要点两次“结束行动”：第一次结束正常行动并进入额外行动；第二次才结束额外行动并回到正常流程。
- **修复内容**：
  - **按玩家分槽位（防覆盖）**：
    - 将单槽位改为 `pendingExtraActionHeroIds?: Partial<Record<Player, string>>`，每个玩家各自记录待插入的额外行动英雄ID（`src/types/game.ts`）。
    - 在 `endHeroAction` 中消费额外行动时，会优先消费当前行动方对应槽位，其次才消费对方槽位；消费后清空对应槽位，若两边都空则置为 `undefined`（`src/core/game-engine.ts`）。
  - **自动结束额外行动（不需要二次结束）**：
    - 当处于额外行动且移动的是当前额外行动英雄时，移动成功后自动调用 `endHeroAction`，直接结束额外行动并恢复/切回正常行动流程（`src/store/game-store.ts` 的 `moveHero`）。
  - **墨阑触发写入正确槽位**：
    - 墨阑被动“为道”和天威触发额外行动时，写入 `pendingExtraActionHeroIds[hero.owner] = hero.id`，保证双方互不干扰（`src/data/heroes.ts`）。

### 1.3 胜利条件判定
- **问题**：旧逻辑在一方有英雄阵亡时可能误判游戏结束，或者未正确处理所有单位死亡的情况。
- **修复**：
  - 修正 `GameEngine.checkWinCondition`，现在仅当一方**所有英雄**的状态均为 `DEAD` 时才判定失败。

## 2. 英雄技能修正

### 2.1 墨阑 (Moran)
- **数值调整**：
  - 技能1基础伤害修正为 **8**。
  - 技能2基础伤害修正为 **12**。
- **日志修复**：
  - 修复了技能造成伤害后战斗日志缺失的问题，现在能完整记录“墨阑使用技能X对Y造成Z点伤害”。

### 2.2 震霄 (Zhenxiao)
- **技能1范围修正**：
  - **原逻辑**：理解有误。
  - **新逻辑**：实现为“消耗20%当前生命，对**选择方向的面前横排3格**（如右侧方向则为目标列的3个垂直格）造成8点固定伤害”。
  - 代码位置：`src/core/movement-system.ts` 中的 `getZhenxiaoSkill1Positions` 方法。
- **反击机制 (`金银错`)**：
  - **问题**：震霄在未开启“金银错”状态下也会触发反击。
  - **修复**：在 `heroes.ts` 的被动技能逻辑中增加检查，只有当英雄拥有 `金银错` buff 时才触发反击。

## 3. UI 与体验优化

### 3.1 界面布局 (`src/components/Game/BattleScene.tsx`)
- 增大了底部操作区和战斗日志的高度（调整为 `h-96`），以便容纳更多信息，同时保持棋盘大小不变。

### 3.2 战斗日志格式 (`src/data/skills.ts`)
- 统一了日志格式模板：`{英雄名}使用技能{技能名}对{目标名}造成{数值}点伤害`。

## 4. 关键文件变更清单

建议在接手后重点关注以下文件：

1.  **`src/core/game-engine.ts`**
    - 包含回合流转、额外行动处理 (`endHeroAction`)、胜利判定 (`checkWinCondition`) 的核心逻辑。
2.  **`src/store/game-store.ts`**
    - 包含 UI 交互逻辑，特别是 `selectHeroForAction` 和 `executeSkill` 的状态同步。
3.  **`src/data/skills.ts`**
    - 包含所有技能的具体实现（`execute` 方法）、数值配置及日志记录。
4.  **`src/data/heroes.ts`**
    - 包含英雄基础属性（攻击力置0）及被动技能实现（震霄反击、墨阑被动）。
5.  **`src/core/movement-system.ts`**
    - 包含震霄特殊的技能范围计算逻辑。

## 5. 遗留/注意事项
- **测试建议**：建议重点测试墨阑在单回合内连续触发多次额外行动的边界情况，确保“3次限制”生效且不会导致游戏卡死。
- **扩展性**：目前所有伤害均不关联基础攻击力，如后续需引入“攻击力buff”，需重新评估 `scalesWithAttack` 标志位的处理。

---

## 6. 本轮对话新增与修改内容（悟空/白泽相关）

### 6.1 孙悟空技能二：分身可移动后再攻击
- **需求**：悟空使用技能二时，分身也应当可以“先移动一格再攻击”，并且所有已选定目标在结束行动时都要正常结算。
- **实现要点**：
  - 在 `game-store` 中为悟空技能二新增内部状态：
    - `WukongSkill2State` 增加 `cloneMovedById: Record<string, boolean>` 字段，用于记录每个分身本回合是否已经移动过。
  - 修改技能二交互流程：
    - 悟空本体释放技能二时，先进入 `move` 阶段，只能向周围一格的空位移动一次，然后进入 `pickWukongTarget` 阶段选择本体攻击目标。
    - 若场上存在悟空分身，则依次进入 `pickCloneTarget` 阶段，对每个分身：
      - 允许先向周围一格空位移动一次（仅限一次），移动后重新计算其可攻击范围。
      - 再为该分身选择一格内敌方单位作为攻击目标。
  - 结束行动时的结算：
    - 调整 `endHeroAction` 中悟空技能二分支逻辑：若存在未结算的本体/分身攻击目标，则在结束行动时统一调用 `SkillSystem.executeSkill` 对所有已选目标结算伤害，而不会因为“跳过部分目标”导致整次技能无效。
- **主要改动文件**：
  - [game-store.ts](file:///d:/code/Game/six-chess-battle/src/store/game-store.ts#L11-L21)：定义悟空技能二阶段及状态结构。
  - [game-store.ts](file:///d:/code/Game/six-chess-battle/src/store/game-store.ts#L277-L397, file:///d:/code/Game/six-chess-battle/src/store/game-store.ts#L490-L775, file:///d:/code/Game/six-chess-battle/src/store/game-store.ts#L840-L888)：完善悟空技能二的移动/选目标/结算流程。

### 6.2 白泽技能二：复活逻辑修复（可多次复活）
- **原问题**：
  - 白泽技能二“天禄充足时复活阵亡单位”的逻辑中，只尝试复活死亡列表中的第一个单位：
    - 若该单位附近没有空位可用，`reviveDeadHero` 返回失败，技能直接失败，不会尝试其他已死亡的友军。
  - 玩家体感为：攒出第二次3层天禄后，有时无法再次复活队友。
- **修复方案（技能层）**：
  - 修改白泽技能二的 `execute` 实现（仅在“自动复活”场景使用）：
    - 遍历 `deadAllies` 列表，依次调用 `GameEngine.reviveDeadHero(target, 0.5, caster, gameState)`。
    - 找到第一个能够成功复活的目标后立即停止遍历并消耗3层天禄，若全部失败才返回技能失败并记录日志。
  - 该逻辑保证在“自动复活模式”下，只要场上有任意一名阵亡友军且存在空位，就能尽量完成复活。
- **主要改动文件**：
  - [skills.ts](file:///d:/code/Game/six-chess-battle/src/data/skills.ts#L70-L124)：`baizeSkill2.execute` 中将单一目标复活改为“遍历所有死亡友军寻找可复活目标”。

### 6.3 白泽技能二：玩家可选择复活位置
- **需求**：白泽在使用技能二复活队友时，复活位置应由玩家选择，而不是自动寻找最近空位。
- **引擎层扩展**：
  - 在 `GameEngine` 中拆分复活逻辑，新增加方法：
    - `reviveHeroAtPosition(hero, position, hpPercent, gameState): boolean`
      - 要求 `hero.state === HeroState.DEAD` 且 `position` 对应格子为空。
      - 按 `hpPercent` 计算复活生命值，设置英雄位置/状态，并落子到 `gameState.board[row][col]`。
      - 复用统一的战斗日志格式记录“某英雄在指定位置复活”。
  - 原有 `reviveDeadHero` 继续保留，内部改为：
    - 先用 `MovementSystem.findNearestEmptyPosition` 自动找最近空位；
    - 再调用 `reviveHeroAtPosition` 完成真正的复活操作。
- **UI/交互层改动**：
  - 在技能选取阶段（`selectSkill`）：
    - 当玩家选择白泽技能二，且白泽当前“天禄 ≥ 3”且存在至少一名阵亡友军时：
      - 扫描棋盘所有空位并高亮这些位置。
      - 输出系统日志提示：玩家需要在高亮空位中选择一格作为复活位置。
      - 只设置技能范围为“所有空位”，不直接执行技能逻辑。
  - 在技能执行阶段（`executeSkill`）：
    - 若当前技能为 `baize_skill2` 且“天禄 ≥ 3”：
      - 检查玩家点击的位置是否为空格，非空则提示“请选择一个空位置”并不消耗行动。
      - 从当前阵亡友军列表中选择一名目标（默认取第一个，后续可扩展为可选目标），调用：
        - `GameEngine.reviveHeroAtPosition(reviveTarget, targetPos, 0.5, state)` 在玩家指定的位置复活队友。
      - 复活成功后：
        - 消耗白泽身上的3层“天禄”。
        - 更新相应一方的 `deathCounters.playerXResurrections` 统计数据。
        - 标记白泽已行动，并通过 `GameEngine.endHeroAction` 正常结束行动与切换回合。
        - 清空高亮范围与已选技能，保持整体交互风格与其它技能一致。
    - 若“天禄不足3层”或“当前没有阵亡友军”，则不进入复活模式，白泽技能二退化为原本的“治疗血量最低友军”逻辑，由 `SkillSystem.executeSkill` 走通用技能流程。
- **主要改动文件**：
  - [game-engine.ts](file:///d:/code/Game/six-chess-battle/src/core/game-engine.ts#L8-L38)：引入 `reviveHeroAtPosition`，并重构 `reviveDeadHero` 使用该方法。
  - [game-store.ts](file:///d:/code/Game/six-chess-battle/src/store/game-store.ts#L399-L488)：在 `selectSkill` 中增加对白泽技能二的空位选择模式（高亮所有空格并提示玩家点击）。
  - [game-store.ts](file:///d:/code/Game/six-chess-battle/src/store/game-store.ts#L556-L775)：在 `executeSkill` 中增加对白泽技能二的“指定位置复活”执行分支，调用 `reviveHeroAtPosition` 并完成回合流转。
