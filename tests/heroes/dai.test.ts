import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { chooseComputerSkillPlan, chooseComputerStasisReviveTarget } from '../../src/core/computer-ai';
import { daiSkill1, daiSkill2 } from '../../src/data/extended-skills';
import { getSkill } from '../../src/data/skills';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { HeroState, type GameState } from '../../src/types/game';
import { addHero, killOffBoard, makeGameState } from '../helpers/game-state';

/** 模拟回合推进（endTurn 私有：roundNumber++ 后 startNewTurn） */
function advanceRound(state: ReturnType<typeof makeGameState>, times = 1): void {
    for (let i = 0; i < times; i++) {
        state.roundNumber++;
        GameEngine.startNewTurn(state);
    }
}

/** 以致命伤害击杀目标（走完整 applyDamage → handleDeath 链路） */
function killWith(
    state: ReturnType<typeof makeGameState>,
    attacker: ReturnType<typeof addHero>,
    victim: ReturnType<typeof addHero>,
): void {
    const damage = DamageCalculator.calculate(attacker, victim, 999);
    DamageCalculator.applyDamage(victim, damage, attacker, state);
}

describe('时空旅者·戴尔', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('以天师45生命、3移动接入两项技能与被动，且无天威', () => {
        const state = makeGameState();
        const hero = addHero(state, 'dai', 'player1', [2, 2]);

        expect(hero).toMatchObject({
            name: '时空旅者·戴尔',
            class: '天师',
            maxHp: 45,
            currentHp: 45,
            moveRange: 3,
            baseAttack: 0,
            skill1Id: 'dai_skill1',
            skill2Id: 'dai_skill2',
            passiveId: 'dai_passive',
        });
        expect(hero.tianweiId).toBeUndefined();
    });

    it('回合开始为所有存活单位建立生命与效果快照，死亡单位不入册', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const ally = addHero(state, 'baize', 'player1', [1, 2]);
        const fallen = addHero(state, 'guying', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [4, 4]);
        dai.currentHp = 40;
        killOffBoard(fallen);

        GameEngine.startNewTurn(state);

        expect(state.heroSnapshots?.[dai.id]).toMatchObject({ hp: 40 });
        expect(state.heroSnapshots?.[ally.id]).toMatchObject({ hp: ally.maxHp });
        expect(state.heroSnapshots?.[enemy.id]).toMatchObject({ hp: enemy.maxHp });
        expect(state.heroSnapshots?.[fallen.id]).toBeUndefined();
    });

    it('时空回溯把高于快照的友方生命拉回回合开始时的数值', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const ally = addHero(state, 'baize', 'player1', [1, 2]); // 40 血
        state.heroSnapshots = { [ally.id]: { hp: 38, effects: [] } };
        ally.currentHp = 25;

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[1, 2]], state);

        expect(output.success).toBe(true);
        expect(ally.currentHp).toBe(38);
    });

    it('时空回溯对低于快照的单位走治疗路径并计入治疗量', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const ally = addHero(state, 'baize', 'player1', [1, 2]); // 40 血
        ally.currentHp = 10;
        state.heroSnapshots = { [ally.id]: { hp: 30, effects: [] } };

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[1, 2]], state);

        expect(output.success).toBe(true);
        expect(ally.currentHp).toBe(30);
        const healed = (output.healingDone ?? []).reduce((sum, amount) => sum + amount, 0);
        expect(healed).toBeGreaterThan(0);
    });

    it('时空回溯同时还原效果状态，可找回被移除的效果', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [3, 3]);
        state.heroSnapshots = {
            [enemy.id]: {
                hp: enemy.maxHp,
                effects: [{
                    id: 'test_mark',
                    type: 'debuff',
                    name: '时光裂隙',
                    duration: 3,
                    sourceHeroId: dai.id,
                    description: '测试用标记',
                }],
            },
        };
        enemy.effects = [];

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[3, 3]], state);

        expect(output.success).toBe(true);
        expect(EffectManager.hasEffect(enemy, '时光裂隙')).toBe(true);
    });

    it('时空回溯拒绝通灵角色', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const wangcai = addHero(state, 'wangcai', 'player2', [3, 3]);
        state.heroSnapshots = {
            [wangcai.id]: { hp: wangcai.currentHp - 5, effects: [] },
        };

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[3, 3]], state);

        expect(output.success).toBe(false);
        expect(wangcai.currentHp).toBe(wangcai.maxHp);
    });

    it('目标没有快照记录时时空回溯失败', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [3, 3]);

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[3, 3]], state);

        expect(output.success).toBe(false);
        expect(enemy.currentHp).toBe(enemy.maxHp);
    });

    it('我方单位阵亡时进入时空停滞，死亡位置保留供复活点选', () => {
        const state = makeGameState(); // 回合 1
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);

        killWith(state, enemy, friend);

        expect(friend.state).toBe(HeroState.DEAD);
        expect(friend.counters['__dai_stasis_until']).toBe(2);
        expect(friend.position).toEqual([0, 0]);
        expect(state.board[0][0]).toBeNull();
        expect(dai).toBeDefined();
    });

    it('下个回合内锚定残影后可在任意空格唤回，生命回到致命一击之前', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        friend.currentHp = 10; // 10 血挨下致命一击 → 复活回 10 血

        killWith(state, enemy, friend);
        expect(friend.counters['__dai_hp_before_lethal']).toBe(10);

        advanceRound(state); // 进入回合 2，停滞未过期

        expect(friend.counters['__dai_stasis_until']).toBe(2);
        expect(GameEngine.reviveFromStasis(friend, [3, 3], state)).toBe(true);
        expect(friend.state).toBe(HeroState.ALIVE);
        expect(friend.currentHp).toBe(10);
        expect(friend.position).toEqual([3, 3]);
        expect(state.board[3][3]).toBe(friend);
        expect(friend.hasActedThisTurn).toBe(false);
        expect(friend.counters['__dai_revived_once']).toBe(1);
        expect(friend.counters['__dai_stasis_until']).toBeUndefined();
        expect(friend.counters['__dai_stasis_pos']).toBeUndefined();
        expect(friend.counters['__dai_hp_before_lethal']).toBeUndefined();
        expect(dai.state).toBe(HeroState.ALIVE);
    });

    it('落点被占据时唤回失败且不消耗额度，改点空格即可', () => {
        const state = makeGameState();
        addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);
        advanceRound(state);

        // 死亡原位被人占住：新交互不再自动就近落位，而是让玩家换一格
        state.board[5][5] = null;
        enemy.position = [0, 0];
        state.board[0][0] = enemy;

        expect(GameEngine.reviveFromStasis(friend, [0, 0], state)).toBe(false);
        expect(friend.state).toBe(HeroState.DEAD);
        expect(friend.counters['__dai_revived_once']).toBeUndefined();
        expect(friend.counters['__dai_stasis_until']).toBe(2);

        expect(GameEngine.reviveFromStasis(friend, [0, 3], state)).toBe(true);
        expect(friend.position).toEqual([0, 3]);
        expect(state.board[0][3]).toBe(friend);
    });

    it('场上满编四名存活时不得唤回', () => {
        const state = makeGameState();
        addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);
        advanceRound(state);
        addHero(state, 'feixue', 'player1', [1, 0]);
        addHero(state, 'guying', 'player1', [1, 1]);
        addHero(state, 'hanjiangxue', 'player1', [1, 2]);

        expect(GameEngine.countRealAliveOnBoard(state, 'player1')).toBe(4);
        expect(GameEngine.reviveFromStasis(friend, [0, 0], state)).toBe(false);
        expect(friend.state).toBe(HeroState.DEAD);
    });

    it('通灵角色既不进入时空停滞，也无法被判定为可唤回', () => {
        const state = makeGameState();
        addHero(state, 'dai', 'player1', [2, 2]);
        const wangcai = addHero(state, 'wangcai', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);

        killWith(state, enemy, wangcai);

        expect(wangcai.state).toBe(HeroState.DEAD);
        expect(wangcai.counters['__dai_stasis_until']).toBeUndefined();
        expect(GameEngine.isInStasis(wangcai, state.roundNumber)).toBe(false);
    });

    it('唤回回来的单位即时补录快照，对其用时空回溯不再报"没有记录"', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        friend.currentHp = 12;
        killWith(state, enemy, friend);

        advanceRound(state); // 回合开始时友方已阵亡，本轮快照里没有它
        expect(state.heroSnapshots?.[friend.id]).toBeUndefined();

        expect(GameEngine.reviveFromStasis(friend, [3, 3], state)).toBe(true);
        expect(state.heroSnapshots?.[friend.id]).toMatchObject({ hp: 12 });

        friend.currentHp = 4;
        const output = SkillSystem.executeSkill(dai, daiSkill1, [[3, 3]], state);

        expect(output.success).toBe(true);
        expect(friend.currentHp).toBe(12);
    });

    it('跨越停滞期限后计数器被清理且无法再复活', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);
        expect(friend.counters['__dai_stasis_until']).toBe(2);

        advanceRound(state, 2); // 进入回合 3，超过期限

        expect(friend.counters['__dai_stasis_until']).toBeUndefined();
        expect(friend.counters['__dai_stasis_pos']).toBeUndefined();
        expect(state.battleLog.some(entry => entry.message.includes('时空停滞消散'))).toBe(true);

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[0, 0]], state);
        expect(output.success).toBe(false);
    });

    it('停滞尚未被清理但已过期限时，时空回溯拒绝复活', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);
        expect(friend.counters['__dai_stasis_until']).toBe(2);
        state.roundNumber = 3; // 已过期限，但尚未经过 startNewTurn 清理

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[0, 0]], state);

        expect(output.success).toBe(false);
        expect(friend.state).toBe(HeroState.DEAD);
    });

    it('戴尔自身阵亡不会进入时空停滞', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);

        killWith(state, enemy, dai);

        expect(dai.state).toBe(HeroState.DEAD);
        expect(dai.counters['__dai_stasis_until']).toBeUndefined();
    });

    it('分身与召唤物不进入时空停滞', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const clone = addHero(state, 'baize', 'player1', [0, 1]);
        const summon = addHero(state, 'guying', 'player1', [0, 2]);
        clone.counters['__isClone'] = 1;
        summon.counters['__isSummon'] = 1;
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);

        killWith(state, enemy, clone);
        killWith(state, enemy, summon);

        expect(clone.state).toBe(HeroState.DEAD);
        expect(summon.state).toBe(HeroState.DEAD);
        expect(clone.counters['__dai_stasis_until']).toBeUndefined();
        expect(summon.counters['__dai_stasis_until']).toBeUndefined();
    });

    it('已经复活过的英雄再次阵亡不再获得时空停滞', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        friend.counters['__dai_revived_once'] = 1;

        killWith(state, enemy, friend);

        expect(friend.state).toBe(HeroState.DEAD);
        expect(friend.counters['__dai_stasis_until']).toBeUndefined();
    });

    it('场上没有戴尔时友方阵亡不进入时空停滞', () => {
        const state = makeGameState();
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);

        killWith(state, enemy, friend);

        expect(friend.state).toBe(HeroState.DEAD);
        expect(friend.counters['__dai_stasis_until']).toBeUndefined();
    });

    it('时空置换交换两名单位的位置与生命百分比', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const first = addHero(state, 'baize', 'player1', [1, 1]); // 40 血模板
        const second = addHero(state, 'feixue', 'player1', [4, 4]); // 45 血模板
        first.maxHp = 50;
        first.currentHp = 40; // 80%
        second.maxHp = 40;
        second.currentHp = 20; // 50%

        const output = SkillSystem.executeSkill(dai, daiSkill2, [[1, 1], [4, 4]], state);

        expect(output.success).toBe(true);
        expect(first.position).toEqual([4, 4]);
        expect(second.position).toEqual([1, 1]);
        expect(state.board[4][4]).toBe(first);
        expect(state.board[1][1]).toBe(second);
        expect(first.currentHp).toBe(25); // 50% × 50
        expect(second.currentHp).toBe(32); // 80% × 40
        expect(dai.counters['dai_skill2_cd']).toBe(2);
    });

    it('时空置换不能选择同一个单位两次', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const first = addHero(state, 'baize', 'player1', [1, 1]);

        const output = SkillSystem.executeSkill(dai, daiSkill2, [[1, 1], [1, 1]], state);

        expect(output.success).toBe(false);
        expect(first.position).toEqual([1, 1]);
        expect(first.currentHp).toBe(first.maxHp);
    });

    it('时空置换释放后冷却两回合推进节奏，期间无法再次释放', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const first = addHero(state, 'baize', 'player1', [1, 1]);
        const second = addHero(state, 'feixue', 'player1', [4, 4]);

        const ok = SkillSystem.executeSkill(dai, daiSkill2, [[1, 1], [4, 4]], state);
        expect(ok.success).toBe(true);
        expect(dai.counters['dai_skill2_cd']).toBe(2);

        const blockedSameTurn = SkillSystem.executeSkill(dai, daiSkill2, [[1, 1], [4, 4]], state);
        expect(blockedSameTurn.success).toBe(false);

        advanceRound(state); // 冷却 2 → 1
        expect(dai.counters['dai_skill2_cd']).toBe(1);
        const blockedNextTurn = SkillSystem.executeSkill(dai, daiSkill2, [[1, 1], [4, 4]], state);
        expect(blockedNextTurn.success).toBe(false);

        advanceRound(state); // 冷却 1 → 0
        expect(dai.counters['dai_skill2_cd']).toBe(0);
        const readyAgain = SkillSystem.executeSkill(dai, daiSkill2, [[1, 1], [4, 4]], state);
        expect(readyAgain.success).toBe(true);
    });
});

