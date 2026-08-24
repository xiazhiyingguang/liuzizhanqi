import { afterEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { useGameStore } from '../../src/store/game-store';
import { libaiSkill1, libaiSkill2 } from '../../src/data/extended-skills';
import { getSkill } from '../../src/data/skills';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('李太白技能与天威', () => {
    afterEach(() => vi.restoreAllMocks());

    it('技能1对十字内单体造成7伤害并获得一层醉意', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        const result = SkillSystem.executeSkill(libai, libaiSkill1, [[2, 3]], state);
        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([7]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 7);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(1);
    });

    it('技能1打不到斜角目标', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [3, 3]);
        const result = SkillSystem.executeSkill(libai, libaiSkill1, [[3, 3]], state);
        expect(result.success).toBe(false);
        expect(enemy.currentHp).toBe(enemy.maxHp);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(0);
    });

    it('技能2按方向2x3矩形造成醉意x4伤害并清空醉意', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [1, 3]);
        const enemyB = addHero(state, 'baize', 'player2', [2, 4]);
        EffectManager.setCounter(libai, '醉意', 2);
        libai.counters['__libai_skill2_dir'] = 3; // 面向右
        const result = SkillSystem.executeSkill(libai, libaiSkill2, [], state);
        expect(result.success).toBe(true);
        // 面向右：row 1-3、col 3-4，A[1,3] 与 B[2,4] 都在矩形内
        expect(result.damageDealt).toEqual([8, 8]);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(0);
    });

    it('技能2未选方向或醉意不足时失败', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [2, 3]);
        const noDir = SkillSystem.executeSkill(libai, libaiSkill2, [], state);
        expect(noDir.success).toBe(false);
        libai.counters['__libai_skill2_dir'] = 3;
        const noZuiyi = SkillSystem.executeSkill(libai, libaiSkill2, [], state);
        expect(noZuiyi.success).toBe(false);
    });

    it('天威：击杀敌人后获得2点醉意', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        const damage = DamageCalculator.calculate(libai, victim, 5);
        DamageCalculator.applyDamage(victim, damage, libai, state);
        expect(victim.state).toBe(HeroState.DEAD);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(2);
    });

    it('醉意上限为4层：技能1与天威叠加都不会超过4', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        EffectManager.setCounter(libai, '醉意', 4);
        // 技能1在满层时不再叠加
        SkillSystem.executeSkill(libai, libaiSkill1, [[2, 3]], state);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(4);

        // 天威 +2 同样封顶：击杀敌人后仍为 4
        const victim = addHero(state, 'baize', 'player2', [3, 4]);
        victim.currentHp = 1;
        const damage = DamageCalculator.calculate(libai, victim, 5);
        DamageCalculator.applyDamage(victim, damage, libai, state);
        expect(victim.state).toBe(HeroState.DEAD);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(4);
    });

    it('历史位置跨回合滚动：回合1无记录、回合2一个、回合3两个', () => {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        expect(libai.counters['__libai_prev_pos']).toBeUndefined();
        // 回合1结束在 [2,2]
        GameEngine.startNewTurn(state);
        expect(libai.counters['__libai_prev_pos']).toBe(2 * 6 + 2);
        expect(libai.counters['__libai_prev2_pos']).toBeUndefined();
        // 回合2结束在 [3,3]
        libai.position = [3, 3];
        state.board[2][2] = null;
        state.board[3][3] = libai;
        GameEngine.startNewTurn(state);
        expect(libai.counters['__libai_prev_pos']).toBe(3 * 6 + 3);
        expect(libai.counters['__libai_prev2_pos']).toBe(2 * 6 + 2);
    });
});

