import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseComputerSkillPlan, chooseComputerShangguanDash, setComputerAiDifficulty, simulateComputerMove } from '../../src/core/computer-ai';
import { getSkill } from '../../src/data/skills';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { getXiangStepMovePlans, getLeapsUsed, setLeapsUsed } from '../../src/core/xuanyuan-form';
import { addSwordMitigation, placeFlyingSword } from '../../src/core/flying-sword';
import { useGameStore } from '../../src/store/game-store';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { HeroState, type GameState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

beforeEach(() => {
    useGameStore.getState().resetGame();
    setComputerAiDifficulty('master');
    DamageCalculator.setBattleRound(1);
    vi.spyOn(Math, 'random').mockReturnValue(.99);
});
afterEach(() => vi.restoreAllMocks());

function brush(state: GameState, row: number, col: number, sourceHeroId: string) {
    state.boardEffects ??= [];
    state.boardEffects.push({ id: `brush-${row}-${col}`, type: 'brush', position: [row, col], owner: 'player1', sourceHeroId, duration: 3 });
}

describe('婉儿连冲的真实短程规划', () => {
    it('先借毛笔再转向收割，而不是贪眼前的一次6伤害', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [4, 1]);
        addHero(state, 'moran', 'player2', [4, 2]);
        const victim = addHero(state, 'baize', 'player2', [1, 4]);
        victim.currentHp = 1;
        brush(state, 2, 1, hero.id);
        const before = structuredClone(state);
        const plan = chooseComputerSkillPlan(state, hero, hero.skill2Id);
        expect(plan?.targetPositions[0]).toEqual([3, 1]);
        expect(plan?.score).toBeGreaterThan(200);
        expect(state).toEqual(before);
    });

    it('实际步进器会执行借笔起手并在下一段重新收割', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [4, 1]);
        addHero(state, 'moran', 'player2', [4, 2]);
        const victim = addHero(state, 'baize', 'player2', [1, 4]);
        victim.currentHp = 1;
        brush(state, 2, 1, hero.id);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero,
            selectedSkill: getSkill(hero.skill2Id)!, isAiMode: true, isOnlineMode: false });
        runComputerBattleStep('player1');
        expect(hero.position).toEqual([1, 1]);
        expect(useGameStore.getState().shangguanDashState?.hitTargets).toContain('brush-2-1');
        runComputerBattleStep('player1');
        expect(victim.state).toBe(HeroState.DEAD);
    });

    it('连续命中记录阻挡旧目标，不会假想再次穿回已经命中的敌人', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        state.shangguanDashState = { heroId: hero.id, hitTargets: [enemy.id] };
        expect(chooseComputerShangguanDash(state, hero)).toBeNull();
        expect(state.shangguanDashState.hitTargets).toContain(enemy.id);
    });

    it('只剩无收益的毛笔时收手，不为借力而空转', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [4, 1]);
        addHero(state, 'baize', 'player2', [0, 5]);
        brush(state, 2, 1, hero.id);
        expect(chooseComputerShangguanDash(state, hero)?.score ?? 0).toBeLessThanOrEqual(0);
    });

    it('使用真实减伤和护盾，而不是把6血敌人一律当作可斩杀', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [2, 2]);
        const tough = addHero(state, 'moran', 'player2', [2, 4]);
        tough.currentHp = 6;
        tough.shield = 20;
        tough.defense = .5;
        const victim = addHero(state, 'baize', 'player2', [0, 2]);
        victim.currentHp = 2;
        expect(chooseComputerShangguanDash(state, hero)?.targetPositions[0]).toEqual([1, 2]);
    });

    it('反击先让婉儿死亡时，不能因模拟中断而把危险样本丢掉', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [2, 2]);
        hero.currentHp = 1;
        addHero(state, 'baize', 'player1', [5, 5]);
        const counter = addHero(state, 'zhenxiao', 'player2', [2, 4]);
        getSkill('zhenxiao_skill2')!.execute!(counter, [], state);
        const plan = chooseComputerShangguanDash(state, hero);
        expect(plan).not.toBeNull();
        expect(plan!.score).toBeLessThan(0);
        expect(hero.currentHp).toBe(1);
        expect(hero.state).toBe(HeroState.ALIVE);
    });

    it.each(['easy', 'normal', 'master'] as const)('%s 难度：规划不写入原盘、不消耗实战随机数', difficulty => {
        setComputerAiDifficulty(difficulty);
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 4]);
        const before = structuredClone(state);
        vi.mocked(Math.random).mockClear();
        expect(chooseComputerShangguanDash(state, hero)).not.toBeNull();
        expect(Math.random).not.toHaveBeenCalled();
        expect(state).toEqual(before);
    });
});

