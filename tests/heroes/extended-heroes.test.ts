import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import {
    bardSkill1,
    bardSkill2,
    bountySkill1,
    bountySkill2,
    feynmanSkill1,
    feynmanSkill2,
    heroXSkill1,
    heroXSkill2,
    jetzmiSkill1,
    jetzmiSkill2,
    lilithSkill1,
    lilithSkill2,
    pipaSkill1,
    pipaSkill2,
    schrodingerSkill1,
    schrodingerSkill2,
    skeletonkingSkill1,
    skeletonkingSkill2,
    soulLampSkill1,
    soulLampSkill2,
    tPaintingSkill1,
    tPaintingSkill2,
    wangcaiSkill1,
    wangcaiSkill2,
    witherLordSkill1,
    witherLordSkill2,
    yinyangSkill1,
    yinyangSkill2,
} from '../../src/data/extended-skills';
import { placeBounties, checkYinyangLinks } from '../../src/data/extended-heroes';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('extended heroes', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('骸骨君王按当前阵亡数和共鸣结算两个技能', () => {
        const state = makeGameState();
        const caster = addHero(state, 'skeletonking', 'player1', [2, 2]);
        const dead = addHero(state, 'baize', 'player1', [0, 0]);
        dead.state = HeroState.DEAD;
        state.board[0][0] = null;
        state.deathCounters.player1Dead = 3;
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);

        skeletonkingSkill1.execute!(caster, [enemy], state);
        expect(enemy.currentHp).toBe(enemy.maxHp - 10);
        skeletonkingSkill2.execute!(caster, [enemy], state);
        expect(enemy.currentHp).toBe(enemy.maxHp - 23);
    });

    it('骸骨君王亡灵唤回复活暂时阵亡友方时恢复其阵亡时的生命值', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const state = makeGameState();
        const caster = addHero(state, 'skeletonking', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [0, 0]);
        ally.currentHp = 15;
        GameEngine.tempDeath(ally, state);
        state.deathCounters.player1Dead = 3;
        const enemy = addHero(state, 'baize', 'player2', [5, 5]);

        skeletonkingSkill2.execute!(caster, [enemy], state);

        expect(ally.state).toBe(HeroState.ALIVE);
        expect(ally.currentHp).toBe(15);
        expect(ally.hasActedThisTurn).toBe(false);
        expect(ally.hasMovedThisTurn).toBe(false);
    });

    it('杰茨米技能导致的暂时死亡为原地切换形态，不下场且计入共鸣', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const state = makeGameState();
        const caster = addHero(state, 'jetzmi', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        jetzmiSkill1.execute!(caster, [enemy], state);
        expect(caster.state).toBe(HeroState.ALIVE);
        expect(caster.position).toEqual([2, 2]);
        expect(caster.currentHp).toBe(caster.maxHp);
        expect(caster.counters['jetzmi_form']).toBe(1);
        expect(state.deathCounters.player1Dead).toBe(1);
        // 切回城主形态测试技能2吸血强化
        caster.counters['jetzmi_form'] = 0;
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        jetzmiSkill2.execute!(caster, [], state);
        expect(EffectManager.getEffect(caster, '亡灵吸血')?.value).toBe(0.5);
        expect(caster.counters['jetzmi_vampire_rate']).toBe(0.75);
        expect(caster.state).toBe(HeroState.ALIVE);
    });

    it('杰茨米强化终焉斩消耗2点亡灵共鸣攻击第二个目标', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const state = makeGameState();
        const caster = addHero(state, 'jetzmi', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 3]);
        const enemyB = addHero(state, 'zhenxiao', 'player2', [3, 2]);
        state.deathCounters.player1Dead = 3;
        caster.counters['__jetzmi_enhanced'] = 1;

        jetzmiSkill1.execute!(caster, [enemyA, enemyB], state);

        expect(enemyA.currentHp).toBe(enemyA.maxHp - 9);
        expect(enemyB.currentHp).toBe(enemyB.maxHp - 9);
        expect(state.deathCounters.player1Dead).toBe(1);
        expect(caster.state).toBe(HeroState.ALIVE);
    });

    it('杰茨米不强化终焉斩时只攻击一个目标且不消耗共鸣', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const state = makeGameState();
        const caster = addHero(state, 'jetzmi', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 3]);
        const enemyB = addHero(state, 'zhenxiao', 'player2', [3, 2]);
        state.deathCounters.player1Dead = 3;

        jetzmiSkill1.execute!(caster, [enemyA, enemyB], state);

        expect(enemyA.currentHp).toBe(enemyA.maxHp - 9);
        expect(enemyB.currentHp).toBe(enemyB.maxHp);
        expect(state.deathCounters.player1Dead).toBe(3);
    });

    it('杰茨米终焉国王形态技能1只通过死亡事件获得1点共鸣', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const state = makeGameState();
        const caster = addHero(state, 'jetzmi', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        caster.counters['jetzmi_form'] = 1;
        state.deathCounters.player1Dead = 2;

        jetzmiSkill1.execute!(caster, [enemy], state);

        expect(caster.counters['jetzmi_form']).toBe(0);
        expect(caster.state).toBe(HeroState.ALIVE);
        expect(state.deathCounters.player1Dead).toBe(3); // 2 + 1（死亡事件），无额外+1
    });

    it('五弦琵琶的音符追击增加和弦，技能二消耗和弦', () => {
        const state = makeGameState();
        const pipa = addHero(state, 'pipa', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        pipaSkill1.execute!(pipa, [ally], state);
        const hit = DamageCalculator.calculate(ally, enemy, 5);
        DamageCalculator.applyDamage(enemy, hit, ally, state);
        expect(pipa.counters['和弦']).toBe(1);
        const before = enemy.currentHp;
        pipaSkill2.execute!(pipa, [enemy], state);
        expect(enemy.currentHp).toBe(before - 3);
        expect(pipa.counters['和弦']).toBe(0);
    });

    it('赏金猎人悬赏敌方全员，奖励归实际击杀者', () => {
        const state = makeGameState();
        const bounty = addHero(state, 'bounty', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [1, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        const secondEnemy = addHero(state, 'liuli', 'player2', [3, 3]);
        bounty.currentHp -= 10;
        const hit = DamageCalculator.calculate(ally, enemy, 10);
        DamageCalculator.applyDamage(enemy, hit, ally, state);
        expect(enemy.currentHp).toBe(enemy.maxHp - 10);
        bountySkill2.execute!(bounty, [enemy], state);
        expect(bounty.currentHp).toBe(bounty.maxHp - 4);

        placeBounties(bounty, state);
        expect(EffectManager.hasEffect(enemy, '悬赏·永久吸血')).toBe(true);
        expect(EffectManager.hasEffect(secondEnemy, '悬赏·永久吸血')).toBe(true);
        expect(EffectManager.hasEffect(bounty, '赏金吸血')).toBe(false);

        enemy.currentHp = 1;
        const finishingHit = DamageCalculator.calculate(ally, enemy, 5);
        DamageCalculator.applyDamage(enemy, finishingHit, ally, state);
        expect(EffectManager.hasEffect(ally, '赏金吸血')).toBe(true);
        expect(EffectManager.hasEffect(bounty, '赏金吸血')).toBe(false);
        expect(state.battleLog.some(log =>
            log.type === 'damage' &&
            log.message.includes(`${ally.name}对${enemy.name}造成`)
        )).toBe(true);
    });

    it('赏金猎人被动在战斗开始时向敌方全员随机发布赏金', () => {
        const state = makeGameState();
        const bounty = addHero(state, 'bounty', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        const secondEnemy = addHero(state, 'liuli', 'player2', [3, 3]);

        GameEngine.startNewTurn(state);

        expect(EffectManager.hasEffect(enemy, '悬赏·永久吸血')).toBe(true);
        expect(EffectManager.hasEffect(secondEnemy, '悬赏·永久吸血')).toBe(true);
        expect(bounty.counters['bounty_placed']).toBe(1);
    });

    it('猎杀令标记目标后，友方攻击时赏金猎人追加追击', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const state = makeGameState();
        const bounty = addHero(state, 'bounty', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [1, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);

        bountySkill1.execute!(bounty, [enemy], state);
        expect(EffectManager.hasEffect(enemy, '猎杀令')).toBe(true);

        const before = enemy.currentHp;
        const hit = DamageCalculator.calculate(ally, enemy, 5);
        DamageCalculator.applyDamage(enemy, hit, ally, state);
        expect(enemy.currentHp).toBe(before - 9);
    });

    it('天威赏金在正常击杀后为击杀者额外触发一次（追加猎杀令）', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const state = makeGameState();
        const bounty = addHero(state, 'bounty', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        const secondEnemy = addHero(state, 'liuli', 'player2', [3, 3]);
        placeBounties(bounty, state);
        expect(EffectManager.hasEffect(enemy, '悬赏·天威再临')).toBe(true);

        enemy.currentHp = 1;
        const hit = DamageCalculator.calculate(bounty, enemy, 5);
        DamageCalculator.applyDamage(enemy, hit, bounty, state);
        expect(EffectManager.hasEffect(enemy, '悬赏·天威再临')).toBe(false);
        // 击杀触发天威 + 悬赏·天威再临再触发一次，向随机存活敌人追加猎杀令
        expect(EffectManager.hasEffect(secondEnemy, '猎杀令')).toBe(true);
    });

    it('阴阳线强化友方、削弱敌方并支持重复连接效果', () => {
        const state = makeGameState();
        const caster = addHero(state, 'yinyang', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        ally.currentHp -= 10;
        yinyangSkill1.execute!(caster, [ally], state);
        yinyangSkill1.execute!(caster, [ally], state);
        expect(ally.currentHp).toBe(ally.maxHp - 8);
        const before = enemy.currentHp;
        yinyangSkill2.execute!(caster, [enemy], state);
        yinyangSkill2.execute!(caster, [enemy], state);
        expect(enemy.currentHp).toBeLessThan(before);
    });

    it('阴阳师重复连接同一目标时恢复倍率+10%（上限50%）', () => {
        const state = makeGameState();
        const caster = addHero(state, 'yinyang', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        ally.currentHp = 10;
        yinyangSkill1.execute!(caster, [ally], state);   // 新建：不恢复，repeat=0.2
        expect(ally.currentHp).toBe(10);
        yinyangSkill1.execute!(caster, [ally], state);   // 重复1：恢复 floor(30×0.2)=6，repeat=0.3
        expect(ally.currentHp).toBe(16);
        yinyangSkill1.execute!(caster, [ally], state);   // 重复2：恢复 floor(24×0.3)=7，repeat=0.4
        expect(ally.currentHp).toBe(23);
        yinyangSkill1.execute!(caster, [ally], state);   // 重复3：恢复 floor(17×0.4)=6，repeat=0.5
        expect(ally.currentHp).toBe(29);
        expect(caster.counters['yinyang_yang_repeat']).toBe(0.5);
    });

    it('阴阳师链接目标超出两格范围后在其出手时断线并重置对应倍率', () => {
        const state = makeGameState();
        const caster = addHero(state, 'yinyang', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        yinyangSkill1.execute!(caster, [ally], state);
        expect(EffectManager.hasEffect(ally, '阳线攻击')).toBe(true);
        caster.counters['yinyang_yang_rate'] = 0.35;
        caster.counters['yinyang_yang_repeat'] = 0.4;
        state.board[2][3] = null;
        ally.position = [5, 5];
        state.board[5][5] = ally;

        checkYinyangLinks(caster, state);

        expect(EffectManager.hasEffect(ally, '阳线攻击')).toBe(false);
        expect(caster.counters['yinyang_yang_rate']).toBe(0.2);
        expect(caster.counters['yinyang_yang_repeat']).toBe(0.2);
    });

    it('阴阳师切换阳线目标时攻防加成与重复倍率都重置为20%', () => {
        const state = makeGameState();
        const caster = addHero(state, 'yinyang', 'player1', [2, 2]);
        const allyA = addHero(state, 'moran', 'player1', [2, 1]);
        const allyB = addHero(state, 'baize', 'player1', [2, 3]);
        caster.counters['yinyang_yang_rate'] = 0.35;
        caster.counters['yinyang_yang_repeat'] = 0.4;

        yinyangSkill1.execute!(caster, [allyA], state);

        expect(EffectManager.hasEffect(allyA, '阳线攻击')).toBe(true);
        expect(EffectManager.hasEffect(allyB, '阳线攻击')).toBe(false);
        expect(caster.counters['yinyang_yang_rate']).toBe(0.2);
        expect(caster.counters['yinyang_yang_repeat']).toBe(0.2);
    });

    it('缚魂灯创建法阵、暂时阵亡并能安排队友下轮复活', () => {
        const state = makeGameState();
        const lamp = addHero(state, 'soul_lamp', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        addHero(state, 'baize', 'player2', [5, 5]);
        soulLampSkill1.execute!(lamp, [lamp], state);
        expect(lamp.state).toBe(HeroState.TEMP_DEAD);
        expect(state.boardEffects?.[0].type).toBe('dark-circle');
        GameEngine.resurrectHero(lamp, 1, state);
        soulLampSkill2.execute!(lamp, [ally], state);
        expect(lamp.state).toBe(HeroState.DEAD);
        expect(ally.state).toBe(HeroState.TEMP_DEAD);
        expect(ally.counters['soul_lamp_revive_round']).toBe(2);
    });

    it('缚魂灯暂时阵亡给受益者临时吸血，复活后移除，真实死亡后永久', () => {
        const state = makeGameState();
        const lamp = addHero(state, 'soul_lamp', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        addHero(state, 'baize', 'player2', [5, 5]);

        // 暂时阵亡 → 受益者获得临时吸血30%，吸血率+20%
        GameEngine.tempDeath(lamp, state);
        expect(lamp.state).toBe(HeroState.TEMP_DEAD);
        expect(EffectManager.hasEffect(ally, '缚魂吸血')).toBe(true);
        expect(EffectManager.getEffect(ally, '缚魂吸血')?.value).toBe(0.3);
        expect(lamp.counters['soul_lamp_vampire_rate']).toBe(0.5);

        // 复活 → 临时吸血移除
        GameEngine.resurrectHero(lamp, 1, state);
        expect(EffectManager.hasEffect(ally, '缚魂吸血')).toBe(false);

        // 真实死亡 → 永久吸血（数值为当前累计值，真实死亡本身不再+20%）
        DamageCalculator.forceDeath(lamp, lamp, state);
        expect(EffectManager.hasEffect(ally, '缚魂吸血·永驻')).toBe(true);
        expect(EffectManager.getEffect(ally, '缚魂吸血·永驻')?.value).toBe(0.5);
        expect(lamp.counters['soul_lamp_vampire_rate']).toBe(0.5);
    });

    it('英雄X随机攻击叠加震怒，跃迁为空位并给邻近队友护盾', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hero_x', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 4]);
        const enemy = addHero(state, 'baize', 'player2', [5, 5]);
        heroXSkill1.execute!(caster, [enemy], state);
        expect(EffectManager.getEffect(enemy, '震怒')?.stackCount).toBe(1);
        SkillSystem.executeSkill(caster, heroXSkill2, [[2, 3]], state);
        expect(caster.position).toEqual([2, 3]);
        expect(ally.shield).toBe(5);
        expect(caster.counters['增势']).toBe(1);
    });

    it('英雄X技能2可以瞬移到斜角位置（一格范围含斜角）', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hero_x', 'player1', [2, 2]);

        const result = SkillSystem.executeSkill(caster, heroXSkill2, [[3, 3]], state);

        expect(result.success).toBe(true);
        expect(caster.position).toEqual([3, 3]);
    });

    it('琵琶技能1给两格范围内所有友方施加音符', () => {
        const state = makeGameState();
        const pipa = addHero(state, 'pipa', 'player1', [2, 2]);
        const allyA = addHero(state, 'moran', 'player1', [2, 3]);
        const allyB = addHero(state, 'liuli', 'player1', [2, 4]);
        const farAlly = addHero(state, 'baize', 'player1', [5, 5]);

        const result = SkillSystem.executeSkill(pipa, pipaSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(EffectManager.hasEffect(allyA, '音符')).toBe(true);
        expect(EffectManager.hasEffect(allyB, '音符')).toBe(true);
        expect(EffectManager.hasEffect(farAlly, '音符')).toBe(false);
    });

    it('吟游诗人技能1覆盖两格（曼哈顿距离）范围内所有友方', () => {
        const state = makeGameState();
        const bard = addHero(state, 'bard', 'player1', [2, 2]);
        const near = addHero(state, 'moran', 'player1', [2, 3]);
        const twoAway = addHero(state, 'liuli', 'player1', [2, 4]);
        const far = addHero(state, 'baize', 'player1', [5, 5]);

        const result = SkillSystem.executeSkill(bard, bardSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(EffectManager.hasEffect(near, '和声')).toBe(true);
        expect(EffectManager.hasEffect(twoAway, '和声')).toBe(true);
        expect(EffectManager.hasEffect(far, '和声')).toBe(false);
    });

    it('吟游诗人技能2治疗两格范围内所有友方', () => {
        const state = makeGameState();
        const bard = addHero(state, 'bard', 'player1', [2, 2]);
        const allyA = addHero(state, 'moran', 'player1', [2, 3]);
        const allyB = addHero(state, 'liuli', 'player1', [2, 4]);
        allyA.currentHp = 20;
        allyB.currentHp = 20;
        EffectManager.addCounter(allyA, '激情', 2);
        EffectManager.addCounter(allyB, '激情', 2);

        const result = SkillSystem.executeSkill(bard, bardSkill2, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(allyA.currentHp).toBe(20 + 5 + 2 * 3);
        expect(allyB.currentHp).toBe(20 + 5 + 2 * 3);
    });

    it('吟游诗人施加和声与激情，协奏曲消耗激情治疗', () => {
        const state = makeGameState();
        const bard = addHero(state, 'bard', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.currentHp -= 10;
        bardSkill1.execute!(bard, [ally], state);
        expect(ally.counters['激情']).toBe(1);
        bardSkill2.execute!(bard, [ally], state);
        expect(ally.currentHp).toBe(ally.maxHp - 2);
        expect(ally.counters['激情']).toBe(0);
    });

    it('吟游诗人被动低血时消耗全队激情回复生命', () => {
        const state = makeGameState();
        const bard = addHero(state, 'bard', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        ally.counters['激情'] = 4;
        bard.currentHp = 15;

        const hit = DamageCalculator.calculate(enemy, bard, 5);
        DamageCalculator.applyDamage(bard, hit, enemy, state);

        // 15-5=10 < 45×40%=18 → 回 4×3=12 → 22，并消耗全队激情
        expect(bard.currentHp).toBe(22);
        expect(ally.counters['激情']).toBe(0);
    });

    it('凋零之主技能1以两个对角位置构成2x2区域，只伤害区域内敌人', () => {
        const state = makeGameState();
        const caster = addHero(state, 'wither_lord', 'player1', [2, 2]);
        const insideA = addHero(state, 'baize', 'player2', [2, 3]);
        const insideB = addHero(state, 'liuli', 'player2', [3, 4]);
        const outside = addHero(state, 'moran', 'player2', [5, 5]);

        // 对角点 (2,3) 与 (3,4) 构成 2x2：{(2,3),(2,4),(3,3),(3,4)}
        SkillSystem.executeSkill(caster, witherLordSkill1, [[2, 3], [3, 4]], state);

        expect(EffectManager.hasEffect(insideA, '凋零')).toBe(true);
        expect(EffectManager.hasEffect(insideB, '凋零')).toBe(true);
        expect(EffectManager.hasEffect(outside, '凋零')).toBe(false);
        expect(insideA.currentHp).toBeLessThan(insideA.maxHp);
        expect(insideB.currentHp).toBeLessThan(insideB.maxHp);
        expect(outside.currentHp).toBe(outside.maxHp);
    });

    it('凋零之主施加并引爆凋零，三条生命会拦截致死', () => {
        const state = makeGameState();
        const caster = addHero(state, 'wither_lord', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        SkillSystem.executeSkill(caster, witherLordSkill1, [[2, 3], [3, 4]], state);
        expect(EffectManager.hasEffect(enemy, '凋零')).toBe(true);
        const before = enemy.currentHp;
        witherLordSkill2.execute!(caster, [enemy], state);
        expect(enemy.currentHp).toBeLessThan(before);
        DamageCalculator.forceDeath(caster, enemy, state);
        expect(caster.state).toBe(HeroState.ALIVE);
        expect(caster.counters['wither_lives']).toBe(2);
    });

    it('T型帛画可分别召唤金乌和玄龟，召唤物加入行动列表', () => {
        const state = makeGameState();
        const painting = addHero(state, 't_painting', 'player1', [2, 2]);
        SkillSystem.executeSkill(painting, tPaintingSkill1, [[2, 3]], state);
        SkillSystem.executeSkill(painting, tPaintingSkill2, [[3, 2]], state);
        const summons = state.player1Heroes.filter(hero => hero.counters['__isSummon'] === 1);
        expect(summons.map(hero => hero.name).sort()).toEqual(['玄龟', '金乌']);
        expect(state.board[2][3]).toBe(summons.find(hero => hero.name === '金乌'));
    });

    it('T型帛画已有金乌时技能一连锁：本体普攻6后金乌耀斑范围出手', () => {
        const state = makeGameState();
        const painting = addHero(state, 't_painting', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 4]);
        const enemyB = addHero(state, 'baize', 'player2', [1, 3]);
        SkillSystem.executeSkill(painting, tPaintingSkill1, [[2, 3]], state); // 召唤金乌
        expect(state.board[2][3]!.name).toBe('金乌');
        const beforeA = enemyA.currentHp;
        const beforeB = enemyB.currentHp;
        SkillSystem.executeSkill(painting, tPaintingSkill1, [[2, 4]], state); // 连锁
        // 本体 6 + 被动1（1个召唤物）= 7；金乌耀斑覆盖 A、B 两名敌人，各 敌数2 x 3 = 6
        expect(beforeA - enemyA.currentHp).toBe(13);
        expect(beforeB - enemyB.currentHp).toBe(6);
    });

    it('T型帛画已有玄龟时技能二连锁：本体普攻6后玄龟震击出手并可能眩晕', () => {
        const state = makeGameState();
        const painting = addHero(state, 't_painting', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 4]);
        SkillSystem.executeSkill(painting, tPaintingSkill2, [[2, 3]], state); // 召唤玄龟
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const before = enemy.currentHp;
        SkillSystem.executeSkill(painting, tPaintingSkill2, [[2, 4]], state); // 连锁
        expect(before - enemy.currentHp).toBe(13); // 本体 6 + 被动1 = 7，玄龟 6
        expect(EffectManager.hasEffect(enemy, '眩晕')).toBe(true);
    });

    it('费曼粒子束逐个衰减并积累能量，两个标记可形成轰爆矩形', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feynman', 'player1', [2, 0]);
        const first = addHero(state, 'moran', 'player2', [2, 1]);
        const second = addHero(state, 'baize', 'player2', [2, 3]);
        SkillSystem.executeSkill(caster, feynmanSkill1, [[2, 1]], state);
        expect(first.currentHp).toBe(first.maxHp - 8);
        expect(second.currentHp).toBe(second.maxHp - 6);
        expect(caster.counters['能量']).toBe(2);
        const before = second.currentHp;
        feynmanSkill2.execute!(caster, [first, second], state);
        expect(second.currentHp).toBeLessThan(before);
    });

    it('旺财积累七层财气后通灵，技能一在财神形态消耗财气', () => {
        const state = makeGameState();
        const caster = addHero(state, 'wangcai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        wangcaiSkill2.execute!(caster, [ally], state);
        caster.counters['财气'] = 6;
        caster.currentHp = 10;
        wangcaiSkill1.execute!(caster, [enemy], state);
        expect(caster.counters['wangcai_transformed']).toBe(1);
        caster.counters['财气'] = 2;
        wangcaiSkill1.execute!(caster, [enemy], state);
        expect(caster.counters['财气']).toBe(0);
    });

    it('薛定谔叠加态记录坍缩状态，量子纠缠传播50%伤害', () => {
        const state = makeGameState();
        const caster = addHero(state, 'schrodinger', 'player1', [2, 2]);
        const first = addHero(state, 'moran', 'player2', [2, 3]);
        const second = addHero(state, 'baize', 'player2', [3, 3]);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        schrodingerSkill1.execute!(caster, [first], state);
        expect(EffectManager.hasEffect(first, '观测坍缩受伤')).toBe(true);
        schrodingerSkill2.execute!(caster, [first, second], state);
        const firstLink = EffectManager.getEffect(first, '量子纠缠');
        const secondLink = EffectManager.getEffect(second, '量子纠缠');
        expect(firstLink?.name).toBe('量子纠缠');
        expect(firstLink?.name).not.toContain('entangle-');
        expect(firstLink?.linkId).toBeTruthy();
        expect(secondLink?.linkId).toBe(firstLink?.linkId);
        const before = second.currentHp;
        const hit = DamageCalculator.calculate(caster, first, 10);
        DamageCalculator.applyDamage(first, hit, caster, state);
        expect(second.currentHp).toBe(before - 5);
    });

    it('莉莉丝施加恐惧并把恐惧蔓延到目标周围', () => {
        const state = makeGameState();
        const caster = addHero(state, 'lilith', 'player1', [2, 0]);
        const first = addHero(state, 'moran', 'player2', [2, 2]);
        const second = addHero(state, 'baize', 'player2', [2, 3]);
        lilithSkill1.execute!(caster, [first], state);
        expect(EffectManager.hasEffect(first, '恐惧')).toBe(true);
        caster.counters['恐惧情绪能量'] = 2;
        const before = first.currentHp;
        lilithSkill2.execute!(caster, [first], state);
        expect(first.currentHp).toBe(before - 11);
        expect(EffectManager.hasEffect(second, '恐惧')).toBe(true);
    });

    it('骸骨君王回合末按全场当前阵亡数获得护盾', () => {
        const state = makeGameState();
        const caster = addHero(state, 'skeletonking', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [1, 1]);
        const enemy = addHero(state, 'baize', 'player2', [5, 5]);
        ally.state = HeroState.DEAD;
        state.board[1][1] = null;
        caster.hasActedThisTurn = true;
        GameEngine.endHeroAction(enemy, state);
        expect(caster.shield).toBe(3);
    });

    it('击杀会触发扩展英雄天威：杰茨米增加2点共鸣、旺财增加2攻击', () => {
        const jetzmiState = makeGameState();
        const jetzmi = addHero(jetzmiState, 'jetzmi', 'player1', [2, 2]);
        const firstVictim = addHero(jetzmiState, 'moran', 'player2', [2, 3]);
        firstVictim.currentHp = 1;
        DamageCalculator.applyDamage(
            firstVictim,
            DamageCalculator.calculate(jetzmi, firstVictim, 5),
            jetzmi,
            jetzmiState
        );
        expect(jetzmiState.deathCounters.player1Dead).toBe(2);

        const wangcaiState = makeGameState();
        const wangcai = addHero(wangcaiState, 'wangcai', 'player1', [2, 2]);
        const secondVictim = addHero(wangcaiState, 'moran', 'player2', [2, 3]);
        secondVictim.currentHp = 1;
        DamageCalculator.applyDamage(
            secondVictim,
            DamageCalculator.calculate(wangcai, secondVictim, 5),
            wangcai,
            wangcaiState
        );
        expect(wangcai.baseAttack).toBe(6);
    });

    it('T型帛画召唤物死亡使本体损失30%当前生命，帛画死亡清除召唤物', () => {
        const state = makeGameState();
        const painting = addHero(state, 't_painting', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        SkillSystem.executeSkill(painting, tPaintingSkill1, [[2, 3]], state);
        const summon = state.board[2][3]!;
        summon.currentHp = 1;
        DamageCalculator.applyDamage(
            summon,
            DamageCalculator.calculate(enemy, summon, 5),
            enemy,
            state
        );
        expect(painting.currentHp).toBe(32);
        SkillSystem.executeSkill(painting, tPaintingSkill2, [[3, 2]], state);
        const secondSummon = state.board[3][2]!;
        painting.currentHp = 1;
        DamageCalculator.applyDamage(
            painting,
            DamageCalculator.calculate(enemy, painting, 5),
            enemy,
            state
        );
        expect(secondSummon.state).toBe(HeroState.DEAD);
        expect(state.board[3][2]).toBeNull();
    });

    it('英雄X消耗3层增势，把下一次伤害减半转移给玩家选择的队友', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hero_x', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        caster.counters['增势'] = 3;
        state.heroXRedirectTargetIds = { [caster.id]: ally.id };
        const damage = DamageCalculator.calculate(enemy, caster, 10);
        DamageCalculator.applyDamage(caster, damage, enemy, state);
        expect(caster.currentHp).toBe(caster.maxHp);
        expect(ally.currentHp).toBe(ally.maxHp - 5);
        expect(caster.counters['增势']).toBe(0);
    });

    it('薛定谔击杀后进入等待玩家选择量子隧穿落点的状态', () => {
        const state = makeGameState();
        const caster = addHero(state, 'schrodinger', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        enemy.currentHp = 1;
        DamageCalculator.applyDamage(
            enemy,
            DamageCalculator.calculate(caster, enemy, 5),
            caster,
            state
        );
        expect(state.pendingBoardAction).toEqual({
            type: 'schrodinger-tianwei',
            heroId: caster.id,
        });
    });
});
