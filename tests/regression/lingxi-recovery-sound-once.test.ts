import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { soundManager } from '../../src/core/sound-manager';
import { addTide } from '../../src/data/extended-heroes';
import type { Hero, Position } from '../../src/types/game';

/**
 * 泠汐的"攻击附带治疗"恢复段（潮汐回血）按受疗单位逐条上报特效请求，
 * 命中多名敌人时同一份 heal 音效会连响好几声。
 * 裁定：一次施法只响一次；被治疗到的每个格子仍然各出一颗光球。
 * 合并只作用于打了 coalesce 标记的恢复段，伤害/斩击类逐格特效不受影响。
 */

function setupBattle(roster: { p1: Array<[string, Position]>; p2: Array<[string, Position]> }) {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, localPlayerNumber: 1 });
    useGameStore.getState().initGame();
    for (const heroId of PICKS_P1) expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    for (const heroId of PICKS_P2) expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);
    for (const [heroId, pos] of roster.p1) expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    for (const [heroId, pos] of roster.p2) expect(useGameStore.getState().deployHeroForPlayer('player2', heroId, pos)).toBe(true);
    expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);

    const state = useGameStore.getState();
    const heroOf = (side: 'player1Heroes' | 'player2Heroes', templateId: string) => {
        const found = state[side].find(hero => hero.id.startsWith(`${templateId}-`));
        expect(found, `${templateId} 应在 ${side}`).toBeDefined();
        return found!;
    };
    useGameStore.setState({ currentPlayer: 'player1' });
    return { state, heroOf };
}

const P2_TRIO: Array<[string, Position]> = [
    ['fengling', [2, 3]], ['guying', [1, 3]], ['youjun', [3, 3]],
];
/** 首发上限 4 人：双方各再摆一名远离战圈的，只为把布阵确认凑满 */
const P2_EXTRA: Array<[string, Position]> = [['jinghua', [5, 5]]];
const P1_EXTRA: Array<[string, Position]> = [['zhenxiao', [0, 0]]];
const PICKS_P1 = ['lingxi', 'liuli', 'moran', 'zhenxiao', 'huifeng', 'baize'];
const PICKS_P2 = ['fengling', 'guying', 'youjun', 'jinghua', 'yunying', 'xubai'];

/** 友方先残血，潮汐回血才会真的治好并上报恢复段 */
function woundAllies() {
    for (const ally of useGameStore.getState().player1Heroes) {
        ally.currentHp = Math.max(1, Math.floor(ally.maxHp / 2));
    }
}

function castSkill1(lingxi: Hero, target: Position) {
    useGameStore.getState().selectHeroForAction(lingxi);
    useGameStore.getState().selectSkill('lingxi_skill1');
    useGameStore.getState().executeSkill(target);
}

describe('泠汐恢复段音效', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('命中三名敌人也只播一次潮汐回血音效，且只派发一份恢复特效', () => {
        const { heroOf } = setupBattle({
            p1: [['lingxi', [2, 2]], ['liuli', [2, 1]], ['moran', [1, 1]], ...P1_EXTRA],
            p2: [...P2_TRIO, ...P2_EXTRA],
        });
        woundAllies();
        const lingxi = heroOf('player1Heroes', 'lingxi');
        // 只有泠汐站在三名敌人的 3×3 里：三次治疗落在同一格
        const foes = P2_TRIO.map(([id]) => heroOf('player2Heroes', id));
        expect(foes).toHaveLength(3);
        for (const foe of foes) addTide(foe, lingxi, 1);

        const play = vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined);
        castSkill1(lingxi, [2, 3]);

        const sounds = play.mock.calls.map(args => args[0].skillId);
        expect(sounds.filter(id => id === 'lingxi_skill1')).toHaveLength(1);
        expect(sounds.filter(id => id === 'lingxi_regen')).toHaveLength(1);
        expect(useGameStore.getState().skillFx.filter(event => event.skillId === 'lingxi_regen')).toHaveLength(1);
    });

    it('合并只收拢重复的音效，被治疗到的每个格子仍然各出一颗光球', () => {
        const { heroOf } = setupBattle({
            p1: [['lingxi', [2, 2]], ['liuli', [1, 2]], ['moran', [3, 2]], ...P1_EXTRA],
            p2: [...P2_TRIO, ...P2_EXTRA],
        });
        woundAllies();
        const lingxi = heroOf('player1Heroes', 'lingxi');
        for (const [id] of P2_TRIO) addTide(heroOf('player2Heroes', id), lingxi, 1);

        const hpBefore = useGameStore.getState().player1Heroes.reduce((sum, hero) => sum + hero.currentHp, 0);
        castSkill1(lingxi, [2, 3]);

        const recovery = useGameStore.getState().skillFx.filter(event => event.skillId === 'lingxi_regen');
        expect(recovery).toHaveLength(1);
        // 三名友方各自都被治到：合并后的落点必须覆盖三个格子
        const cells = new Set((recovery[0].impactPositions ?? []).map(pos => `${pos[0]},${pos[1]}`));
        expect([...cells].sort()).toEqual(['1,2', '2,2', '3,2']);
        // 治疗数值不会因为合并而丢失
        const hpAfter = useGameStore.getState().player1Heroes.reduce((sum, hero) => sum + hero.currentHp, 0);
        expect(hpAfter).toBeGreaterThan(hpBefore);
    });
});
