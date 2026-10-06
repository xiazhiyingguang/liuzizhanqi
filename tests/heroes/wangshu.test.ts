import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVAILABLE_HERO_IDS, createHero, createWukongClone } from '../../src/data/heroes';
import { getSkill } from '../../src/data/skills';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { getZhizhi } from '../../src/data/hero-zhizhi';
import { wangshuSkill1, wangshuSkill2, drainPendingSkillFxRequests } from '../../src/data/extended-skills';
import { getWangshuMultiplier, getWangshuPhase, wangshuTianwei } from '../../src/core/wangshu';
import { applyZhizhiForMode } from '../../src/core/hero-zhizhi';
import { visibleCounterEntries } from '../../src/core/hero-status-presentation';
import { SkillSystem } from '../../src/core/skill-system';
import { chooseComputerSkillPlan, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { useGameStore } from '../../src/store/game-store';
import { HeroState, type Hero, type Skill } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function flat(hero: Hero, hp: number, maxHp = hp): Hero {
    hero.currentHp = hp; hero.maxHp = maxHp; hero.effects = [];
    hero.defense = 0; hero.shield = 0; hero.passiveId = ''; hero.tianweiId = undefined;
    return hero;
}
function setup() {
    const state = makeGameState();
    const caster = addHero(state, 'wangshu', 'player1', [2, 2]);
    const enemy = flat(addHero(state, 'baize', 'player2', [0, 4]), 80, 100);
    const ally = flat(addHero(state, 'moran', 'player1', [3, 3]), 20, 100);
    const highest = flat(addHero(state, 'liuli', 'player1', [5, 5]), 100);
    return { state, caster, enemy, ally, highest };
}
const cast = (skill: Skill, caster: Hero, target: Hero, state: ReturnType<typeof makeGameState>) =>
    SkillSystem.executeSkill(caster, skill, [target.position!], state);

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(.99); setComputerAiDifficulty('master'); });
afterEach(() => { vi.restoreAllMocks(); useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); });