describe('时空旅者·戴尔 · 两段式唤回（store 交互）', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    /** 把纯 GameState 灌进 store，覆盖掉上一条用例留下的挂起态 */
    function loadIntoStore(state: GameState) {
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            suppressOnlineBroadcast: false,
            moveRange: [],
            skillRange: [],
            highlightedPositions: [],
            selectedHero: null,
            selectedSkill: null,
            pendingBoardAction: undefined,
            daiReviveHeroId: undefined,
        });
    }

    /** 造一个"友方已阵亡、停滞未过期"的战场 */
    function makeStasisScene(reviveHp = 12) {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        friend.currentHp = reviveHp;
        killWith(state, enemy, friend);
        advanceRound(state);
        loadIntoStore(state);
        return { state, dai, friend, enemy };
    }

    it('锚定残影后高亮全盘空格作为复活落点，且不含已占格', () => {
        const { dai, friend } = makeStasisScene();
        const store = useGameStore.getState();
        store.selectHeroForAction(dai);
        store.selectSkill('dai_skill1');

        useGameStore.getState().selectDaiReviveTarget(friend.id);

        const after = useGameStore.getState();
        expect(after.daiReviveHeroId).toBe(friend.id);
        expect(after.skillRange).toContainEqual([3, 3]);
        expect(after.skillRange).toContainEqual([0, 0]); // 死亡原位依然可选
        expect(after.skillRange).not.toContainEqual([2, 2]);
        expect(after.moveRange).toEqual([]);
        expect(friend.state).toBe(HeroState.DEAD); // 锚定本身不落人
    });

    it('点空格完成唤回：复活到致命一击前的生命并消耗本回合行动', () => {
        const { dai, friend } = makeStasisScene(12);
        const store = useGameStore.getState();
        store.selectHeroForAction(dai);
        store.selectSkill('dai_skill1');
        useGameStore.getState().selectDaiReviveTarget(friend.id);

        useGameStore.getState().executeSkill([3, 3]);

        const after = useGameStore.getState();
        expect(friend.state).toBe(HeroState.ALIVE);
        expect(friend.currentHp).toBe(12);
        expect(after.board[3][3]).toBe(friend);
        expect(after.daiReviveHeroId).toBeUndefined();
        expect(after.skillRange).toEqual([]);
        expect(dai.hasActedThisTurn).toBe(true);
        expect(friend.counters['__dai_revived_once']).toBe(1);
        expect(after.battleLog.some(entry => entry.message.includes('唤回'))).toBe(true);
    });

    it('落点落在已占格时只提示不改状态，行动仍可继续', () => {
        const { dai, friend, enemy } = makeStasisScene();
        const store = useGameStore.getState();
        store.selectHeroForAction(dai);
        store.selectSkill('dai_skill1');
        useGameStore.getState().selectDaiReviveTarget(friend.id);

        useGameStore.getState().executeSkill(enemy.position!);

        const after = useGameStore.getState();
        expect(after.battleLog[after.battleLog.length - 1]?.message).toContain('复活落点必须是空格');
        expect(friend.state).toBe(HeroState.DEAD);
        expect(after.daiReviveHeroId).toBe(friend.id);
        expect(dai.hasActedThisTurn).toBe(false);

        useGameStore.getState().executeSkill([4, 1]);
        expect(useGameStore.getState().board[4][1]).toBe(friend);
    });

    it('只能锚定本方的停滞单位', () => {
        const state = makeGameState();
        const enemyDai = addHero(state, 'dai', 'player2', [5, 1]);
        const enemyFriend = addHero(state, 'baize', 'player2', [5, 4]);
        const myDai = addHero(state, 'dai', 'player1', [0, 0]);
        const victim = addHero(state, 'moran', 'player1', [1, 4]);
        enemyFriend.currentHp = 8;
        killWith(state, victim, enemyFriend);
        advanceRound(state);
        loadIntoStore(state);

        // 敌方戴尔锚自己的停滞单位：成立
        useGameStore.setState({ currentPlayer: 'player2' });
        useGameStore.getState().selectHeroForAction(enemyDai);
        useGameStore.getState().selectSkill('dai_skill1');
        useGameStore.getState().selectDaiReviveTarget(enemyFriend.id);
        expect(useGameStore.getState().selectedHero?.id).toBe(enemyDai.id);
        expect(useGameStore.getState().daiReviveHeroId).toBe(enemyFriend.id);

        // 本方戴尔去锚对面的残影：拒绝
        useGameStore.setState({ daiReviveHeroId: undefined, selectedSkill: null, currentPlayer: 'player1' });
        const mine = useGameStore.getState();
        mine.selectHeroForAction(myDai);
        mine.selectSkill('dai_skill1');
        mine.selectDaiReviveTarget(enemyFriend.id);
        expect(useGameStore.getState().daiReviveHeroId).toBeUndefined();
    });
});

