import { afterEach, describe, expect, it } from 'vitest';
import { chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { QIYUAN_DELAY, QIYUAN_GUARD, QIYUAN_RESERVE, QIYUAN_WISH } from '../../src/core/qiyuan';
import { SkillSystem } from '../../src/core/skill-system';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { getZhizhi } from '../../src/data/hero-zhizhi';
import { getSkill } from '../../src/data/skills';
import { applyServerGameState } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { HeroState, type Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(() => useGameStore.getState().resetGame());

function fixture() {
    const state = makeGameState();
    const hero = addHero(state, 'qiyuan', 'player1', [2, 2]);
    const ally = addHero(state, 'moran', 'player1', [2, 4]);
    const foe = addHero(state, 'zhenxiao', 'player2', [5, 5]);
    ally.currentHp = 10;
    const cast = (id: string, position: Position, delay = 1) => {
        hero.counters[QIYUAN_DELAY] = delay;
        return SkillSystem.executeSkill(hero, getSkill(id)!, [position], state);
    };
    const next = () => { state.roundNumber++; GameEngine.startNewTurn(state); };
    return { state, hero, ally, foe, cast, next };
}

describe('祈愿', () => {
    it('素问55生命、移动2，天威和三档致知留空', () => {
        const { hero } = fixture();
        expect(hero).toMatchObject({ name: '祈愿', class: '素问', maxHp: 55, moveRange: 2 });
        expect(hero.tianweiId).toBeUndefined();
        expect(getZhizhi('qiyuan').map(entry => entry.text)).toEqual([null, null, null]);
        expect(HERO_CODEX.some(entry => entry.id === 'qiyuan' && entry.tianweiPending)).toBe(true);
    });

    it.each([[1, 12], [2, 24]])('许愿等%s轮回%s点，随目标换位且只兑现一次', (delay, heal) => {
        const { state, ally, cast, next } = fixture();
        expect(cast(QIYUAN_WISH, [2, 4], delay).success).toBe(true);
        expect(ally.currentHp).toBe(10);
        state.board[2][4] = null; ally.position = [0, 5]; state.board[0][5] = ally;
        for (let i = 1; i < delay; i++) { next(); expect(ally.currentHp).toBe(10); }
        next();
        expect(ally.currentHp).toBe(10 + heal);
        expect(state.qiyuanWishes).toEqual([]);
        next();
        expect(ally.currentHp).toBe(10 + heal);
    });

    it.each([[1, 5], [2, 10]])('守愿等%s轮回%s点，只治疗兑现位置的十字', (delay, heal) => {
        const { state, hero, ally, foe, cast, next } = fixture();
        const diagonal = addHero(state, 'liuli', 'player1', [2, 3]);
        diagonal.currentHp = 10; hero.currentHp = 10; foe.currentHp = 10;
        expect(cast(QIYUAN_GUARD, [2, 2], delay).success).toBe(true);
        expect(cast(QIYUAN_WISH, [2, 4], delay).success).toBe(true);
        state.board[2][2] = null; hero.position = [1, 4]; state.board[1][4] = hero;
        for (let i = 1; i < delay; i++) { next(); expect(hero.currentHp).toBe(10); }
        next();
        expect([hero.currentHp, ally.currentHp, diagonal.currentHp, foe.currentHp]).toEqual([10 + heal, 10 + heal + 12 * delay, 10, 10]);
        expect(state.battleLog.map(log => log.details?.skillFxRequest)).toContainEqual(expect.objectContaining({
            skillId: 'qiyuan_guard_arrive', fromPos: [1, 4], softImpactPositions: [[1, 4], [2, 4]],
        }));
    });

    it('许愿可提前兑现一次并消耗行动，不会到期再回', () => {
        const { state, hero, ally, cast } = fixture();
        expect(cast(QIYUAN_WISH, [2, 4], 2).success).toBe(true);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero });
        useGameStore.getState().selectSkill(QIYUAN_WISH);
        expect(useGameStore.getState().skillRange).toEqual([[2, 2]]);
        useGameStore.getState().executeSkill([2, 2]);
        const result = useGameStore.getState();
        expect([ally.currentHp, result.actionsThisTurn, result.currentPlayer]).toEqual([22, 1, 'player2']);
        expect(result.qiyuanWishes).toEqual([]);
        expect(result.skillFx).toContainEqual(expect.objectContaining({
            profile: expect.objectContaining({ inkScene: 'wish-arrive' }), targetPos: [2, 4],
        }));
    });

    it('守愿提前释放只回一半，5点向下取整为2', () => {
        const { state, hero, ally, cast } = fixture();
        hero.currentHp = 10;
        expect(cast(QIYUAN_GUARD, [2, 2]).success).toBe(true);
        expect(cast(QIYUAN_GUARD, [2, 2]).success).toBe(true);
        expect([hero.currentHp, ally.currentHp]).toEqual([12, 12]);
        expect(state.qiyuanWishes).toEqual([]);
    });

    it('溢出治疗存量能在致命伤后从0救回，不触发击杀且不回存', () => {
        const { state, hero, ally, foe, cast, next } = fixture();
        ally.currentHp = ally.maxHp - 9;
        expect(cast(QIYUAN_WISH, [2, 4]).success).toBe(true);
        next();
        expect(hero.counters[QIYUAN_RESERVE]).toBe(3);
        ally.currentHp = 5;
        const hit = DamageCalculator.calculate(foe, ally, 10, false, false, { fixedDamage: true });
        DamageCalculator.applyDamage(ally, hit, foe, state);
        expect([ally.currentHp, ally.state, hero.counters[QIYUAN_RESERVE], foe.killCount]).toEqual([3, HeroState.ALIVE, 0, 0]);
        DamageCalculator.applyDamage(ally, DamageCalculator.calculate(foe, ally, 10, false, false, { fixedDamage: true }), foe, state);
        expect(ally.state).toBe(HeroState.DEAD);
    });

    it('满血时的治疗全部存入；救援溢出上限的部分不再存回去', () => {
        const { state, hero, ally, foe, cast, next } = fixture();
        ally.currentHp = ally.maxHp;
        expect(cast(QIYUAN_WISH, [2, 4], 2).success).toBe(true);
        next(); next();
        expect(hero.counters[QIYUAN_RESERVE]).toBe(24);
        hero.counters[QIYUAN_RESERVE] = hero.maxHp + 20;
        hero.currentHp = 1;
        const lethal = DamageCalculator.calculate(foe, hero, 100, false, false, { fixedDamage: true });
        DamageCalculator.applyDamage(hero, lethal, foe, state);
        expect([hero.currentHp, hero.state, hero.counters[QIYUAN_RESERVE]]).toEqual([hero.maxHp, HeroState.ALIVE, 0]);
    });

    it('敌方与5×5外目标不可许愿；联机能恢复等待时长、受益人和储量', () => {
        const { state, hero, ally, cast } = fixture();
        const far = addHero(state, 'liuli', 'player1', [5, 2]);
        expect(cast(QIYUAN_WISH, far.position!).success).toBe(false);
        expect(cast(QIYUAN_WISH, [5, 5]).success).toBe(false);
        expect(cast(QIYUAN_WISH, [2, 4], 2).success).toBe(true);
        hero.counters[QIYUAN_RESERVE] = 19;
        useGameStore.setState(state);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        expect(useGameStore.getState().qiyuanWishes).toMatchObject([{ targetHeroId: ally.id, dueRound: 3, heal: 24 }]);
        expect(useGameStore.getState().player1Heroes[0].counters[QIYUAN_RESERVE]).toBe(19);
    });

    it('AI能识别延迟治疗，选择许愿给受伤队友', () => {
        const { state, hero, ally } = fixture();
        expect(chooseComputerSkillPlan(state, hero, QIYUAN_WISH)?.targetPositions).toEqual([ally.position]);
        expect(state.qiyuanWishes).toBeUndefined();
    });
});
