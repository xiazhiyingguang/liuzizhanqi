import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { chooseComputerSkillPlan, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { battleActorFor, runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { GameEngine } from '../../src/core/game-engine';
import type { Position } from '../../src/types/game';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import { placeLamp, lampShadows, SHADOW_TRANSFER_KEY } from '../../src/core/lamp-shadow';
import { placeShuangfeiyanBoomerang } from '../../src/core/boomerang';
import { setWenrenPos, setWenrenWaypoint, getWenrenWaypoint } from '../../src/core/wenren-form';
import { getXiangStepMovePlans } from '../../src/core/xuanyuan-form';
import { placeFlyingSword } from '../../src/core/flying-sword';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { getSkill } from '../../src/data/skills';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { getHeroAbilityRatings } from '../../src/data/hero-ratings';

beforeEach(() => {
    useGameStore.getState().resetGame();
    setComputerAiDifficulty('master');
    DamageCalculator.setBattleRound(1);
    vi.spyOn(Math, 'random').mockReturnValue(.99);
});
afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

describe('PR #1 选择性接入', () => {
    it.each(['wenren', 'shuangfeiyan', 'xiyueci'])('%s 可选、有完整图鉴、雷达评分与两个主动技能', id => {
        expect(AVAILABLE_HERO_IDS).toContain(id);
        const entry = HERO_CODEX.find(hero => hero.id === id)!;
        expect(entry).toBeDefined();
        expect(getHeroAbilityRatings(entry.name)).toBeDefined();
        const state = makeGameState();
        const hero = addHero(state, id, 'player1', [2, 2]);
        expect(getSkill(hero.skill1Id)).toBeDefined();
        expect(getSkill(hero.skill2Id)).toBeDefined();
        expect(hero.passiveId).toBe(`${id}_passive`);
    });

    it.each(['wenren', 'shuangfeiyan', 'xiyueci'])('%s 在有灯影的局面规划不改真盘，模拟不掷真实随机数', id => {
        const state = makeGameState();
        const hero = addHero(state, id, 'player1', [2, 1]);
        const lampOwner = addHero(state, 'xiyueci', 'player1', [0, 0]);
        addHero(state, 'baize', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [1, 3]);
        addHero(state, 'liuli', 'player2', [4, 4]);
        placeLamp(state, lampOwner, [2, 3]);
        if (id === 'wenren') setWenrenPos(hero, 8);
        const before = structuredClone(state);
        const random = vi.mocked(Math.random);
        random.mockClear();
        const first = { candidates: [], chosen: null };
        expect(chooseComputerSkillPlan(state, hero, undefined, first)).not.toBeNull();
        expect(state).toEqual(before);
        // 本地宗师策略最后对同分候选抽签一次，只有这一次属于真实决策；推演不消耗真实随机流。
        expect(random).toHaveBeenCalledTimes(1);
        random.mockReturnValue(.01).mockClear();
        const second = { candidates: [], chosen: null };
        chooseComputerSkillPlan(state, hero, undefined, second);
        expect(first.candidates).toEqual(second.candidates);
        expect(random).toHaveBeenCalledTimes(1);
        expect(state.player2Heroes.every(enemy => enemy.counters[SHADOW_TRANSFER_KEY] === undefined)).toBe(true);
    });

    it('三名角色接入后，轩辕使用后续确认的新对角跳规则', () => {
        const state = makeGameState();
        const caster = addHero(state, 'xuanyuan', 'player1', [2, 2]);
        caster.counters['昭神'] = 1;
        addHero(state, 'moran', 'player2', [2, 3]);
        addHero(state, 'baize', 'player2', [5, 5]);
        for (const plan of getXiangStepMovePlans(caster.position!)) placeFlyingSword(state, caster, plan.to);
        const audit = { candidates: [], chosen: null };
        chooseComputerSkillPlan(state, caster, caster.skill1Id, audit);
        expect(audit.candidates.length).toBeGreaterThan(0);
        expect(audit.candidates.every((plan: { targets: number[][] }) => plan.targets.length === 1
            && Math.abs(plan.targets[0][0] - 2) === Math.abs(plan.targets[0][1] - 2))).toBe(true);
        expect(getXiangStepMovePlans([3, 3]).map(plan => plan.to))
            .toEqual([[2, 2], [2, 4], [4, 2], [4, 4], [1, 1], [1, 5], [5, 1], [5, 5]]);
    });

    it('闻人 AI 从选中技能真正完成两段点击，而不是只会计算方案', () => {
        const state = makeGameState();
        const hero = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'baize', 'player1', [0, 4]);
        const enemy = addHero(state, 'moran', 'player2', [1, 4]);
        useGameStore.setState({ ...state, isAiMode: true, isOnlineMode: false, selectedHero: hero,
            activeHero: hero, selectedSkill: getSkill(hero.skill1Id)!, skillRange: [[0, 4]], moveRange: [] });
        runComputerBattleStep('player1');
        expect(getWenrenWaypoint(hero)).toEqual([0, 4]);
        expect(hero.position).toEqual([0, 2]);
        runComputerBattleStep('player1');
        expect(hero.position).toEqual([0, 5]);
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(getWenrenWaypoint(hero)).toBeNull();
    });

    it('JSON 联机快照保留中途点、回旋镖返航序号及灯影推导需要的信息', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 1]);
        const swallows = addHero(state, 'shuangfeiyan', 'player1', [4, 1]);
        const lampOwner = addHero(state, 'xiyueci', 'player1', [1, 1]);
        addHero(state, 'baize', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [3, 3]);
        setWenrenWaypoint(wenren, [2, 2]);
        setWenrenPos(wenren, 8);
        const blade = placeShuangfeiyanBoomerang(state, swallows, [4, 4])!;
        blade.returnAtSkillSerial = 3;
        placeLamp(state, lampOwner, [2, 3]);
        useGameStore.setState({ ...state, isOnlineMode: true, localPlayerNumber: 1, onlineRoomId: 'ROOM-1234' });
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        useGameStore.setState({ isOnlineMode: true, localPlayerNumber: 2, onlineRoomId: 'ROOM-1234' });
        applyServerGameState(snapshot);
        const received = useGameStore.getState();
        expect(received.localPlayerNumber).toBe(2);
        expect(getWenrenWaypoint(received.player1Heroes[0])).toEqual([2, 2]);
        expect(received.board[2][1]).toBe(received.player1Heroes[0]);
        expect(received.boardEffects?.find(effect => effect.type === 'boomerang')?.returnAtSkillSerial).toBe(3);
        expect(lampShadows(received).map(shadow => shadow.cell)).toContainEqual([4, 3]);
    });

    it.each([false, true])('新角色混合阵容完整对战不死锁（换边=%s）', swapped => {
        const state = makeGameState({ matchId: `pr1-fullgame-${swapped}` });
        const newcomers = ['wenren', 'shuangfeiyan', 'xiyueci', 'xuanxiao'];
        const veterans = ['moran', 'liuli', 'baize', 'wukong'];
        const positions: Position[][] = [[[2, 1], [3, 1], [1, 0], [4, 0]], [[2, 4], [3, 4], [1, 5], [4, 5]]];
        [swapped ? veterans : newcomers, swapped ? newcomers : veterans].forEach((team, side) => {
            team.forEach((id, index) => addHero(state, id, side === 0 ? 'player1' : 'player2', positions[side][index]));
        });
        GameEngine.startNewTurn(state);
        useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: true, aiDifficulty: 'master', autoBattle: true });
        let previous = '';
        let repeats = 0;
        let steps = 0;
        while (useGameStore.getState().phase === 'battle' && steps < 2000) {
            const current = useGameStore.getState();
            const signature = JSON.stringify([current.currentPlayer, current.roundNumber, current.actionsThisTurn,
                current.activeHero?.id, current.selectedSkill?.id, current.skillRange, current.pendingBoardAction,
                current.player1Heroes, current.player2Heroes, current.boardEffects]);
            repeats = signature === previous ? repeats + 1 : 0;
            previous = signature;
            expect(repeats, 'AI 连续重复操作').toBeLessThan(20);
            runComputerBattleStep(battleActorFor(current), repeats);
            for (const player of ['player1', 'player2'] as const) {
                expect(GameEngine.countRealAliveOnBoard(useGameStore.getState(), player)).toBeLessThanOrEqual(4);
            }
            steps++;
        }
        const ended = useGameStore.getState();
        expect(ended.phase, `步骤=${steps}，回合=${ended.roundNumber}`).toBe('ended');
        expect(ended.winner).toMatch(/^player[12]$/);
        const casts = Object.values(ended.battleStatistics ?? {})
            .reduce((sum, statistics) => sum + (statistics.skill1Casts ?? 0) + (statistics.skill2Casts ?? 0), 0);
        expect(casts).toBeGreaterThan(0);
    }, 60_000);
});