describe('望舒 · 朔望与月相', () => {
    it('作为素问进入选将、技能、图鉴与致知登记，初始50生命/移动2/新月/零储值', () => {
        const hero = createHero('wangshu', 'player1');
        expect(AVAILABLE_HERO_IDS).toContain('wangshu');
        expect([hero.name, hero.class, hero.maxHp, hero.moveRange, hero.baseAttack]).toEqual(['望舒', '素问', 50, 2, 0]);
        expect([hero.skill1Id, hero.skill2Id, hero.tianweiId]).toEqual(['wangshu_skill1', 'wangshu_skill2', 'wangshu_tianwei']);
        expect(getWangshuPhase(hero)).toBe(0); expect(getWangshuMultiplier(hero)).toBe(.5);
        expect([hero.counters['朔'], hero.counters['望']]).toEqual([0, 0]);
        expect(getSkill(hero.skill1Id)).toBe(wangshuSkill1);
        expect(getSkill(hero.skill2Id)).toBe(wangshuSkill2);
        expect(HERO_CODEX.find(entry => entry.id === 'wangshu')?.skills).toHaveLength(2);
        expect(getZhizhi('wangshu')).toHaveLength(3);
    });

    it('先攻击再治疗再攻击：16伤/朔44 → 42治/望38 → 43伤/朔29，当前月相先结算后升级', () => {
        const { state, caster, enemy, ally } = setup();
        expect(cast(wangshuSkill1, caster, enemy, state).damageDealt).toEqual([16]);
        expect([enemy.currentHp, caster.counters['朔'], getWangshuPhase(caster)]).toEqual([64, 44, 1]);
        expect(cast(wangshuSkill2, caster, ally, state).healingDone).toEqual([42]);
        expect([ally.currentHp, caster.counters['朔'], caster.counters['望'], getWangshuPhase(caster)]).toEqual([62, 44, 38, 2]);
        expect(cast(wangshuSkill1, caster, enemy, state).damageDealt).toEqual([43]);
        expect([enemy.currentHp, caster.counters['朔'], caster.counters['望'], getWangshuPhase(caster)]).toEqual([21, 29, 38, 2]);
    });

    it('第一次治疗使用50%，不会把已损生命20%也乘月相；可以治疗自己', () => {
        const { state, caster } = setup();
        caster.currentHp = 10; caster.counters['朔'] = 20;
        expect(SkillSystem.getValidTargetPositions(caster, wangshuSkill2, state)).toContainEqual(caster.position);
        expect(cast(wangshuSkill2, caster, caster, state).healingDone).toEqual([18]);
        expect(caster.currentHp).toBe(28); expect(caster.counters['望']).toBe(72);
        expect(getWangshuPhase(caster)).toBe(1);
    });

    it.each([[0, false, 21], [1, false, 22], [2, false, 24], [2, true, 26]])('月相%s/致知三%s：攻击与治疗均按倍率结算为%s', (phase, classic, amount) => {
        const { state, caster, enemy, ally } = setup();
        caster.counters['wangshu_moon_phase'] = Number(phase);
        caster.counters['talent_3'] = classic ? 1 : 0;
        caster.counters['望'] = 10;
        expect(cast(wangshuSkill1, caster, enemy, state).damageDealt).toEqual([amount]);
        caster.counters['wangshu_moon_phase'] = Number(phase); caster.counters['朔'] = 10;
        expect(cast(wangshuSkill2, caster, ally, state).healingDone).toEqual([amount]);
    });

    it('player2使用自己队伍的生命极值，结算不混入另一方', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'wangshu', 'player2', [2, 2]);
        const ally = flat(addHero(state, 'moran', 'player2', [3, 3]), 20, 100);
        flat(addHero(state, 'liuli', 'player2', [5, 5]), 100);
        const enemy = flat(addHero(state, 'baize', 'player1', [0, 4]), 80, 100);
        flat(addHero(state, 'moran', 'player1', [0, 0]), 1);
        cast(wangshuSkill1, caster, enemy, state);
        expect(caster.counters['朔']).toBe(44);
        expect(cast(wangshuSkill2, caster, ally, state).healingDone).toEqual([42]);
        expect(caster.counters['望']).toBe(38);
    });

    it('攻击为百分比加储值，显式不吃基础攻击力；两部分之和向下取整一次', () => {
        const { state, caster, enemy } = setup();
        caster.baseAttack = 999; caster.counters['望'] = 3; enemy.currentHp = 13;
        expect(wangshuSkill1.scalesWithAttack).toBe(false);
        expect(cast(wangshuSkill1, caster, enemy, state).damageDealt).toEqual([4]); // floor(2.6+1.5)
    });

    it('朔按护盾吸收后的当前生命差记录，储值覆盖而非累加，朔望均不被使用消耗', () => {
        const { state, caster, enemy } = setup();
        enemy.shield = 30; caster.counters['朔'] = 100;
        cast(wangshuSkill1, caster, enemy, state);
        expect(enemy.currentHp).toBe(80); expect(enemy.shield).toBe(14);
        expect(caster.counters['朔']).toBe(60);
    });

    it('生命差取绝对值，友方最低比敌人高也能记录朔', () => {
        const { state, caster, enemy, ally } = setup();
        ally.currentHp = 60; enemy.currentHp = 10;
        cast(wangshuSkill1, caster, enemy, state);
        expect(caster.counters['朔']).toBe(42); // 望舒50 - 敌人8
    });

    it('比较全场上阵存活角色，忽略阵亡、替补、召唤物和分身', () => {
        const { state, caster, enemy } = setup();
        const clone = createWukongClone('player1', 'other', [1, 1], 1);
        state.board[1][1] = clone; state.player1Heroes.push(clone);
        const summon = flat(addHero(state, 'moran', 'player1', [1, 2]), 1); summon.counters['__isSummon'] = 1;
        const dead = flat(addHero(state, 'moran', 'player1', [1, 3]), 0); dead.state = HeroState.DEAD;
        const bench = flat(createHero('baize', 'player1'), 1); state.player1Heroes.push(bench);
        cast(wangshuSkill1, caster, enemy, state);
        expect(caster.counters['朔']).toBe(44);
        expect(SkillSystem.getValidTargetPositions(caster, wangshuSkill2, state)).not.toContainEqual(clone.position);
        expect(SkillSystem.getValidTargetPositions(caster, wangshuSkill2, state)).not.toContainEqual(summon.position);
    });

    it('治疗封顶、不转溢出护盾，已有超上限生命不会被治疗扣掉', () => {
        const { state, caster, ally } = setup();
        caster.counters['朔'] = 500;
        expect(cast(wangshuSkill2, caster, ally, state).healingDone).toEqual([80]);
        expect(ally.currentHp).toBe(100); expect(ally.shield).toBe(0);
        ally.currentHp = 110;
        expect(cast(wangshuSkill2, caster, ally, state).healingDone).toEqual([0]);
        expect(ally.currentHp).toBe(110);
    });

    it.each(['empty', 'out-of-range', 'wrong-owner', 'dead', 'clone'] as const)('无效治疗目标 %s 不改变血量、储值和月相', kind => {
        const { state, caster, ally, enemy } = setup();
        let target = ally;
        if (kind === 'out-of-range') { state.board[3][3] = null; ally.position = [5, 3]; state.board[5][3] = ally; }
        if (kind === 'wrong-owner') target = enemy;
        if (kind === 'dead') ally.state = HeroState.DEAD;
        if (kind === 'clone') ally.counters['__isClone'] = 1;
        const before = structuredClone(caster.counters), hp = target.currentHp;
        const output = kind === 'empty' ? SkillSystem.executeSkill(caster, wangshuSkill2, [[0, 0]], state) : cast(wangshuSkill2, caster, target, state);
        expect(output.success).toBe(false); expect(caster.counters).toEqual(before); expect(target.currentHp).toBe(hp);
    });

    it('5×5含对角线，治疗高亮不包含敌人；攻击友方或范围外敌人失败', () => {
        const { state, caster, enemy, ally } = setup();
        expect(SkillSystem.getValidTargetPositions(caster, wangshuSkill1, state)).toContainEqual([0, 4]);
        expect(SkillSystem.getValidTargetPositions(caster, wangshuSkill2, state)).not.toContainEqual(enemy.position);
        expect(cast(wangshuSkill1, caster, ally, state).success).toBe(false);
        state.board[0][4] = null; enemy.position = [5, 4]; state.board[5][4] = enemy;
        expect(cast(wangshuSkill1, caster, enemy, state).success).toBe(false);
        expect(getWangshuPhase(caster)).toBe(0);
    });

    it('实际击杀触发满月，并登记天威日志与月满特效，技能后的升级不会降回上弦', () => {
        const { state, caster, enemy } = setup();
        enemy.currentHp = 10; caster.counters['望'] = 200;
        cast(wangshuSkill1, caster, enemy, state);
        expect(enemy.state).toBe(HeroState.DEAD); expect(getWangshuPhase(caster)).toBe(2);
        expect(state.battleLog.some(log => log.type === 'tianwei' && log.message.includes('月满'))).toBe(true);
        expect(drainPendingSkillFxRequests(state).some(fx => fx.skillId === 'wangshu_tianwei')).toBe(true);
    });

    it('天威直接进入满月；经典致知生命60、移动3、满月100%，幂等且标准模式保持50/2/80%', () => {
        const standard = createHero('wangshu', 'player1'), classic = createHero('wangshu', 'player2');
        applyZhizhiForMode(standard, 'standard'); applyZhizhiForMode(classic, 'classic'); applyZhizhiForMode(classic, 'classic');
        expect([standard.maxHp, standard.moveRange, classic.maxHp, classic.moveRange]).toEqual([50, 2, 60, 3]);
        expect(getWangshuMultiplier(classic)).toBe(.5);
        wangshuTianwei.execute(standard, makeGameState()); wangshuTianwei.execute(classic, makeGameState());
        expect([getWangshuMultiplier(standard), getWangshuMultiplier(classic)]).toEqual([.8, 1]);
    });

    it('状态卡显示初始新月50%及朔望0，满月后显示80%/100%', () => {
        const caster = createHero('wangshu', 'player1');
        expect(visibleCounterEntries(caster)).toEqual([
            { label: '月相', value: 0, displayValue: '新月 · 50%' }, { label: '朔', value: 0 }, { label: '望', value: 0 },
        ]);
        wangshuTianwei.execute(caster, makeGameState()); applyZhizhiForMode(caster, 'classic');
        expect(visibleCounterEntries(caster)[0].displayValue).toBe('满月 · 100%');
    });

    it('AI能治疗自己和积累月相，模拟不会修改真实朔望或遗留特效', () => {
        const state = makeGameState();
        const caster = addHero(state, 'wangshu', 'player1', [0, 0]); caster.currentHp = 10; caster.counters['朔'] = 30;
        addHero(state, 'moran', 'player2', [5, 5]);
        const before = structuredClone(caster.counters), hp = caster.currentHp;
        const plan = chooseComputerSkillPlan(state, caster);
        expect(plan?.skillId).toBe('wangshu_skill2'); expect(plan?.targetPositions).toEqual([[0, 0]]);
        expect(caster.counters).toEqual(before); expect(caster.currentHp).toBe(hp);
        expect(drainPendingSkillFxRequests(state)).toEqual([]);
    });

    it('store真实施法派发技能月蚀并消耗行动，无效施法不消耗行动', () => {
        const { state, caster, enemy } = setup();
        useGameStore.setState({ ...state, moveRange: [], skillRange: [], skillFx: [], activeHero: caster,
            selectedHero: caster, selectedSkill: wangshuSkill1, isOnlineMode: false, isAiMode: false,
            suppressOnlineBroadcast: false, pendingBoardAction: undefined });
        useGameStore.getState().executeSkill([0, 0]);
        expect(caster.hasActedThisTurn).toBe(false); expect(getWangshuPhase(caster)).toBe(0);
        useGameStore.getState().executeSkill(enemy.position!);
        expect(caster.hasActedThisTurn).toBe(true); expect(getWangshuPhase(caster)).toBe(1);
        expect(useGameStore.getState().skillFx.some(fx => fx.skillId === 'wangshu_skill1' && fx.profile.moon === 'drain')).toBe(true);
    });
});
