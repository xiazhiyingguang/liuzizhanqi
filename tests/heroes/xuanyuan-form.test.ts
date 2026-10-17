import { describe, expect, it } from 'vitest';
import { createHero } from '../../src/data/heroes';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import {
    getGMovePlans,
    getXiangMovePlans,
    getXuanyuanMovePlans,
    getZhaoShenProgress,
    isZhaoShen,
    markZhaoShenHit,
    tryEnterZhaoShen,
    XUANYUAN_SKILL1_ID,
    ZHAOSHEN_COUNTER,
    ZHAOSHEN_MARK,
} from '../../src/core/xuanyuan-form';
import {
    addSwordMitigation,
    attachSwordToAlly,
    countFlyingSwords,
    findNearestAllyForSword,
    FLYING_SWORD_LIMIT,
    getDiagonalSwords,
    getFlyingSwords,
    placeFlyingSword,
    removeFlyingSword,
    SWORD_MITIGATION_EFFECT,
} from '../../src/core/flying-sword';
import { makeGameState } from '../helpers/game-state';

/** 造一个已经"是轩辕"的英雄：这两个模块只认 skill1Id / counters / position */
function makeXuanyuan(position: Position | null, zhaoShen = false): Hero {
    const hero = createHero('moran', 'player1', position);
    hero.skill1Id = XUANYUAN_SKILL1_ID;
    hero.counters = zhaoShen ? { [ZHAOSHEN_COUNTER]: 1 } : {};
    return hero;
}

function makeEnemy(id: string, position: Position): Hero {
    const hero = createHero('baize', 'player2', position);
    hero.id = id;
    return hero;
}

function stateWith(board: (Hero | null)[][], heroes: Hero[], enemies: Hero[]): GameState {
    return makeGameState({ board, player1Heroes: heroes, player2Heroes: enemies });
}

function boardWith(units: Hero[]): (Hero | null)[][] {
    const board = Array.from({ length: 6 }, () => Array<Hero | null>(6).fill(null));
    for (const unit of units) {
        const [row, col] = unit.position as Position;
        board[row][col] = unit;
    }
    return board;
}

const key = (position: Position): string => position.join(',');

describe('轩辕神君 · 移动形状', () => {
    it('普通态象走田：中心位置有四个对角两格的落点，路径是象眼加落点', () => {
        const plans = getXiangMovePlans([3, 3]);
        expect(plans.map(plan => key(plan.to)).sort()).toEqual(['1,1', '1,5', '5,1', '5,5'].sort());
        const toward11 = plans.find(plan => key(plan.to) === '1,1')!;
        expect(toward11.path.map(key)).toEqual(['2,2', '1,1']);
    });

    it('相走田不塞象眼、不过河：象眼站满人照样跳，落点出界才被裁', () => {
        // 棋盘左上角：只有一个对角两格的落点 (2,2)，且它的象眼 (1,1) 有人也不影响
        const corner = getXiangMovePlans([0, 0]);
        expect(corner.map(plan => key(plan.to))).toEqual(['2,2']);
        expect(corner[0].path.map(key)).toEqual(['1,1', '2,2']);
    });

    it('昭神态 G 型一笔绕外圈，可停在途中任意一格，路径随步数累加', () => {
        const plans = getGMovePlans([3, 3]);
        expect(plans).toHaveLength(8);
        expect(plans.map(plan => key(plan.to))).toEqual([
            '2,4', '2,3', '2,2', '3,2', '4,2', '4,3', '4,4', '3,4',
        ]);
        // 停在第 3 格时，前面走过的 3 格都算路径（技能一靠它结算"路径上的目标"）
        expect(plans[2].path.map(key)).toEqual(['2,4', '2,3', '2,2']);
        // 走完一圈回到右侧收内钩，最后一格是起点的右邻
        expect(plans[7].to).toEqual([3, 4]);
    });

    it('贴边贴角时 G 少几格，不会断到棋盘外', () => {
        // 左上角只剩下方两格与右邻一格可停；出界的笔画直接跳过，整笔不断
        expect(getGMovePlans([0, 0]).map(plan => key(plan.to))).toEqual(['1,0', '1,1', '0,1']);
        expect(getGMovePlans([0, 3]).map(plan => key(plan.to))).toEqual(['0,2', '1,2', '1,3', '1,4', '0,4']);
    });

    it('落点被占就不给走，形态决定用哪套走法', () => {
        const zhaoShen = makeXuanyuan([3, 3], true);
        const normal = makeXuanyuan([3, 3], false);
        const blocker = makeEnemy('blocker', [2, 4]);
        const state = stateWith(boardWith([normal, blocker]), [normal], [blocker]);

        expect(getXuanyuanMovePlans(zhaoShen, state).some(plan => key(plan.to) === '2,4')).toBe(false);
        // 田字落点 (1,1) 空着，所以普通态仍能跳过去
        expect(getXuanyuanMovePlans(normal, state).map(plan => key(plan.to)).sort())
            .toEqual(['1,1', '1,5', '5,1', '5,5'].sort());
    });
});

