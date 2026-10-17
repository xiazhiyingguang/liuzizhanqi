import { describe, expect, it } from 'vitest';
import { createHero } from '../../src/data/heroes';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import {
    clearStagedGStart,
    getGMovePlans,
    getStagedGStart,
    getXiangMovePlans,
    getXuanyuanMovePlans,
    getZhaoShenProgress,
    G_START_COUNTER,
    isZhaoShen,
    markZhaoShenHit,
    setStagedGStart,
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

    it('昭神态 G 型以正四方向起笔，逆时针绕外圈七格，开口在起笔旁的斜格', () => {
        // 从正上方起笔：绕开右上（开口），收笔在正右——起笔 90° 顺时针一侧的对应位置
        const up = getGMovePlans([3, 3], 0);
        expect(up.map(plan => key(plan.to))).toEqual(['2,3', '2,2', '3,2', '4,2', '4,3', '4,4', '3,4']);
        // 停在第 3 格时，前面描过的 3 格都算路径（技能一靠它结算"路径上的目标"）
        expect(up[2].path.map(key)).toEqual(['2,3', '2,2', '3,2']);
        expect(up[6].to).toEqual([3, 4]);
        // 开口：起笔旁的斜格 (2,4) 不在这一笔上
        expect(up.some(plan => key(plan.to) === '2,4')).toBe(false);
        // 从正右起笔：整笔顺时针转 90°，开口换到右下，收笔在正下
        const right = getGMovePlans([3, 3], 1);
        expect(right.map(plan => key(plan.to))).toEqual(['3,4', '2,4', '2,3', '2,2', '3,2', '4,2', '4,3']);
        expect(right.some(plan => key(plan.to) === '4,4')).toBe(false);
        expect(right[6].to).toEqual([4, 3]);
    });

    it('普通移动的自动笔顺：每格取最短弧，八邻格照样描得全', () => {
        const auto = getGMovePlans([3, 3]);
        expect(auto.map(plan => key(plan.to)).sort())
            .toEqual(['2,2', '2,3', '2,4', '3,2', '3,4', '4,2', '4,3', '4,4'].sort());
        // 斜格从紧邻的正方向起笔弧最短；正方向格起笔即落点
        const diagonal = auto.find(plan => key(plan.to) === '2,4')!;
        expect(diagonal.path.map(key)).toEqual(['3,4', '2,4']);
        const straight = auto.find(plan => key(plan.to) === '2,3')!;
        expect(straight.path.map(key)).toEqual(['2,3']);
    });

    it('起笔格出界的方向不成立；贴角时自动笔顺照样覆盖盘内邻格', () => {
        // 左上角：正上/正左起笔出界，这一笔直接不成立；正下起笔描三格
        expect(getGMovePlans([0, 0], 0)).toEqual([]);
        expect(getGMovePlans([0, 0], 3)).toEqual([]);
        expect(getGMovePlans([0, 0], 2).map(plan => key(plan.to))).toEqual(['1,0', '1,1', '0,1']);
        expect(getGMovePlans([0, 0]).map(plan => key(plan.to)).sort()).toEqual(['0,1', '1,0', '1,1']);
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

describe('轩辕神君 · G 起笔暂存', () => {
    it('两段式点击之间起笔方向可存取，脏编码按未定笔处理', () => {
        const hero = makeXuanyuan([3, 3], true);
        expect(getStagedGStart(hero)).toBeNull();
        setStagedGStart(hero, 2);
        expect(getStagedGStart(hero)).toBe(2);
        hero.counters[G_START_COUNTER] = 7;
        expect(getStagedGStart(hero)).toBeNull();
        clearStagedGStart(hero);
        expect(getStagedGStart(hero)).toBeNull();
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
