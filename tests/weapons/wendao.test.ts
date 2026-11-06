import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { applyHeroWeapon } from '../../src/data/heroes';
import { moranSkill1, moranSkill2 } from '../../src/data/skills';
import { applyServerGameState } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import type { Hero, Position, Skill } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

beforeEach(() => {
    useGameStore.getState().resetGame();
    DamageCalculator.setBattleRound(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
});
afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

function fixture(equipped = true) {
    const state = makeGameState();
    const hero = addHero(state, 'moran', 'player1', [2, 2]);
    if (equipped) applyHeroWeapon(hero, { moran: 'moran' });
    const enemy = (pos: Position) => {
        const unit = addHero(state, 'zhenxiao', 'player2', pos);
        Object.assign(unit, { currentHp: 300, maxHp: 300, defense: 0, passiveId: '', tianweiId: '' });
        return unit;
    };
    const target = enemy([2, 3]);
    const hit = (skill: Skill, victim: Hero = target) => {
        const before = victim.currentHp;
        expect(SkillSystem.executeSkill(hero, skill, [victim.position!], state).success).toBe(true);
        return before - victim.currentHp;
    };
    return { state, hero, target, enemy, hit };
}

describe('墨阑专属武器「问道」', () => {
    it('两招共享层数，只有之后的技能吃新层，跨轮保留', () => {
        const { state, hero, hit } = fixture();
        expect([hit(moranSkill1), hit(moranSkill1), hit(moranSkill2)]).toEqual([10, 11, 17]);
        expect(hero.counters['问道']).toBe(3);
        state.roundNumber = 2;
        GameEngine.startNewTurn(state);
        expect(hit(moranSkill1)).toBe(13);
        expect(hero.counters['问道']).toBe(4);
    });

    it('实际出招被闪避仍算一次攻击；没有合法目标不计层', () => {
        const { state, hero, target, hit } = fixture();
        expect(SkillSystem.executeSkill(hero, moranSkill1, [[1, 2]], state).success).toBe(false);
        expect(hero.counters['问道']).toBeUndefined();
        target.passiveId = 'shangguan_passive'; target.counters['闪避'] = 1;
        expect(hit(moranSkill1)).toBe(0);
        expect(hero.counters['问道']).toBe(1);
        expect(hit(moranSkill2)).toBe(16);
    });

    it('只在墨阑自己的额外行动吃20%；强制行动或别人再动不算', () => {
        const { state, hero, hit } = fixture();
        const ally = addHero(state, 'liuli', 'player1', [0, 0]);
        state.performingForcedAction = true;
        state.activeHero = hero;
        expect(hit(moranSkill2)).toBe(15);
        state.performingForcedAction = false;
        state.performingExtraAction = true;
        state.activeHero = ally;
        expect(hit(moranSkill2)).toBe(16);
        state.activeHero = hero;
        expect(hit(moranSkill2)).toBe(20);
        state.performingExtraAction = false;
        expect(hit(moranSkill2)).toBe(18);
    });

    it('正常击杀触发天威再动时，下一招先吃刚攒的一层再乘20%', () => {
        const { state, hero, target, enemy } = fixture();
        target.currentHp = 9;
        const survivor = enemy([1, 2]);
        useGameStore.setState({ ...state, gameMode: 'classic', activeHero: hero, selectedHero: hero });
        useGameStore.getState().selectSkill(moranSkill1.id);
        useGameStore.getState().executeSkill([2, 3]);
        const extra = useGameStore.getState();
        expect(extra.performingExtraAction).toBe(true);
        expect(extra.activeHero?.id).toBe(hero.id);
        expect(hero.counters['问道']).toBe(1);
        useGameStore.getState().selectSkill(moranSkill2.id);
        useGameStore.getState().executeSkill([1, 2]);
        expect(survivor.currentHp).toBe(300 - 19);
        expect(hero.counters['问道']).toBe(2);
    });

    it('为道受击两次进入额外行动，同一击可同时享受致知二和问道', () => {
        const { state, hero, target, hit } = fixture();
        expect(hit(moranSkill1)).toBe(10);
        hero.counters.talent_2 = 1;
        state.currentPlayer = 'player2'; state.activeHero = target;
        for (let i = 0; i < 2; i++) {
            DamageCalculator.applyDamage(hero, DamageCalculator.calculate(target, hero, 5), target, state);
        }
        expect(state.pendingExtraActionHeroIds?.player1).toBe(hero.id);
        GameEngine.endHeroAction(target, state);
        expect(state.performingExtraAction).toBe(true);
        expect(state.activeHero?.id).toBe(hero.id);
        expect(hit(moranSkill2)).toBe(26); // (15 + 1) × 1.2 × 1.4，最后按通用伤害规则取整
    });

    it('问道和致知二独立叠乘；未装备的墨阑不享受武器效果', () => {
        for (const equipped of [false, true]) {
            const { state, hero, hit } = fixture(equipped);
            hero.counters['问道'] = 2;
            hero.counters.talent_2 = 1; hero.counters.__weidao_burst = 1;
            state.activeHero = hero; state.performingExtraAction = true;
            expect(hit(moranSkill1)).toBe(equipped ? 20 : 14);
            expect(hero.counters.__weidao_burst).toBeUndefined();
            expect(hero.counters['问道']).toBe(equipped ? 3 : 2);
        }
    });

    it('联机快照保留已装备武器与问道累计值', () => {
        const { state, hero, hit } = fixture();
        hit(moranSkill1); hit(moranSkill2);
        useGameStore.setState(state);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        const restored = useGameStore.getState().player1Heroes[0];
        expect(restored.id).toBe(hero.id);
        expect(restored.weaponId).toBe('moran');
        expect(restored.counters['问道']).toBe(2);
    });
});