describe('轩辕新对角连跳的 AI 规划', () => {
    function scene(position: [number, number] = [2, 2]) {
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', position);
        hero.counters['昭神'] = 1;
        addHero(state, 'baize', 'player2', [0, 0]);
        addHero(state, 'liuli', 'player2', [5, 5]);
        for (const plan of getXiangStepMovePlans(hero.position!)) placeFlyingSword(state, hero, plan.to);
        return { state, hero };
    }

    it.each([[1, 1], [2, 2], [3, 3], [4, 4]] as [number, number][])('从 (%s,%s) 出发仅生成合法对角单点候选', (row, col) => {
        const { state, hero } = scene([row, col]);
        const audit = { candidates: [] as Array<{ skillId: string; score: number; targets: [number, number][] }>, chosen: null };
        chooseComputerSkillPlan(state, hero, hero.skill1Id, audit);
        expect(audit.candidates.length).toBeGreaterThan(0);
        for (const candidate of audit.candidates) {
            expect(candidate.targets).toHaveLength(1);
            const [r, c] = candidate.targets[0];
            expect(Math.abs(r - row)).toBe(Math.abs(c - col));
            expect([1, 2]).toContain(Math.abs(r - row));
            expect(state.board[r][c]).toBeNull();
        }
        expect(hero.position).toEqual([row, col]);
    });

    it('规划给出的落点可以直接执行，无需旧的起笔点击', () => {
        const { state, hero } = scene();
        const plan = chooseComputerSkillPlan(state, hero, hero.skill1Id)!;
        hero.counters.__extended_target = plan.targetPositions[0][0] * 6 + plan.targetPositions[0][1];
        expect(getSkill(hero.skill1Id)!.execute!(hero, [], state).success).toBe(true);
        expect(getLeapsUsed(hero)).toBe(1);
    });

    it('已完成三跳时不生成第四跳，不把失败动作当成收益', () => {
        const { state, hero } = scene();
        setLeapsUsed(hero, 3);
        expect(chooseComputerSkillPlan(state, hero, hero.skill1Id)).toBeNull();
    });
});

describe('镜花：移动前后保持一致的换身使用记录', () => {
    it('执行器用评分方案中的落点换人，而非重新挑一个与计划不同的安全角落', () => {
        const state = makeGameState({ player1BenchHeroIds: ['moran'] });
        const hero = addHero(state, 'jinghua', 'player1', [2, 2]);
        hero.counters['镜影'] = 3;
        hero.currentHp = 12;
        addHero(state, 'liuli', 'player1', [5, 0]);
        addHero(state, 'baize', 'player2', [2, 4]);
        const plan = chooseComputerSkillPlan(state, hero, hero.skill2Id)!;
        expect(plan?.score).toBeGreaterThan(0);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero,
            selectedSkill: getSkill(hero.skill2Id)!, isAiMode: true, isOnlineMode: false });
        runComputerBattleStep('player1');
        expect(hero.state).toBe(HeroState.TEMP_DEAD);
        const spawned = useGameStore.getState().board[plan.targetPositions[0][0]][plan.targetPositions[0][1]];
        expect(spawned?.skill1Id).toBe('moran_skill1');
    });

    it('移动模拟保留累计施法次数，不把用过两次的换身重新算成第一次', () => {
        const state = makeGameState({ player1BenchHeroIds: ['moran'] });
        const hero = addHero(state, 'jinghua', 'player1', [2, 2]);
        hero.counters['镜影'] = 3;
        addHero(state, 'liuli', 'player1', [5, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);
        state.battleStatistics![hero.id] = { damageDealt: 10, damageTaken: 20, healingDone: 0, shieldAbsorbed: 0, kills: 0, skill2Casts: 2 };
        const predicted = simulateComputerMove(state, hero, [2, 3])!;
        expect(predicted.battleStatistics?.[hero.id].skill2Casts).toBe(2);
        expect(chooseComputerSkillPlan(predicted, predicted.player1Heroes[0], hero.skill2Id)).toBeNull();
    });
});

