import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { HeroState } from '../../src/types/game';
import { createHero } from '../../src/data/heroes';
import {
    applyWeaponOnArrival,
    applyWeaponOnDamageDealt,
    applyWeaponOnFormShift,
    applyWeaponOnGuard
} from '../../src/core/weapon-effects';
import { huifengComboHits } from '../../src/core/huifeng-marks';
import type { Hero } from '../../src/types/game';

/**
 * 经典模式（战前武装专属器）的流程与首批已实装效果。
 *
 * 标准模式必须与实装前逐帧一致（weaponId 恒为 null），这是这套系统能安全上线的前提。
 */
function pickSix(side: 'player1' | 'player2', ids: string[]) {
    const store = useGameStore.getState();
    for (const id of ids) store.selectHeroForPlayer(side, id);
    store.confirmHeroSelectionForPlayer(side);
}

function startClassic(roster1: string[], roster2: string[]) {
    useGameStore.setState({ gameMode: 'classic', isOnlineMode: false, isAiMode: false });
    useGameStore.getState().initGame();
    pickSix('player1', roster1);
    pickSix('player2', roster2);
}

const ROSTER_1 = ['fengling', 'liuli', 'libai', 'zuizhendao', 'jetzmi', 'skeletonking'];
const ROSTER_2 = ['moran', 'wukong', 'guying', 'yunying', 'yinyang', 'mirror'];

describe('经典模式武装流程', () => {
    afterEach(() => useGameStore.getState().resetGame());

    it('标准模式确认选将后直接进布阵，不经过武装阶段', () => {
        useGameStore.setState({ gameMode: 'standard' });
        useGameStore.getState().initGame();
        pickSix('player1', ROSTER_1);
        pickSix('player2', ROSTER_2);

        expect(useGameStore.getState().phase).toBe('deploy');
        expect(useGameStore.getState().player1WeaponIds).toEqual({});
    });

    it('经典模式多一道武装阶段，双方都确认后才进布阵', () => {
        startClassic(ROSTER_1, ROSTER_2);
        const afterSelect = useGameStore.getState();
        expect(afterSelect.phase).toBe('weapon-select');
        expect(afterSelect.selectingPlayer).toBe('player1');

        useGameStore.getState().toggleWeaponForPlayer('player1', 'fengling');
        useGameStore.getState().confirmWeaponSelectionForPlayer('player1');
        expect(useGameStore.getState().phase).toBe('weapon-select'); // 还等玩家二

        useGameStore.getState().toggleWeaponForPlayer('player2', 'moran');
        useGameStore.getState().confirmWeaponSelectionForPlayer('player2');
        expect(useGameStore.getState().phase).toBe('deploy');
        expect(useGameStore.getState().player1WeaponIds?.fengling).toBe('fengling');
        expect(useGameStore.getState().player2WeaponIds?.moran).toBe('moran');
    });

    it('只能武装自己选下的、且效果已实装的英雄', () => {
        startClassic(ROSTER_1, ROSTER_2);
        const store = useGameStore.getState();

        expect(store.toggleWeaponForPlayer('player1', 'moran')).toBe(false);   // 不在自己名单里
        expect(store.toggleWeaponForPlayer('player1', 'guying')).toBe(false);  // 不在自己名单里
        expect(store.toggleWeaponForPlayer('player1', 'jinghong')).toBe(false); // 未实装效果
        expect(store.toggleWeaponForPlayer('player1', 'fengling')).toBe(true);
    });

    it('布阵落子的英雄带上 weaponId，撤下重选后仍然是带武器状态', () => {
        startClassic(ROSTER_1, ROSTER_2);
        const weapons = useGameStore.getState();
        weapons.toggleWeaponForPlayer('player1', 'fengling');
        weapons.confirmWeaponSelectionForPlayer('player1');
        weapons.toggleWeaponForPlayer('player2', 'moran');
        weapons.confirmWeaponSelectionForPlayer('player2');

        const store = useGameStore.getState();
        store.deployHeroForPlayer('player1', 'fengling', [4, 0]);
        const deployed = useGameStore.getState().player1Heroes.find(hero => hero.id.startsWith('fengling-'));
        expect(deployed?.weaponId).toBe('fengling');

        // 撤下再重新上阵：实例是新建的，武器必须由权威账本重新派生
        useGameStore.getState().undeployHeroForPlayer('player1', deployed!.id);
        useGameStore.getState().deployHeroForPlayer('player1', 'fengling', [4, 1]);
        const redeployed = useGameStore.getState().player1Heroes.find(hero => hero.id.startsWith('fengling-'));
        expect(redeployed?.weaponId).toBe('fengling');
    });

    it('重开一局沿用入口选的模式，回主菜单则清回标准模式', () => {
        startClassic(ROSTER_1, ROSTER_2);
        useGameStore.getState().initGame();
        expect(useGameStore.getState().gameMode).toBe('classic');

        useGameStore.getState().resetGame();
        expect(useGameStore.getState().gameMode).toBe('standard');
        expect(useGameStore.getState().player1WeaponIds).toEqual({});
    });
});

