import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../src/data/skills';
import type { GameState, Hero, Position } from '../../src/types/game';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { MovementSystem } from '../../src/core/movement-system';
import {
    ATTACHED_SWORD_SHOT_DAMAGE,
    SWORD_MITIGATION_PER_STACK,
    addSwordMitigation,
    attachSwordToAlly,
    fireAttachedSwords,
    getXuanyuanLeapCells,
    placeFlyingSword,
} from '../../src/core/flying-sword';
import { getLeapsUsed, markZhaoShenHit, setLeapsUsed, tryEnterZhaoShen } from '../../src/core/xuanyuan-form';
import { addHero, makeGameState } from '../helpers/game-state';

const SKILL1 = SKILLS['xuanyuan_skill1'];
const SKILL2 = SKILLS['xuanyuan_skill2'];

/** 无被动干扰的标靶：墨澜模板 + 显式 100 HP，便于精确断言伤害数字 */
function makeDummy(state: GameState, owner: 'player1' | 'player2', position: Position): Hero {
    const hero = addHero(state, 'moran', owner, position);
    hero.passiveId = undefined;
    hero.maxHp = 100;
    hero.currentHp = 100;
    return hero;
}

function makeXuanyuan(state: GameState, position: Position, zhaoShen = false): Hero {
    const hero = addHero(state, 'xuanyuan', 'player1', position);
    if (zhaoShen) hero.counters['昭神'] = 1;
    return hero;
}

function encode(pos: Position): number {
    return pos[0] * 6 + pos[1];
}

/** 目标格由 SkillSystem 写入 __extended_target，单测里直接模拟这一步 */
function click(caster: Hero, cell: Position): void {
    caster.counters['__extended_target'] = encode(cell);
}

function makeState(): GameState {
    return makeGameState({ boardEffects: [] });
}

function swordCells(state: GameState): string[] {
    return state.boardEffects
        .filter((effect) => effect.type === 'flying-sword')
        .map((effect) => `${effect.position[0]},${effect.position[1]}`)
        .sort();
}

describe('轩辕神君 · 御剑·贯阵（基础形态：象走田跳斩）', () => {
    it('路径命中 5 点 + 落点周圈 6 点，命中处留下飞剑，本体落位', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0]);
        const pathTarget = makeDummy(state, 'player2', [1, 1]);
        const ringTarget = makeDummy(state, 'player2', [2, 3]);
        const untouched = makeDummy(state, 'player2', [4, 4]);

        click(caster, [2, 2]);
        const result = SKILL1.execute!(caster, 0, state);
        expect(result.success).toBe(true);

        // 路径目标：先吃 5 点跳斩，再吃周圈 6 点
        expect(pathTarget.currentHp).toBe(100 - 5 - 6);
        // 周圈目标只吃 6 点
        expect(ringTarget.currentHp).toBe(100 - 6);
        // 远端目标不受影响
        expect(untouched.currentHp).toBe(100);

        // 命中目标位置各留下一把飞剑
        expect(swordCells(state)).toEqual(['1,1', '2,3']);

        // 本体完成跃迁
        expect(caster.position).toEqual([2, 2]);
        expect(state.board[0][0]).toBeNull();
        expect(state.board[2][2]).toBe(caster);
    });

    it('落点被占据时无法跃迁（不造成伤害、不位移）', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0]);
        const blocker = makeDummy(state, 'player2', [2, 2]);

        click(caster, [2, 2]);
        const result = SKILL1.execute!(caster, 0, state);
        expect(result.success).toBe(false);
        expect(blocker.currentHp).toBe(100);
        expect(caster.position).toEqual([0, 0]);
        expect(swordCells(state)).toEqual([]);
    });
});

describe('轩辕神君 · 御剑·贯阵（昭神形态：G型踩剑跃击）', () => {
    it('踩毁终点的飞剑，路径 4 点 + 周圈 8 点，连跳次数 +1', () => {
        const state = makeState();
        // G 型从 [0,0] 只能踩到相邻终点；盘内行走顺序为 [1,0]→[1,1]→[0,1]
        const caster = makeXuanyuan(state, [0, 0], true);
        placeFlyingSword(state, caster, [1, 1]);
        const pathTarget = makeDummy(state, 'player2', [1, 0]); // 沿途格
        const ringTarget = makeDummy(state, 'player2', [1, 2]); // 仅落点周圈

        click(caster, [1, 1]);
        const result = SKILL1.execute!(caster, 0, state);
        expect(result.success).toBe(true);
        expect(pathTarget.currentHp).toBe(100 - 4 - 8);
        expect(ringTarget.currentHp).toBe(100 - 8);
        expect(caster.position).toEqual([1, 1]);

        // 终点飞剑被踩毁，命中处留下新飞剑
        expect(swordCells(state)).toEqual(['1,0', '1,2']);
        // 连跳计数 +1
        expect(getLeapsUsed(caster)).toBe(1);
    });

    it('昭神跃击的可选格 = G 型终点中踩得到飞剑的空格', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2], true);
        placeFlyingSword(state, caster, [3, 3]); // 相邻终点、空格 → 可选
        placeFlyingSword(state, caster, [0, 4]); // 距离过远，不是 G 型终点 → 不可选
        placeFlyingSword(state, caster, [1, 2]); // 终点但被占据 → 不可选
        makeDummy(state, 'player2', [1, 2]);

        expect(getXuanyuanLeapCells(caster, state)).toEqual([[3, 3]]);
    });

    it('目标格没有飞剑时跃击失败', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2], true);

        click(caster, [3, 3]);
        expect(SKILL1.execute!(caster, 0, state).success).toBe(false);
        expect(caster.position).toEqual([2, 2]);
    });

    it('单次行动最多三连跳，第四次出手失败', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2], true);
        placeFlyingSword(state, caster, [3, 3]);

        setLeapsUsed(caster, 3);
        click(caster, [3, 3]);
        const result = SKILL1.execute!(caster, 0, state);
        expect(result.success).toBe(false);
        expect(caster.position).toEqual([2, 2]);
        // 失败的出手不消耗飞剑
        expect(swordCells(state)).toEqual(['3,3']);
    });
});

