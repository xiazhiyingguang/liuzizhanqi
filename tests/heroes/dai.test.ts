import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { daiSkill1, daiSkill2 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
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

    it('下个回合内点击死亡位置可将停滞友方满血复活', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);

        advanceRound(state); // 进入回合 2，停滞未过期

        expect(friend.counters['__dai_stasis_until']).toBe(2);
        const output = SkillSystem.executeSkill(dai, daiSkill1, [[0, 0]], state);

        expect(output.success).toBe(true);
        expect(friend.state).toBe(HeroState.ALIVE);
        expect(friend.currentHp).toBe(friend.maxHp);
        expect(friend.position).toEqual([0, 0]);
        expect(state.board[0][0]).toBe(friend);
        expect(friend.hasActedThisTurn).toBe(false);
        expect(friend.counters['__dai_revived_once']).toBe(1);
        expect(friend.counters['__dai_stasis_until']).toBeUndefined();
        expect(friend.counters['__dai_stasis_pos']).toBeUndefined();
    });

    it('复活位置被占时落到最近的空位', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const friend = addHero(state, 'baize', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        killWith(state, enemy, friend);

        advanceRound(state); // 进入回合 2，停滞未过期

        // 复活前，敌人的单位移动占据了友方的死亡位置
        state.board[5][5] = null;
        enemy.position = [0, 0];
        state.board[0][0] = enemy;

        const output = SkillSystem.executeSkill(dai, daiSkill1, [[0, 0]], state);

        expect(output.success).toBe(true);
        expect(friend.state).toBe(HeroState.ALIVE);
        expect(friend.position).not.toBeNull();
        expect(friend.position).not.toEqual([0, 0]);
        expect(state.board[friend.position![0]][friend.position![1]]).toBe(friend);
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
