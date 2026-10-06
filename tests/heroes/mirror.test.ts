import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { createMirrorClone } from '../../src/data/heroes';
import { syncPositionAnchoredEffects } from '../../src/data/extended-heroes';
import { mirrorSkill2 } from '../../src/data/skills';
import { HeroState, type GameState, type Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 镜·移形换影的阵亡回归。
 *
 * 路径伤害里可能发生受击方的反击（醉枕刀的醉意反击最典型），
 * 于是"镜"会在技能结算途中被打死：handleDeath 已经把死者格子清空、
 * 并顺带消散他的镜像。技能后半段若照常写回坐标，就会把
 * 阵亡的本体和已消散的镜像重新摆回棋盘，表现为"人死了棋子还在场上"。
 */

function setupPair(): { state: GameState; mirror: Hero; clone: Hero } {
    const state = makeGameState();
    const mirror = addHero(state, 'mirror', 'player1', [2, 2]);
    const clone = createMirrorClone('player1', mirror.id, [0, 0], mirror.maxHp, 8);
    state.board[0][0] = clone;
    state.player1Heroes.push(clone);
    return { state, mirror, clone };
}

function addCounterAttacker(state: GameState): Hero {
    const zui = addHero(state, 'zuizhendao', 'player2', [1, 1]);
    zui.currentHp = zui.maxHp;
    EffectManager.setCounter(zui, '醉意', 4); // 反击＝醉意×3 真实伤害＝12，足以收掉残血的镜
    return zui;
}

function occupiedCells(state: GameState): string[] {
    const cells: string[] = [];
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const unit = state.board[r][c];
            if (unit) cells.push(`${unit.name}@${r},${c}:${unit.state}`);
        }
    }
    return cells;
}

describe('镜·移形换影途中阵亡', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('点击镜像交换：本体被反击致死时不交换，棋盘上不留尸体', () => {
        const { state, mirror, clone } = setupPair();
        const zui = addCounterAttacker(state);
        mirror.currentHp = 6;

        const result = mirrorSkill2.execute!(mirror, [clone], state);

        expect(result.success).toBe(true);
        expect(mirror.state).toBe(HeroState.DEAD);
        expect(clone.state).toBe(HeroState.DEAD);
        expect(state.board[2][2]).toBeNull();
        expect(state.board[0][0]).toBeNull();
        expect(occupiedCells(state)).toEqual([`醉枕刀@1,1:${HeroState.ALIVE}`]);
        expect(result.log.join('\n')).toContain('移形换影中止');
        expect(zui.state).toBe(HeroState.ALIVE);
    });

    it('点击本体收回：本体被反击致死时不再合体回血', () => {
        const { state, mirror } = setupPair();
        addCounterAttacker(state);
        mirror.currentHp = 6;

        const result = mirrorSkill2.execute!(mirror, [mirror], state);

        expect(result.success).toBe(true);
        expect(mirror.state).toBe(HeroState.DEAD);
        expect(mirror.currentHp).toBe(0); // 没有被"生命合体 +12"抬回一条命
        expect(occupiedCells(state)).toEqual([`醉枕刀@1,1:${HeroState.ALIVE}`]);
        expect(result.log.join('\n')).toContain('镜像未能收回');
    });

    it('路径上没有敌人时，交换照常生效、镜像留在原位', () => {
        const { state, mirror, clone } = setupPair();
        addHero(state, 'zuizhendao', 'player2', [5, 5]);

        const result = mirrorSkill2.execute!(mirror, [clone], state);

        expect(result.success).toBe(true);
        expect(mirror.state).toBe(HeroState.ALIVE);
        expect(state.board[0][0]).toBe(mirror);
        expect(state.board[2][2]).toBe(clone);
        expect(mirror.position).toEqual([0, 0]);
        expect(clone.position).toEqual([2, 2]);
    });
});

/**
 * 破镜之刃的"镜域"：本体与镜像两点张成的外接矩形。
 * 旧实现是"本体或镜像周围 2 格"，镜把镜像甩到远处时几乎永远打不到人，
 * 层数叠上去却毫无反馈，看起来就像这个机制没了。
 */
describe('镜·破镜之刃的镜域', () => {
    function setupBlade(enemyPos: [number, number], clonePos: [number, number] | null) {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [0, 0]);
        const enemy = addHero(state, 'moran', 'player2', enemyPos);
        if (clonePos) {
            const clone = createMirrorClone('player1', mirror.id, clonePos, 15, 15);
            state.board[clonePos[0]][clonePos[1]] = clone;
            state.player1Heroes.push(clone);
        }
        return { state, mirror, enemy };
    }

    it('外接矩形罩住两点之间的整片：远处那角也斩得到', () => {
        const { state, mirror, enemy } = setupBlade([0, 5], [3, 5]);
        mirror.counters['破镜之刃'] = 1;

        expect(DamageCalculator.triggerMirrorBrokenBlade(mirror, state)).toBe(1);
        expect(enemy.currentHp).toBe(enemy.maxHp - 5);
        expect(mirror.counters['破镜之刃']).toBe(0);
    });

    it('镜域外不释放：层数留存并给一条战报', () => {
        const { state, mirror, enemy } = setupBlade([5, 0], [0, 1]);
        mirror.counters['破镜之刃'] = 1;

        expect(DamageCalculator.triggerMirrorBrokenBlade(mirror, state, true)).toBe(0);
        expect(enemy.currentHp).toBe(enemy.maxHp);
        expect(mirror.counters['破镜之刃']).toBe(1);
        expect(state.battleLog[state.battleLog.length - 1].message).toContain('留存1层');
    });

    it('敌人走进镜域时自动补放（含被击退/拖拽等强制位移）', () => {
        const { state, mirror, enemy } = setupBlade([5, 0], [0, 1]);
        mirror.counters['破镜之刃'] = 1;
        DamageCalculator.triggerMirrorBrokenBlade(mirror, state);
        expect(enemy.currentHp).toBe(enemy.maxHp);

        // 敌人挪进本体与镜像之间的矩形里
        state.board[5][0] = null;
        enemy.position = [0, 1];
        state.board[0][1] = enemy;
        syncPositionAnchoredEffects(state);

        expect(enemy.currentHp).toBe(enemy.maxHp - 5);
        expect(mirror.counters['破镜之刃']).toBe(0);
    });

    it('场上没有镜像时退回本体周围 5×5（贴边时按棋盘裁切）', () => {
        const { state, mirror } = setupBlade([5, 5], null);
        const near = addHero(state, 'baize', 'player2', [1, 2]);   // 本体在角上，可见域只有 3×3
        mirror.counters['破镜之刃'] = 1;

        expect(DamageCalculator.triggerMirrorBrokenBlade(mirror, state)).toBe(1);
        expect(near.currentHp).toBe(near.maxHp - 5);
        expect(mirror.currentHp).toBe(mirror.maxHp);
    });
});
