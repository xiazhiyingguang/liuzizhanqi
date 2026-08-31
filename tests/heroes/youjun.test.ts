import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { createWindLane } from '../../src/core/wind-lane';
import { youjunSkill1, youjunSkill2 } from '../../src/data/extended-skills';
import { addHero, makeGameState } from '../helpers/game-state';

/** 场上所有游隼风刃的坐标集合，便于断言「落在哪几格」 */
function bladeKeys(state: ReturnType<typeof makeGameState>): string[] {
    return (state.boardEffects ?? [])
        .filter(effect => effect.type === 'wind-blade')
        .map(effect => `${effect.position[0]},${effect.position[1]}`)
        .sort();
}

describe('游隼完整机制', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('拥有44生命、3移动与完整技能注册（天威暂未实装）', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        expect(youjun.name).toBe('游隼');
        expect(youjun.class).toBe('猎户');
        expect(youjun.maxHp).toBe(44);
        expect(youjun.moveRange).toBe(3);
        expect(youjun.skill1Id).toBe('youjun_skill1');
        expect(youjun.skill2Id).toBe('youjun_skill2');
        expect(youjun.tianweiId).toBeUndefined();
    });

    it('技能2四向风刃：风刃落在周身一格四向而非飞出，持续3回合且不伤害远处敌人', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        const farEnemy = addHero(state, 'baize', 'player2', [2, 5]);
        farEnemy.defense = 0.9; // 风刃为不可规避、无视护盾防御的固定伤害

        const result = SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '2,3', '3,2']);
        expect((state.boardEffects ?? []).every(effect => effect.duration === 3)).toBe(true);
        // 风刃不是投射物：释放瞬间不会打到不在相邻格上的敌人
        expect(farEnemy.currentHp).toBe(farEnemy.maxHp);
        expect(result.damageDealt).toEqual([]);
    });

    it('技能2贴身敌人立即按接触结算4点伤害且该方向不留风刃', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        const adjacentEnemy = addHero(state, 'baize', 'player2', [2, 3]);
        adjacentEnemy.defense = 0.9;

        const result = SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(adjacentEnemy.currentHp).toBe(adjacentEnemy.maxHp - 4);
        expect(result.damageDealt).toEqual([4]);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '3,2']);
    });

    it('技能2友军所在格照样留刃且不受伤害，只有棋盘外方向放不出', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [0, 0]); // 上方与左方出界
        const ally = addHero(state, 'moran', 'player1', [0, 1]);
        const enemy = addHero(state, 'baize', 'player2', [4, 4]);

        const result = SkillSystem.executeSkill(youjun, youjunSkill2, [[0, 0]], state);

        expect(result.success).toBe(true);
        expect(ally.currentHp).toBe(ally.maxHp);
        expect(enemy.currentHp).toBe(enemy.maxHp);
        expect(bladeKeys(state)).toEqual(['0,1', '1,0']);
    });

    it('与友军同格的风刃不伤友军，友军离开后对踏入的敌人照常触发', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        const enemy = addHero(state, 'baize', 'player2', [3, 3]);
        enemy.defense = 0.9;

        SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '2,3', '3,2']);

        expect(MovementSystem.moveHero(ally, [1, 3], state)).toBe(true);
        expect(ally.currentHp).toBe(ally.maxHp);

        expect(MovementSystem.moveHero(enemy, [2, 3], state)).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '3,2']);
    });

    it('疾掠常规最多3格并按公式造成伤害，穿透敌人落点为点击格', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 2]);
        youjun.counters['youjun_lastMove'] = 3; // 上回合移动3格

        // 冲刺3格：5×(1+0.3)×(1+0.3)=8.45 → 8点（取整）
        const result = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        expect(youjun.position).toEqual([2, 3]);
        expect(state.board[2][3]).toBe(youjun);
    });

    it('疾掠常规超出3格被拒绝', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 0]);

        const result = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 4]], state);

        expect(result.success).toBe(false);
        expect(youjun.position).toEqual([2, 0]);
    });

    it('身处同轴友方风道时疾掠可冲刺整行/整列', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 1]);
        const enemyMid = addHero(state, 'baize', 'player2', [2, 4]);
        youjun.counters['youjun_lastMove'] = 0;
        createWindLane(state, youjun, [2, 1], 'right');

        // 风道加成：横向点(2,5)共4格，穿透中段敌人后落在点击格
        const result = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 5]], state);

        expect(result.success).toBe(true);
        expect(youjun.position).toEqual([2, 5]);
        expect(enemyMid.currentHp).toBeLessThan(enemyMid.maxHp);
    });

    it('友军不再阻挡疾掠：穿过友军直取落点，友军不受伤害', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 0]);
        const ally = addHero(state, 'moran', 'player1', [2, 2]);
        const enemyBehind = addHero(state, 'baize', 'player2', [2, 4]);

        const result = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(youjun.position).toEqual([2, 3]);
        expect(state.board[2][3]).toBe(youjun);
        expect(state.board[2][2]).toBe(ally);
        expect(ally.currentHp).toBe(ally.maxHp);
        // 落点之后的敌人不在冲刺路径上，不受伤害
        expect(enemyBehind.currentHp).toBe(enemyBehind.maxHp);
    });

    it('敌人不阻挡疾掠：路径上的敌人全部受伤，落点为点击的空格', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 0]);
        const enemyA = addHero(state, 'baize', 'player2', [2, 1]);
        const enemyB = addHero(state, 'mowen', 'player2', [2, 2]);

        const result = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemyA.currentHp).toBeLessThan(enemyA.maxHp);
        expect(enemyB.currentHp).toBeLessThan(enemyB.maxHp);
        expect(youjun.position).toEqual([2, 3]);
    });

    it('落点被占据时疾掠失败：不位移也不误伤路径敌人', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 0]);
        const enemyOnLanding = addHero(state, 'baize', 'player2', [2, 3]);
        const enemyOnPath = addHero(state, 'mowen', 'player2', [2, 1]);

        const result = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 3]], state);

        expect(result.success).toBe(false);
        expect(youjun.position).toEqual([2, 0]);
        expect(enemyOnLanding.currentHp).toBe(enemyOnLanding.maxHp);
        expect(enemyOnPath.currentHp).toBe(enemyOnPath.maxHp);
        // 被占据的格子不应再出现在可选落点里
        expect(SkillSystem.getValidTargetPositions(youjun, youjunSkill1, state)).not.toContainEqual([2, 3]);
    });

    it('技能后被动触发再动：仅允许移动，收回风刃后刷新疾掠可再次冲锋', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 4]); // 站在远处，不影响四向风刃铺设

        // 放风刃 → 技能成功后被动登记额外行动
        const release = SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);
        expect(release.success).toBe(true);
        expect(state.pendingExtraActionHeroIds?.player1).toBe(youjun.id);

        // 模拟额外行动窗口：仅移动标记生效，技能一律被拒绝
        youjun.hasActedThisTurn = false;
        youjun.counters['youjun_extra_move_only'] = 1;
        expect(SkillSystem.canUseSkill(youjun, youjunSkill1, state)).toBe(false);
        expect(SkillSystem.canUseSkill(youjun, youjunSkill2, state)).toBe(false);

        // 移动踩上右侧风刃(2,3) → 收回并刷新疾掠
        expect(MovementSystem.moveHero(youjun, [2, 3], state)).toBe(true);
        expect((state.boardEffects ?? []).some(effect =>
            effect.type === 'wind-blade' && effect.position[0] === 2 && effect.position[1] === 3
        )).toBe(false);
        expect(youjun.counters['youjun_skill1_refreshed']).toBe(1);
        expect(youjun.counters['youjun_blade_refresh_used']).toBe(1);

        // 刷新后额外行动窗口内允许疾掠，不允许技能2
        expect(SkillSystem.canUseSkill(youjun, youjunSkill1, state)).toBe(true);
        expect(SkillSystem.canUseSkill(youjun, youjunSkill2, state)).toBe(false);

        // 疾掠冲锋成功并消耗刷新标记
        const dash = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 5]], state);
        expect(dash.success).toBe(true);
        expect(youjun.counters['youjun_skill1_refreshed']).toBeUndefined();
    });

    it('敌人踏入风刃格受到4点固定伤害，风刃随即消失', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [5, 2]);
        enemy.defense = 0.9;
        SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '2,3', '3,2']);

        // 沿 (4,2) 走到下侧风刃 (3,2)
        expect(MovementSystem.moveHero(enemy, [3, 2], state)).toBe(true);

        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '2,3']);
    });

    it('风刃是一次性的：命中后同一格不再重复受伤', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [5, 2]);
        enemy.defense = 0.9;
        SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);

        // 走上风刃(3,2)受伤 → 退到(4,2) → 再走回(3,2)：风刃已消失，不再受伤
        expect(MovementSystem.moveHero(enemy, [3, 2], state)).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
        expect(MovementSystem.moveHero(enemy, [4, 2], state)).toBe(true);
        expect(MovementSystem.moveHero(enemy, [3, 2], state)).toBe(true);

        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
    });

    it('友军经过风刃格无伤害也不收回', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 5]);
        SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 2]], state);

        // 友军踏入右侧风刃 (2,3)：无伤害、不收回、不刷新疾掠
        expect(MovementSystem.moveHero(ally, [2, 3], state)).toBe(true);

        expect(ally.currentHp).toBe(ally.maxHp);
        expect(bladeKeys(state)).toEqual(['1,2', '2,1', '2,3', '3,2']);
        expect(youjun.counters['youjun_skill1_refreshed']).toBeUndefined();
    });

    it('疾掠路径穿过风刃时收回风刃并再次武装疾掠（冲锋链）', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 3]);
        SkillSystem.executeSkill(youjun, youjunSkill2, [[2, 3]], state);
        // 四向风刃停在(1,3)(3,3)(2,2)(2,4)；重置次数并武装刷新，模拟下一轮收回
        youjun.counters['youjun_blade_refresh_used'] = 0;
        youjun.counters['youjun_skill1_refreshed'] = 1;

        // 向左疾掠2格，路径经过风刃格(2,2)
        const dash = SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 1]], state);

        expect(dash.success).toBe(true);
        // 冲刺消耗了武装，但沿途收回风刃立即再次武装——下一轮冲锋可用
        expect(youjun.counters['youjun_skill1_refreshed']).toBe(1);
        expect(youjun.counters['youjun_blade_refresh_used']).toBe(1);
        expect(bladeKeys(state)).toEqual(['1,3', '2,4', '3,3']);
    });

    it('上回合移动距离计入疾掠倍率并受6格上限约束', () => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player1', [2, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 2]);

        youjun.counters['youjun_lastMove'] = 6; // 引擎回合开始按 min(6, 累计位移) 定格
        SkillSystem.executeSkill(youjun, youjunSkill1, [[2, 3]], state);
        // 上限6：5×(1+0.3)×(1+0.6)=10.4 → 10点
        expect(enemy.currentHp).toBe(enemy.maxHp - 10);
    });
});