describe('首批已实装的专属武器效果', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
        vi.restoreAllMocks();
    });

    const make = (templateId: string, weaponId: string | null): Hero => {
        const hero = createHero(templateId, 'player1', [3, 0]);
        hero.weaponId = weaponId;
        return hero;
    };

    it('千锋尽：连刃斩段数 3 → 4，未武装仍是 3 段', () => {
        expect(huifengComboHits(make('huifeng', 'huifeng'))).toBe(4);
        expect(huifengComboHits(make('huifeng', null))).toBe(3);
    });

    it('猎砂之爪：登场即有 1 层猎砂，未武装则仍是 0 层', () => {
        const armed = make('fengling', 'fengling');
        const bare = make('fengling', null);
        applyWeaponOnArrival(armed);
        applyWeaponOnArrival(bare);

        expect(armed.counters['猎砂']).toBe(1);
        expect(bare.counters['猎砂']).toBe(0);
    });

    it('冥王权杖：本体亡灵之力/亡灵之魂保底 1 层，且不清掉已攒的高层数', () => {
        const hero = make('skeletonking', 'skeletonking');
        hero.counters['亡灵之力'] = 3;
        applyWeaponOnArrival(hero);

        expect(hero.counters['亡灵之力']).toBe(3);
        expect(hero.counters['亡灵之魂']).toBe(1);
    });

    it('醉月：每次造成伤害 25% 概率给自己上 1 层醉意，封顶 ZUIYI_MAX', () => {
        const hero = make('libai', 'libai');
        const state = useGameStore.getState();
        vi.spyOn(Math, 'random').mockReturnValue(0.1);

        applyWeaponOnDamageDealt(hero, state);
        expect(hero.counters['醉意']).toBe(1);

        hero.counters['醉意'] = 4;
        applyWeaponOnDamageDealt(hero, state);
        expect(hero.counters['醉意']).toBe(4);

        vi.spyOn(Math, 'random').mockReturnValue(0.9);
        hero.counters['醉意'] = 1;
        applyWeaponOnDamageDealt(hero, state);
        expect(hero.counters['醉意']).toBe(1);
    });

    it('酒狂：命中判定按目标独立，未过概率则不上醉意', () => {
        const hero = make('zuizhendao', 'zuizhendao');
        const state = useGameStore.getState();
        vi.spyOn(Math, 'random').mockReturnValue(0.05);
        applyWeaponOnDamageDealt(hero, state);
        expect(hero.counters['醉意']).toBe(1);

        const missed = make('zuizhendao', 'zuizhendao');
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        applyWeaponOnDamageDealt(missed, state);
        expect(missed.counters['醉意']).toBe(0);
    });

    it('净琉璃：援护成功 50% 概率额外 1 层禅定', () => {
        const hero = make('liuli', 'liuli');
        hero.counters['禅定'] = 1;
        vi.spyOn(Math, 'random').mockReturnValue(0.2);
        applyWeaponOnGuard(hero);
        expect(hero.counters['禅定']).toBe(2);

        vi.spyOn(Math, 'random').mockReturnValue(0.8);
        applyWeaponOnGuard(hero);
        expect(hero.counters['禅定']).toBe(2);
    });

    it('双生之镰：主动切形回 5 点生命，没带武器则不回', () => {
        useGameStore.getState().initGame();
        const state = useGameStore.getState();
        const armed = make('jetzmi', 'jetzmi');
        armed.currentHp = 20;
        applyWeaponOnFormShift(armed, state);
        expect(armed.currentHp).toBeGreaterThan(20);

        const bare = make('jetzmi', null);
        bare.currentHp = 20;
        applyWeaponOnFormShift(bare, state);
        expect(bare.currentHp).toBe(20);
    });

    it('武器效果只在 armed 时结算：同英雄未武装时行为与标准模式一致', () => {
        const state = useGameStore.getState();
        vi.spyOn(Math, 'random').mockReturnValue(0.01);
        const bare = make('libai', null);
        applyWeaponOnDamageDealt(bare, state);
        expect(bare.counters['醉意'] ?? 0).toBe(0);
        expect(bare.state).toBe(HeroState.ALIVE);
    });
});