describe('轩辕神君 · 御剑·归元（基础形态：斜向回收）', () => {
    it('回收四斜格飞剑：命中目标 6 点，每把飞剑叠加 10% 御剑免伤', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2]);
        caster.currentHp = 40;
        placeFlyingSword(state, caster, [1, 1]);
        placeFlyingSword(state, caster, [1, 3]);
        placeFlyingSword(state, caster, [3, 1]);
        const occupant = makeDummy(state, 'player2', [1, 1]);

        const result = SKILL2.execute!(caster, 0, state);
        expect(result.success).toBe(true);

        // 飞剑所在格的敌方目标被剑气命中
        expect(occupant.currentHp).toBe(100 - 6);
        // 飞剑全部回收
        expect(swordCells(state)).toEqual([]);
        // 免伤护盾：3 层 × 10% = 30%
        const mitigation = caster.effects.find((effect) => effect.name === '御剑免伤');
        expect(mitigation?.value).toBeCloseTo(SWORD_MITIGATION_PER_STACK * 3);
        expect(mitigation?.stackCount).toBe(3);
        // 未真正发射飞剑
        expect(caster.counters['御剑']).toBeUndefined();
    });

    it('没有可回收的飞剑时释放失败', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2]);

        expect(SKILL2.execute!(caster, 0, state).success).toBe(false);
        expect(caster.effects.some((effect) => effect.name === '御剑免伤')).toBe(false);
    });
});

describe('轩辕神君 · 御剑·归元（昭神形态：飞剑归母）', () => {
    it('全场飞剑飞向最近友军附身，化作御剑免伤', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0], true);
        placeFlyingSword(state, caster, [2, 2]);
        const ally = makeDummy(state, 'player1', [2, 3]);
        // 敌人离飞剑更近也不影响（找的是最近友军）
        makeDummy(state, 'player2', [1, 1]);

        const result = SKILL2.execute!(caster, 0, state);
        expect(result.success).toBe(true);

        expect(swordCells(state)).toEqual([]);
        expect(ally.counters['御剑']).toBe(1);
        const mitigation = ally.effects.find((effect) => effect.name === '御剑免伤');
        expect(mitigation?.value).toBeCloseTo(SWORD_MITIGATION_PER_STACK);
        // 附身阶段不直接伤害任何人
        expect(state.board[1][1]?.currentHp).toBe(100);
    });

    it('没有飞剑时释放失败', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0], true);
        makeDummy(state, 'player1', [1, 1]);

        expect(SKILL2.execute!(caster, 0, state).success).toBe(false);
    });
});

describe('轩辕神君 · 飞剑齐射（下次出手前发射）', () => {
    it('沿四个主方向发射 1 格：每方向 6 点 × 附身飞剑数，发射后护盾随剑离体', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0], true);
        const host = makeDummy(state, 'player1', [2, 2]);
        attachSwordToAlly(host, 2);
        addSwordMitigation(host, 2);

        const north = makeDummy(state, 'player2', [1, 2]);
        const south = makeDummy(state, 'player2', [3, 2]);
        const west = makeDummy(state, 'player2', [2, 1]);
        const east = makeDummy(state, 'player2', [2, 3]);
        const diagonal = makeDummy(state, 'player2', [1, 1]);

        fireAttachedSwords(caster, state);

        const expectedDamage = ATTACHED_SWORD_SHOT_DAMAGE * 2;
        for (const target of [north, south, west, east]) {
            expect(target.currentHp).toBe(100 - expectedDamage);
        }
        // 斜向不受击
        expect(diagonal.currentHp).toBe(100);

        // 剑已离体：附身计数与免伤护盾一并消失
        expect(host.counters['御剑']).toBeUndefined();
        expect(host.effects.some((effect) => effect.name === '御剑免伤')).toBe(false);
        expect(
            state.battleLog.some((entry) => (entry as any).message?.includes('飞剑沿四个主方向射出')),
        ).toBe(true);
    });
});