describe('李太白被动链（store 状态机）', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
        vi.restoreAllMocks();
    });

    function loadBattle() {
        const state = makeGameState();
        const libai = addHero(state, 'libai', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [2, 3]);
        addHero(state, 'baize', 'player2', [1, 2]);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false,
            libaiChainState: undefined,
        });
        return libai;
    }

    it('技能后进入链，瞬移攻击，全部用完自动归位', () => {
        const libai = loadBattle();
        // 模拟上回合结束位置 [1,3]
        libai.counters['__libai_prev_pos'] = 1 * 6 + 3;
        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 3]); // 打右侧敌人

        let state = useGameStore.getState();
        expect(state.libaiChainState).toBeTruthy();
        expect(state.libaiChainState?.pending).toEqual([[1, 3]]);
        expect(libai.hasActedThisTurn).toBe(false);

        // 瞬移到历史位置
        useGameStore.getState().selectLibaiChainPosition([1, 3]);
        state = useGameStore.getState();
        expect(libai.position).toEqual([1, 3]);
        expect(state.libaiChainState?.pending).toEqual([]);

        // 链中再攻击左侧敌人 [1,2]
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([1, 2]);
        state = useGameStore.getState();
        // pending 空 -> 自动归位到主位置 [2,2] 并结束行动
        expect(libai.position).toEqual([2, 2]);
        expect(state.libaiChainState).toBeUndefined();
        expect(libai.hasActedThisTurn).toBe(true);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(2);
    });

    it('跳过攻击后可继续选下一个历史位置，全部跳过则归位', () => {
        const libai = loadBattle();
        libai.counters['__libai_prev_pos'] = 1 * 6 + 3;
        libai.counters['__libai_prev2_pos'] = 4 * 6 + 2; // [4,2]
        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        let state = useGameStore.getState();
        expect(state.libaiChainState?.pending).toEqual([[1, 3], [4, 2]]);

        // 瞬移到 [1,3] 后跳过攻击
        useGameStore.getState().selectLibaiChainPosition([1, 3]);
        useGameStore.getState().skipLibaiChainAttack();
        state = useGameStore.getState();
        expect(state.libaiChainState?.pending).toEqual([[4, 2]]);
        expect(state.skillRange).toEqual([[4, 2]]);

        // 瞬移到 [4,2] 后跳过攻击 -> pending 空 -> 归位
        useGameStore.getState().selectLibaiChainPosition([4, 2]);
        useGameStore.getState().skipLibaiChainAttack();
        state = useGameStore.getState();
        expect(libai.position).toEqual([2, 2]);
        expect(state.libaiChainState).toBeUndefined();
        expect(libai.hasActedThisTurn).toBe(true);
    });

    it('链状态点击结束行动直接归位', () => {
        const libai = loadBattle();
        libai.counters['__libai_prev_pos'] = 1 * 6 + 3;
        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 3]);
        expect(useGameStore.getState().libaiChainState).toBeTruthy();

        useGameStore.getState().endHeroAction();
        const state = useGameStore.getState();
        expect(libai.position).toEqual([2, 2]);
        expect(state.libaiChainState).toBeUndefined();
        expect(libai.hasActedThisTurn).toBe(true);
    });

    it('建链后必须先瞬移历史位置才能再次施法，禁止原地无限出手', () => {
        const libai = loadBattle();
        libai.counters['__libai_prev_pos'] = 1 * 6 + 3;
        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 3]); // 首次施法，进入链

        let state = useGameStore.getState();
        expect(state.libaiChainState?.awaitingPosition).toBe(true);

        // 等待瞬移阶段：再次点技能被拒绝
        useGameStore.getState().selectSkill('libai_skill1');
        expect(useGameStore.getState().selectedSkill).toBeNull();

        // 直连 executeSkill（联机回放等路径）同样被拦截，pending 未被消耗
        const skill = getSkill('libai_skill1');
        expect(skill).toBeTruthy();
        useGameStore.setState({ selectedSkill: skill });
        useGameStore.getState().executeSkill([1, 2]);
        state = useGameStore.getState();
        // 守卫提前返回：技能未被执行（醉意未增加、pending 未消耗），selectedSkill 保持原样
        expect(state.libaiChainState?.pending).toEqual([[1, 3]]);
        expect(libai.counters['醉意']).toBe(1); // 没有额外出手

        // 瞬移到历史位置后恢复攻击资格
        useGameStore.getState().selectLibaiChainPosition([1, 3]);
        useGameStore.getState().selectSkill('libai_skill1');
        expect(useGameStore.getState().selectedSkill?.id).toBe('libai_skill1');
    });

    it('链中不允许普通移动与撤回移动', () => {
        const libai = loadBattle();
        libai.counters['__libai_prev_pos'] = 1 * 6 + 3;
        useGameStore.getState().selectHeroForAction(libai);
        // 先移动到 [3,3]（与莫兰 [2,3] 相邻），再施法建立链
        useGameStore.getState().showMoveRange();
        useGameStore.getState().moveHero([3, 3]);
        expect(libai.position).toEqual([3, 3]);
        expect(libai.hasMovedThisTurn).toBe(true);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 3]);
        expect(useGameStore.getState().libaiChainState?.home).toEqual([3, 3]);

        // 链进行中：普通移动被拒绝
        useGameStore.getState().showMoveRange();
        expect(useGameStore.getState().moveRange).toEqual([]);
        // 撤回移动也被拒绝：位置不变、链仍存活
        useGameStore.getState().undoMove();
        expect(libai.position).toEqual([3, 3]);
        expect(useGameStore.getState().libaiChainState).toBeTruthy();
    });
});
