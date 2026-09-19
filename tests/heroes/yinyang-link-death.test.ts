import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { resolveHeroLinks } from '../../src/core/hero-link-view';
import { checkAllYinyangLinks } from '../../src/data/extended-heroes';
import { yinyangSkill1, yinyangSkill2 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import type { GameState, Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 阴阳师阵亡（含死后回替补席、日后被唤回）后，
 * 挂在他人身上的阳/阴线必须随本体当场消散：
 * 线不再出现在连线层，攻防加成不再残留，倍率回到初始档。
 */
function setupLinked() {
    const state = makeGameState();
    const caster = addHero(state, 'yinyang', 'player1', [2, 2]);
    const ally = addHero(state, 'baize', 'player1', [2, 3]);
    const enemy = addHero(state, 'nightowl', 'player2', [3, 2]);
    const killer = addHero(state, 'changli', 'player2', [0, 0]);

    const yang = yinyangSkill1.execute!(caster, [ally], state);
    const yin = yinyangSkill2.execute!(caster, [enemy], state);
    expect(yang.success).toBe(true);
    expect(yin.success).toBe(true);
    // 一一金一紫两条（同名双效果按 key 去重，不重复画线）
    expect(resolveHeroLinks(state.board).map(link => link.kind).sort()).toEqual(['yang', 'yin']);
    return { state, caster, ally, enemy, killer };
}

function lethal(state: GameState, victim: Hero, killer: Hero) {
    const damage = DamageCalculator.calculate(killer, victim, 99, false, true);
    DamageCalculator.applyDamage(victim, damage, killer, state);
}

describe('阴阳师阵亡后阴阳线随本体消散', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('真阵亡：效果即时移除、连线清零、倍率重置', () => {
        const { state, caster, ally, enemy, killer } = setupLinked();
        // 先把倍率抬高，验证死亡后回到初始档
        caster.counters['yinyang_yang_rate'] = 0.5;
        caster.counters['yinyang_yin_rate'] = 0.4;

        lethal(state, caster, killer);

        expect(caster.state).toBe(HeroState.DEAD);
        expect(ally.effects.some(effect => effect.name.startsWith('阳线'))).toBe(false);
        expect(enemy.effects.some(effect => effect.name.startsWith('阴线'))).toBe(false);
        expect(resolveHeroLinks(state.board)).toHaveLength(0);
        expect(caster.counters['yinyang_yang_rate']).toBe(0.2);
        expect(caster.counters['yinyang_yin_rate']).toBe(0.2);
        expect(state.battleLog.some(entry => entry.message.includes('阳线/阴线全部消散'))).toBe(true);
    });

    it('暂时阵亡：线同样当场消散，复活回归后不再原样接上', () => {
        const { state, caster, ally, enemy } = setupLinked();

        GameEngine.tempDeath(caster, state);

        expect(caster.state).toBe(HeroState.TEMP_DEAD);
        expect(ally.effects.some(effect => effect.name.startsWith('阳线'))).toBe(false);
        expect(enemy.effects.some(effect => effect.name.startsWith('阴线'))).toBe(false);
        expect(resolveHeroLinks(state.board)).toHaveLength(0);
    });

    it('死亡清理幂等：之后的位移兜底重算对已消散的死者是 no-op', () => {
        const { state, caster, killer } = setupLinked();
        lethal(state, caster, killer);
        const logCount = state.battleLog.filter(entry => entry.message.includes('阳线/阴线全部消散')).length;
        expect(logCount).toBe(1);

        // 移动/位移后的统一重算兜底：死者已清理干净，不应再变更或重复刷日志
        expect(checkAllYinyangLinks(state)).toBe(false);
        expect(state.battleLog.filter(entry => entry.message.includes('阳线/阴线全部消散')).length).toBe(1);
    });

    it('存活阴阳师的线不受其他英雄死亡影响', () => {
        const { state, caster, ally, enemy, killer } = setupLinked();
        void caster;
        lethal(state, enemy, killer);
        expect(ally.effects.some(effect => effect.name.startsWith('阳线'))).toBe(true);
        // 阴线端点（敌人）离场后连线层自然少一条
        expect(resolveHeroLinks(state.board)).toHaveLength(1);
    });
});