describe('轩辕归元必须有实际防护或回剑输出收益', () => {
    it('远处没有敌人威胁、回剑也打不到人时不空转归元', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [2, 2]);
        addHero(state, 'mowen', 'player2', [5, 5]);
        placeFlyingSword(state, hero, [1, 1]);
        expect(chooseComputerSkillPlan(state, hero, hero.skill2Id)).toBeNull();
    });

    it('敌人能打到自己时，仍然会回剑护身', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [2, 3]);
        placeFlyingSword(state, hero, [1, 1]);
        expect(chooseComputerSkillPlan(state, hero, hero.skill2Id)?.score).toBeGreaterThan(0);
    });

    it('免伤已经覆盖实际伤害且未临近过期时，不追求无效的面板叠层', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [2, 2]);
        addSwordMitigation(hero, 20);
        addHero(state, 'moran', 'player2', [2, 3]);
        placeFlyingSword(state, hero, [1, 1]);
        expect(chooseComputerSkillPlan(state, hero, hero.skill2Id)).toBeNull();
    });

    it('防护将到期时允许刷新，不把有意义的续盾一起禁掉', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [2, 2]);
        addSwordMitigation(hero, 20);
        hero.effects.find(effect => effect.name === '御剑免伤')!.duration = 1;
        addHero(state, 'moran', 'player2', [2, 3]);
        placeFlyingSword(state, hero, [1, 1]);
        expect(chooseComputerSkillPlan(state, hero, hero.skill2Id)?.score).toBeGreaterThan(0);
    });

    it('昭神附剑下一轮能从友军身边射中敌人时仍有进攻价值', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [0, 0]);
        hero.counters['昭神'] = 1;
        addHero(state, 'liuli', 'player1', [4, 3]);
        addHero(state, 'baize', 'player2', [4, 2]);
        placeFlyingSword(state, hero, [4, 4]);
        expect(chooseComputerSkillPlan(state, hero, hero.skill2Id)?.score).toBeGreaterThan(0);
    });
});

describe('不同新角色的真实 AI 出手冒烟', () => {
    it.each(['wangshu', 'zhiyuan', 'xihuan', 'duosui', 'yunxiu', 'aoyuan', 'tingyuan', 'zhiguang',
        'jinghong', 'huanongying', 'nanfeng', 'dilan', 'daizong', 'damo', 'xiangyu'])('%s：能规划并在真实步进器中兑现技能', id => {
        const state = makeGameState();
        const hero = addHero(state, id, 'player1', [2, 2]);
        const ally = addHero(state, 'liuli', 'player1', [2, 3]);
        // 羲和满血且没有盈光时应当允许空过；这里给真实治疗需求，不能把合理跳过当故障。
        if (id === 'xihuan') ally.currentHp = 8;
        addHero(state, 'baize', 'player2', [1, 3]);
        addHero(state, 'moran', 'player2', [3, 3]);
        const plan = chooseComputerSkillPlan(state, hero);
        expect(plan, `${hero.name}未能生成可用技能方案`).not.toBeNull();
        expect(plan!.score).toBeGreaterThan(0);
        expect(Number.isFinite(plan!.score)).toBe(true);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero,
            selectedSkill: null, isAiMode: true, isOnlineMode: false });
        let casts = 0;
        for (let step = 0; step < 16 && casts === 0 && !hero.hasActedThisTurn; step++) {
            runComputerBattleStep('player1');
            const stats = useGameStore.getState().battleStatistics?.[hero.id];
            casts = (stats?.skill1Casts ?? 0) + (stats?.skill2Casts ?? 0);
        }
        expect(casts, `${hero.name}有方案却没有真正结算技能`).toBeGreaterThan(0);
    });
});
