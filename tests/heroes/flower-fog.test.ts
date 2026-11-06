import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import {
    FLOWER_SKILL1, FLOWER_SKILL2, flowerDecoyBodyId, flowerPlacementCells, flowerViewer,
    hiddenByFlowerFog, lockFlowerBody, placeFlowerDecoy, plantFlowerFog, startFlowerAction,
} from '../../src/core/flower-fog';
import { chooseFlowerAnswer, resolveFlowerChoice } from '../../src/data/flower-fog-skills';
import { getSkill } from '../../src/data/skills';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { getHeroAvatarUrl } from '../../src/data/hero-assets';
import { useGameStore, createOnlineStateSnapshot } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import { runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { HeroState, type Hero, type Player, type Position, type Skill } from '../../src/types/game';

const one = getSkill(FLOWER_SKILL1)!, two = getSkill(FLOWER_SKILL2)!;
const strike: Skill = {
    id: 'test-fog-strike', name: '刺击', description: '', type: 'damage',
    rangeType: 'single', range: 2, targetType: 'enemy', targetCount: 1, baseDamage: 8, canCrit: false,
};

function fixture(owner: Player = 'player1') {
    const state = makeGameState({ currentPlayer: owner });
    const hero = addHero(state, 'flower_fog', owner, [2, 2]);
    const foe = (pos: Position, hp = 40) => {
        const h = addHero(state, 'moran', owner === 'player1' ? 'player2' : 'player1', pos);
        h.defense = 0; h.currentHp = hp; h.passiveId = ''; h.tianweiId = '';
        return h;
    };
    const enter = (ai = false) => useGameStore.setState({
        ...state, selectedHero: hero, activeHero: hero, isOnlineMode: false, isAiMode: ai,
        aiPlayer: ai ? owner : undefined,
    });
    const hit = (attacker: Hero, target: Hero, amount: number) =>
        DamageCalculator.applyDamage(target, DamageCalculator.calculate(attacker, target, amount, false, false), attacker, state);
    return { state, hero, foe, enter, hit };
}

beforeEach(() => {
    useGameStore.getState().resetGame();
    DamageCalculator.setBattleRound(1);
    vi.spyOn(Math, 'random').mockReturnValue(.99);
});
afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

describe('雾里看花', () => {
    it('可选将、可查图鉴，50生命、移动2', () => {
        const { hero } = fixture();
        expect(AVAILABLE_HERO_IDS).toContain('flower_fog');
        expect(HERO_CODEX.some(entry => entry.id === 'flower_fog')).toBe(true);
        expect([hero.name, hero.maxHp, hero.moveRange]).toEqual(['雾里看花', 50, 2]);
    });

    it('随机本体锁定到落子，花影10生命、不是阵容成员，可选交换', () => {
        const { state, hero } = fixture();
        const body = addHero(state, 'moran', 'player1', [0, 0]);
        expect(lockFlowerBody(state, hero)).toBe(body);
        vi.mocked(Math.random).mockReturnValue(0);
        expect(lockFlowerBody(state, hero)).toBe(body);
        expect(flowerPlacementCells(state, hero)).not.toContainEqual([4, 4]);
        expect(SkillSystem.executeSkill(hero, one, [[0, 1]], state).success).toBe(true);
        const shadow = state.board[0][1]!;
        expect(flowerDecoyBodyId(shadow.id)).toBe(body.id);
        expect(getHeroAvatarUrl(shadow.id)).toBe(getHeroAvatarUrl(body.id));
        expect([shadow.currentHp, shadow.maxHp, state.player1Heroes.length]).toEqual([10, 10, 2]);
        expect(resolveFlowerChoice(state, hero, [0, 1])).toBe(true);
        expect(state.board[0].slice(0, 2)).toEqual([shadow, body]);
    });

    it('同一次主动群攻只掷一次换影，50%边界不换', () => {
        const { state, hero, foe, hit } = fixture();
        const a = foe([1, 1]), b = foe([1, 2]);
        const shadow = placeFlowerDecoy(state, hero, hero, [2, 3]);
        vi.mocked(Math.random).mockReturnValue(.5);
        DamageCalculator.withActiveSkill(hero, () => { hit(hero, a, 2); hit(hero, b, 2); });
        expect(hero.position).toEqual([2, 2]);
        vi.mocked(Math.random).mockReturnValue(.49);
        DamageCalculator.withActiveSkill(hero, () => { hit(hero, a, 2); hit(hero, b, 2); });
        expect([hero.position, shadow.position]).toEqual([[2, 3], [2, 2]]);
        expect([a.currentHp, b.currentHp]).toEqual([36, 36]);
    });

    it('击碎花影不传伤，也不记击杀或触发天威', () => {
        const { state, hero, foe, hit } = fixture();
        const body = foe([2, 3]), shadow = placeFlowerDecoy(state, body, body, [2, 4]);
        hit(hero, shadow, 4);
        expect([body.currentHp, shadow.currentHp]).toEqual([40, 6]);
        hit(hero, shadow, 20);
        expect([body.currentHp, shadow.state, hero.killCount, state.deathCounters.totalDead]).toEqual([40, HeroState.DEAD, 0, 0]);
        expect(state.board[2][4]).toBeNull();
        expect(state.boardEffects).toBeUndefined();
    });

    it('重施替换本人的旧花影与花雾，第二次轮转后消失', () => {
        const { state, hero, foe } = fixture(); foe([5, 5]);
        const old = placeFlowerDecoy(state, hero, hero, [2, 3]);
        const current = placeFlowerDecoy(state, hero, hero, [2, 4]);
        plantFlowerFog(state, hero, [2, 2]); plantFlowerFog(state, hero, [3, 3]);
        expect(old.state).toBe(HeroState.DEAD);
        expect(state.boardEffects?.map(e => e.position)).toEqual([[3, 3]]);
        state.roundNumber = 2; GameEngine.startNewTurn(state);
        expect(state.board[2][4]).toBe(current);
        expect(state.boardEffects?.[0].duration).toBe(1);
        state.roundNumber = 3; GameEngine.startNewTurn(state);
        expect(state.board[2][4]).toBeNull();
        expect(state.boardEffects).toEqual([]);
    });

    it('花雾只对敌方隐藏，主动出手后显形，下一次自己行动再隐藏', () => {
        const { state, hero, foe, hit } = fixture(), enemy = foe([2, 3]);
        plantFlowerFog(state, hero, [2, 2]);
        expect(hiddenByFlowerFog(hero, state, 'player1')).toBe(false);
        expect(hiddenByFlowerFog(hero, state, 'player2')).toBe(true);
        expect(hiddenByFlowerFog(enemy, state, 'player1')).toBe(false);
        expect(flowerViewer({ currentPlayer: 'player2', isOnlineMode: true, localPlayerNumber: 1 })).toBe('player1');
        DamageCalculator.withActiveSkill(hero, () => hit(hero, enemy, 4));
        expect(hiddenByFlowerFog(hero, state, 'player2')).toBe(false);
        startFlowerAction(state, hero);
        expect(hiddenByFlowerFog(hero, state, 'player2')).toBe(true);
    });

    it('单体可盲点空格并消耗出手，也能命中隐藏单位；群攻正常命中', () => {
        const { state, hero, foe } = fixture(), enemy = foe([2, 3]);
        plantFlowerFog(state, enemy, [2, 3]);
        expect(SkillSystem.executeSkill(hero, strike, [[1, 3]], state)).toMatchObject({ success: true, damageDealt: [] });
        expect(enemy.currentHp).toBe(40);
        expect(SkillSystem.executeSkill(hero, strike, [[2, 3]], state).success).toBe(true);
        expect(enemy.currentHp).toBe(32);
        expect(SkillSystem.executeSkill(hero, { ...strike, rangeType: 'area', areaSize: 3, targetCount: 'all' }, [[2, 3]], state).success).toBe(true);
        expect(enemy.currentHp).toBe(24);
    });

    it.each([false, true])('雾里藏刃：铺雾前已同雾=%s，分别造成7或10伤害', oldFog => {
        const { state, hero, foe } = fixture(), enemy = foe([2, 3]);
        if (oldFog) plantFlowerFog(state, hero, [2, 2]);
        expect(SkillSystem.executeSkill(hero, two, [[2, 2]], state).success).toBe(true);
        expect(enemy.currentHp).toBe(40);
        expect(chooseFlowerAnswer(state, hero)).toEqual(enemy.position);
        expect(resolveFlowerChoice(state, hero, enemy.position!)).toBe(true);
        expect(enemy.currentHp).toBe(oldFog ? 30 : 33);
    });

    it('铺雾、刺杀、天威移步只记同一个行动', () => {
        const { hero, foe, enter } = fixture();
        foe([2, 3], 6); foe([5, 5]); enter();
        useGameStore.getState().selectSkill(FLOWER_SKILL2);
        useGameStore.getState().executeSkill([2, 2]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('flower-stab');
        expect(useGameStore.getState().actionsThisTurn).toBe(0);
        useGameStore.getState().resolvePendingBoardAction([2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('flower-escape');
        expect(useGameStore.getState().boardEffects?.[0].position).toEqual([2, 3]);
        expect(useGameStore.getState().actionsThisTurn).toBe(0);
        useGameStore.getState().resolvePendingBoardAction([3, 4]);
        const final = useGameStore.getState();
        expect(final.pendingBoardAction).toBeUndefined();
        expect([final.actionsThisTurn, final.currentPlayer, hero.position]).toEqual([1, 'player2', [3, 4]]);
        expect(hiddenByFlowerFog(hero, final, 'player2')).toBe(true);
    });

    it('每轮仅第一次击杀落雾，后续轮可再触发', () => {
        const { state, hero, foe, hit } = fixture();
        const a = foe([2, 3], 1), b = foe([3, 3], 1), c = foe([3, 4], 1);
        hit(hero, a, 10);
        expect(resolveFlowerChoice(state, hero, hero.position!)).toBe(true);
        hit(hero, b, 10);
        expect(state.pendingBoardAction).toBeUndefined();
        expect(state.boardEffects?.[0].position).toEqual([2, 3]);
        state.roundNumber++;
        hit(hero, c, 10);
        expect(state.boardEffects?.[0].position).toEqual([3, 4]);
    });

    it('可以用结束行动只铺雾；最后一击直接结算胜负，不留移步选格', () => {
        const skip = fixture();
        const spared = skip.foe([2, 3]); skip.enter();
        useGameStore.getState().selectSkill(FLOWER_SKILL2);
        useGameStore.getState().executeSkill([2, 2]);
        useGameStore.getState().endHeroAction();
        expect(spared.currentHp).toBe(40);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(useGameStore.getState().actionsThisTurn).toBe(1);
        const win = fixture();
        win.foe([2, 3], 6); win.enter();
        useGameStore.getState().selectSkill(FLOWER_SKILL2);
        useGameStore.getState().executeSkill([2, 2]);
        useGameStore.getState().resolvePendingBoardAction([2, 3]);
        expect(useGameStore.getState()).toMatchObject({ phase: 'ended', winner: 'player1', pendingBoardAction: undefined });
    });

    it('快照恢复花影、花雾和换影选格，不把花影加入阵容', () => {
        const { state, hero, foe, enter } = fixture();
        foe([5, 5]); plantFlowerFog(state, hero, [2, 2]); enter();
        useGameStore.getState().selectSkill(FLOWER_SKILL1);
        useGameStore.getState().executeSkill([2, 3]);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        const restored = useGameStore.getState();
        expect(restored.player1Heroes).toHaveLength(1);
        expect(flowerDecoyBodyId(restored.board[2][3]!.id)).toBe(hero.id);
        expect(restored.pendingBoardAction?.type).toBe('flower-swap');
        expect(restored.boardEffects?.[0].type).toBe('flower-fog');
        useGameStore.getState().resolvePendingBoardAction([2, 3]);
        expect(useGameStore.getState().player1Heroes[0].position).toEqual([2, 3]);
    });

    it('电脑能完成铺雾、刺杀和天威选择，不停在待选格', () => {
        const { hero, foe, enter } = fixture('player2');
        const enemy = foe([2, 3], 6); foe([5, 5]);
        hero.hasMovedThisTurn = true; enter(true);
        for (let i = 0; i < 6 && useGameStore.getState().currentPlayer === 'player2'; i++) runComputerOpponentStep();
        expect(enemy.currentHp).toBe(0);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(useGameStore.getState().currentPlayer).toBe('player1');
    });
});