describe('轩辕神君 · 昭神形态', () => {
    it('金痕只盖一次，进度按在场敌人数算', () => {
        const hero = makeXuanyuan([0, 0]);
        const enemy = makeEnemy('e1', [2, 2]);
        const state = stateWith(boardWith([hero, enemy]), [hero], [enemy]);

        markZhaoShenHit(enemy, hero);
        markZhaoShenHit(enemy, hero);
        expect(enemy.effects.filter(effect => effect.name === ZHAOSHEN_MARK)).toHaveLength(1);
        expect(getZhaoShenProgress(hero, state)).toEqual({ hit: 1, total: 1 });
    });

    it('在场敌人都被命中过才变身，且变完不再回落', () => {
        const hero = makeXuanyuan([0, 0]);
        const first = makeEnemy('e1', [2, 2]);
        const second = makeEnemy('e2', [4, 4]);
        const state = stateWith(boardWith([hero, first, second]), [hero], [first, second]);

        markZhaoShenHit(first, hero);
        expect(tryEnterZhaoShen(hero, state)).toBe(false);
        expect(isZhaoShen(hero)).toBe(false);

        markZhaoShenHit(second, hero);
        expect(tryEnterZhaoShen(hero, state)).toBe(true);
        expect(isZhaoShen(hero)).toBe(true);
        // 已变身时再调用不重复触发（战报不该连播）
        expect(tryEnterZhaoShen(hero, state)).toBe(false);
    });

    it('补员上来的新人没被盖过章，会把昭神条件重新卡住', () => {
        const hero = makeXuanyuan([0, 0]);
        const first = makeEnemy('e1', [2, 2]);
        markZhaoShenHit(first, hero);
        const state = stateWith(boardWith([hero, first]), [hero], [first]);
        expect(tryEnterZhaoShen(hero, state)).toBe(true);

        const reinforcement = makeEnemy('e3', [5, 5]);
        const next = stateWith(boardWith([hero, first, reinforcement]), [hero], [first, reinforcement]);
        expect(getZhaoShenProgress(hero, next)).toEqual({ hit: 1, total: 2 });
    });

    it('已经倒下的敌人不再计入在场人数', () => {
        const hero = makeXuanyuan([0, 0]);
        const alive = makeEnemy('e1', [2, 2]);
        const dead = makeEnemy('e2', [4, 4]);
        dead.state = HeroState.DEAD;
        dead.position = null;
        markZhaoShenHit(alive, hero);
        const state = stateWith(boardWith([hero, alive]), [hero], [alive, dead]);
        expect(getZhaoShenProgress(hero, state)).toEqual({ hit: 1, total: 1 });
        expect(tryEnterZhaoShen(hero, state)).toBe(true);
    });
});

describe('飞剑体系', () => {
    it('同格重复落剑只刷新持续，不叠第二把', () => {
        const hero = makeXuanyuan([3, 3]);
        const state = stateWith(boardWith([hero]), [hero], []);
        placeFlyingSword(state, hero, [1, 1]);
        placeFlyingSword(state, hero, [1, 1]);
        expect(countFlyingSwords(state, hero.id)).toBe(1);
    });

    it('超过 6 把请走最早的那把', () => {
        const hero = makeXuanyuan([3, 3]);
        const state = stateWith(boardWith([hero]), [hero], []);
        const cells: Position[] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 5]];
        for (const cell of cells) {
            placeFlyingSword(state, hero, cell);
        }
        const swords = getFlyingSwords(state, hero.id);
        expect(swords).toHaveLength(FLYING_SWORD_LIMIT);
        expect(swords.some(sword => key(sword.position) === '0,0')).toBe(false);
        // 最后铺下的那把一定留着
        expect(swords.some(sword => key(sword.position) === '1,5')).toBe(true);
    });

    it('出界的格子不留剑', () => {
        const hero = makeXuanyuan([0, 0]);
        const state = stateWith(boardWith([hero]), [hero], []);
        placeFlyingSword(state, hero, [-1, 0]);
        placeFlyingSword(state, hero, [6, 6]);
        expect(countFlyingSwords(state, hero.id)).toBe(0);
    });

    it('回收只吃周身四个斜角，正交方向与远处都不算', () => {
        const hero = makeXuanyuan([3, 3]);
        const state = stateWith(boardWith([hero]), [hero], []);
        for (const cell of [[2, 2], [2, 4], [4, 2], [4, 4], [2, 3], [0, 0]] as Position[]) {
            placeFlyingSword(state, hero, cell);
        }
        expect(getDiagonalSwords(state, hero).map(sword => key(sword.position)).sort())
            .toEqual(['2,2', '2,4', '4,2', '4,4'].sort());
    });

    it('免伤按把累加、不设上限，且只有一条同名效果', () => {
        const hero = makeXuanyuan([3, 3]);
        expect(addSwordMitigation(hero, 3)).toBeCloseTo(0.3);
        expect(addSwordMitigation(hero, 4)).toBeCloseTo(0.7);
        const effects = hero.effects.filter(effect => effect.name === SWORD_MITIGATION_EFFECT);
        expect(effects).toHaveLength(1);
        expect(effects[0].value).toBeCloseTo(0.7);
    });

    it('剑附着到离它最近的友方身上，多把累加进同一个计数', () => {
        const hero = makeXuanyuan([3, 3]);
        const ally = createHero('liuli', 'player1', [0, 5]);
        const state = stateWith(boardWith([hero, ally]), [hero, ally], []);
        placeFlyingSword(state, hero, [3, 4]);
        placeFlyingSword(state, hero, [0, 4]);

        const swords = getFlyingSwords(state, hero.id);
        expect(findNearestAllyForSword(state, swords[0])!.id).toBe(hero.id);
        expect(findNearestAllyForSword(state, swords[1])!.id).toBe(ally.id);

        attachSwordToAlly(ally, 1);
        attachSwordToAlly(ally, 2);
        expect(ally.counters['御剑']).toBe(3);
    });

    it('回收后剑真的从棋盘上消失', () => {
        const hero = makeXuanyuan([3, 3]);
        const state = stateWith(boardWith([hero]), [hero], []);
        placeFlyingSword(state, hero, [2, 2]);
        const sword = getDiagonalSwords(state, hero)[0];
        removeFlyingSword(state, sword.id);
        expect(countFlyingSwords(state, hero.id)).toBe(0);
    });
});
