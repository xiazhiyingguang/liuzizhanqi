import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/game-engine';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { huifengSkill2, zhenxiaoSkill2 } from '../../src/data/skills';
import { GameState, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 震霄技能2「束缚格」语义回归。
 *
 * 裁定（与策划确认）：
 * 1. 以自身为中心 3x3 形成一整片束缚区（同 linkId）；
 * 2. 只钳制普通移动：起点在区内的敌方单位不得走出该区（也不能借道穿出）；
 * 3. 技能造成的位移（跳跃/瞬移/冲刺）可以离开；
 * 4. 区外敌人可以走进来，走进来之后按起点判定同样被锁；
 * 5. 持续到下一回合震霄行动结束。
 */

/** 震霄落在 (2,2)，束缚区即 rows 1..3 × cols 1..3 */
function setupZone(): { state: GameState; zhenxiao: ReturnType<typeof addHero> } {
    const state = makeGameState();
    const zhenxiao = addHero(state, 'zhenxiao', 'player1', [2, 2]);
    zhenxiaoSkill2.execute!(zhenxiao, [], state);
    return { state, zhenxiao };
}

const inZone = ([row, col]: Position) => row >= 1 && row <= 3 && col >= 1 && col <= 3;

describe('震霄·束缚格', () => {
    it('技能2以自身为中心布下 3x3 一整片束缚区', () => {
        const { state } = setupZone();
        const zones = (state.boardEffects ?? []).filter(effect => effect.type === 'binding-zone');

        expect(zones).toHaveLength(9);
        expect(new Set(zones.map(effect => effect.linkId)).size, '9 格必须属于同一片区域').toBe(1);
        expect(zones.every(effect => effect.owner === 'player1')).toBe(true);
        expect(zones.map(effect => effect.position).filter(inZone)).toHaveLength(9);
    });

    it('震霄贴住棋盘角落时只生成界内格子', () => {
        const state = makeGameState();
        const zhenxiao = addHero(state, 'zhenxiao', 'player1', [0, 0]);
        zhenxiaoSkill2.execute!(zhenxiao, [], state);

        const zones = (state.boardEffects ?? []).filter(effect => effect.type === 'binding-zone');
        expect(zones).toHaveLength(4); // (0,0)(0,1)(1,0)(1,1)
        expect(zones.every(effect => effect.position[0] < 6 && effect.position[1] < 6)).toBe(true);
    });

    it('圈内敌人的普通移动被钳制在圈内', () => {
        const { state } = setupZone();
        const trapped = addHero(state, 'moran', 'player2', [2, 3]);

        const movable = MovementSystem.getMovablePositions(trapped, state);
        expect(movable.length, '圈内仍有可走空格').toBeGreaterThan(0);
        expect(movable.every(inZone), `越界格：${JSON.stringify(movable.filter(cell => !inZone(cell)))}`).toBe(true);

        // 对照组：撤掉束缚区后同一单位立刻能走出去，说明限制来自区域效果本身
        state.boardEffects = [];
        expect(MovementSystem.getMovablePositions(trapped, state).some(cell => !inZone(cell))).toBe(true);
    });

    it('区外敌人可以走进束缚区，走完之后下一手就被锁住', () => {
        const { state } = setupZone();
        const outsider = addHero(state, 'huifeng', 'player2', [0, 2]);

        // 起点在区外 → 不钳制，可以踏入 (1,2)
        expect(MovementSystem.moveHero(outsider, [1, 2], state)).toBe(true);

        // 踏入之后起点落在区内 → 只能待在区内
        const movable = MovementSystem.getMovablePositions(outsider, state);
        expect(movable.every(inZone)).toBe(true);
    });

    it('束缚区不限制己方单位，也不限制震霄自己', () => {
        const { state, zhenxiao } = setupZone();
        const ally = addHero(state, 'baize', 'player1', [1, 1]);

        for (const hero of [ally, zhenxiao]) {
            const movable = MovementSystem.getMovablePositions(hero, state);
            expect(
                movable.some(cell => !inZone(cell)),
                `${hero.name} 应能走出自己人的束缚区`
            ).toBe(true);
        }
    });

    it('技能造成的位移可以离开束缚区，普通移动不行', () => {
        const { state } = setupZone();
        const jumper = addHero(state, 'huifeng', 'player2', [2, 3]);

        // 同一格：普通移动走不出去
        expect(MovementSystem.moveHero(jumper, [2, 4], state)).toBe(false);

        // 风过留痕（技能2跳跃）可以跳出区
        jumper.counters['__huifeng_skill2_target'] = 2 * 6 + 4;
        const result = SkillSystem.executeSkill(jumper, huifengSkill2, [[2, 4]], state);
        expect(result.success).toBe(true);
        expect(jumper.position).toEqual([2, 4]);
    });

    it('下一回合震霄行动结束后整片撤除，敌人恢复自由', () => {
        const { state, zhenxiao } = setupZone();
        const trapped = addHero(state, 'moran', 'player2', [2, 3]);

        const zoneCount = () =>
            (state.boardEffects ?? []).filter(effect => effect.type === 'binding-zone').length;

        // 本回合行动结束：束缚格仍在
        GameEngine.endHeroAction(zhenxiao, state);
        expect(zoneCount()).toBe(9);
        expect(MovementSystem.getMovablePositions(trapped, state).every(inZone)).toBe(true);

        // 下一回合行动结束：整片撤除
        zhenxiao.hasActedThisTurn = false;
        GameEngine.endHeroAction(zhenxiao, state);
        expect(zoneCount()).toBe(0);

        const freed = MovementSystem.getMovablePositions(trapped, state);
        expect(freed.some(cell => !inZone(cell)), '撤除后应能走出原区域').toBe(true);
    });
});