describe('轩辕神君 · 移动规则', () => {
    it('基础形态按象走田跃迁（4 个斜 2 格落点，无视象眼阻挡）', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2]);
        // 象眼位置有友军也不阻挡（跃迁）
        makeDummy(state, 'player1', [1, 1]);

        const positions = MovementSystem.getMovablePositions(caster, state).map(
            (position) => `${position[0]},${position[1]}`,
        );
        expect(positions.sort()).toEqual(['0,0', '0,4', '4,0', '4,4']);

        // 路径经过象眼但可跃迁
        const path = MovementSystem.getMovePath(caster, [4, 4], state);
        expect(path).toEqual([[3, 3], [4, 4]]);

        expect(MovementSystem.moveHero(caster, [4, 4], state)).toBe(true);
        expect(caster.position).toEqual([4, 4]);
        expect(state.board[2][2]).toBeNull();
        expect(state.board[4][4]).toBe(caster);
    });

    it('基础形态落点被占据时不可用', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2]);
        makeDummy(state, 'player2', [4, 4]);

        const positions = MovementSystem.getMovablePositions(caster, state).map(
            (position) => `${position[0]},${position[1]}`,
        );
        expect(positions).not.toContain('4,4');
        expect(positions).toContain('0,0');
    });

    it('昭神形态改为 G 型移动（八格，可停路径中途，不能踩 occupied）', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2], true);
        makeDummy(state, 'player2', [2, 3]);

        const positions = MovementSystem.getMovablePositions(caster, state).map(
            (position) => `${position[0]},${position[1]}`,
        );
        expect(positions).toContain('1,1');
        expect(positions).toContain('1,3'); // 外圈行走中途可停
        expect(positions).toContain('3,3');
        expect(positions).not.toContain('2,3'); // 被占据
        expect(positions.length).toBe(7);

        expect(MovementSystem.moveHero(caster, [1, 3], state)).toBe(true);
    });

    it('非轩辕英雄的移动不受影响', () => {
        const state = makeState();
        const dummy = makeDummy(state, 'player1', [2, 2]);

        const positions = MovementSystem.getMovablePositions(dummy, state);
        expect(positions.some(([row, col]) => Math.abs(row - 2) + Math.abs(col - 2) === 1)).toBe(true);
        // 曼哈顿范围 1 不会给出斜 2 格的象形落点
        expect(positions.some(([row, col]) => Math.abs(row - 2) === 2 && Math.abs(col - 2) === 2)).toBe(false);
    });
});

describe('轩辕神君 · 昭神觉醒（金痕印记）', () => {
    const hasMark = (hero: Hero) => hero.effects.filter((effect) => effect.name === '金痕').length;

    it('对每个敌方造成首次伤害盖下金痕，在场敌人全部盖章后觉醒昭神', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0]);
        const enemyA = makeDummy(state, 'player2', [3, 0]);
        const enemyB = makeDummy(state, 'player2', [4, 0]);

        const hit = (target: Hero) => {
            const damage = DamageCalculator.calculate(caster, target, 10, false, false, {});
            DamageCalculator.applyDamage(target, damage, caster, state);
        };

        hit(enemyA);
        expect(hasMark(enemyA)).toBe(1);
        expect(caster.counters['昭神']).toBeUndefined();

        // 重复命中同一目标不会重复盖章
        hit(enemyA);
        expect(hasMark(enemyA)).toBe(1);
        expect(caster.counters['昭神']).toBeUndefined();

        hit(enemyB);
        expect(hasMark(enemyB)).toBe(1);
        expect(caster.counters['昭神']).toBe(1);
        expect(state.battleLog.some((entry) => (entry as any).message?.includes('昭神降世'))).toBe(true);
    });

    it('打友军不盖金痕', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0]);
        const ally = makeDummy(state, 'player1', [3, 0]);

        const allyHit = DamageCalculator.calculate(caster, ally, 10, false, false, {});
        DamageCalculator.applyDamage(ally, allyHit, caster, state);
        expect(hasMark(ally)).toBe(0);
        expect(caster.counters['昭神']).toBeUndefined();
    });

    it('tryEnterZhaoShen：在场敌人全部有金痕时觉醒；空场不觉醒', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [0, 0]);
        // 空场不觉醒：等敌人到场后再由首次命中触发
        expect(tryEnterZhaoShen(caster, state)).toBe(false);

        const enemy = makeDummy(state, 'player2', [3, 0]);
        expect(tryEnterZhaoShen(caster, state)).toBe(false);

        markZhaoShenHit(enemy, caster);
        expect(tryEnterZhaoShen(caster, state)).toBe(true);
        expect(caster.counters['昭神']).toBe(1);
    });
});

describe('轩辕神君 · 连跳计数随行动结束失效', () => {
    it('__actionSerial 推进后旧连跳计数读作 0', () => {
        const state = makeState();
        const caster = makeXuanyuan(state, [2, 2], true);
        setLeapsUsed(caster, 2);
        expect(getLeapsUsed(caster)).toBe(2);

        caster.counters['__actionSerial'] = (caster.counters['__actionSerial'] ?? 0) + 1;
        expect(getLeapsUsed(caster)).toBe(0);
    });
});