describe('时空旅者·戴尔 · 电脑唤回决策', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    /** 清空快照：让"回溯存活单位"整条分支必然失败，只剩唤回是有效方案 */
    function dropSnapshots(state: GameState) {
        state.heroSnapshots = {};
    }

    it('锚定对象取复活后最能打的那一个', () => {
        const state = makeGameState();
        addHero(state, 'dai', 'player1', [2, 2]);
        const strong = addHero(state, 'baize', 'player1', [0, 0]);
        const weak = addHero(state, 'baize', 'player1', [0, 1]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        strong.currentHp = 30;
        weak.currentHp = 8;
        killWith(state, enemy, strong);
        killWith(state, enemy, weak);
        advanceRound(state);

        expect(chooseComputerStasisReviveTarget(state, 'player1')?.id).toBe(strong.id);
    });

    it('唤回方案的首点是空格落点，不是任何已占格', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        friend.currentHp = 14;
        killWith(state, enemy, friend);
        advanceRound(state);
        dropSnapshots(state);

        const plan = chooseComputerSkillPlan(state, dai, 'dai_skill1');

        expect(plan).not.toBeNull();
        const [row, col] = plan!.targetPositions[0];
        expect(state.board[row][col]).toBeNull();
    });

    it('满编四名存活时不再生成唤回方案', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);
        advanceRound(state);
        dropSnapshots(state);
        addHero(state, 'feixue', 'player1', [1, 0]);
        addHero(state, 'guying', 'player1', [1, 1]);
        addHero(state, 'hanjiangxue', 'player1', [1, 2]);

        expect(chooseComputerStasisReviveTarget(state, 'player1')).toBeNull();
        expect(chooseComputerSkillPlan(state, dai, 'dai_skill1')).toBeNull();
    });

    it('电脑分两步执行唤回：一步锚定残影，一步点空格落位', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        friend.currentHp = 14;
        killWith(state, enemy, friend);
        advanceRound(state);
        dropSnapshots(state);
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            isAiMode: false,
            reinforcingPlayer: null,
            currentPlayer: 'player1',
            selectedHero: dai,
            activeHero: dai,
            selectedSkill: getSkill('dai_skill1'),
            moveRange: [],
            skillRange: [],
            highlightedPositions: [],
            pendingBoardAction: undefined,
            daiReviveHeroId: undefined,
        });

        runComputerBattleStep('player1');
        expect(useGameStore.getState().daiReviveHeroId).toBe(friend.id);
        expect(friend.state).toBe(HeroState.DEAD);

        runComputerBattleStep('player1');
        expect(friend.state).toBe(HeroState.ALIVE);
        expect(friend.currentHp).toBe(14);
        expect(useGameStore.getState().daiReviveHeroId).toBeUndefined();
    });
});
