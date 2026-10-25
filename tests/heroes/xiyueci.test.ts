import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import {
    LAMP_AURA_RANGE,
    LAMP_DURATION,
    WAKE_LAMP_HEAL,
    XIYUECI_KNOCKUP_RATE,
    XIYUECI_RING_DAMAGE,
    chebyshev,
    findLampAt,
    healFromWakeLamps,
    lampMitigationFor,
    lampShadows,
    placeLamp,
    shadowBodiesOnCell,
    shadowCellFor,
    shadowTargetsFor,
} from '../../src/core/lamp-shadow';
import { dilanSkill2, xiyueciSkill1, xiyueciSkill2 } from '../../src/data/extended-skills';
import { SKILLS, moranSkill1 } from '../../src/data/skills';
import { AVAILABLE_HERO_IDS, createHero, getHeroInfo } from '../../src/data/heroes';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 夕月辞：明灯（占一格的场地件）→ 灯影（由灯与此刻站位当场推导的投影，打影子＝打本体）→
 * 灯下免伤（她的生存全押在"站在自己灯旁边"）→ 身后留灯（阵亡才兑现的延迟群疗）。
 *
 * 随机数默认钉在 0.99：不暴击、不闪避、击飞不中，所有结算走确定分支；
 * 要验击飞落地的用例把 Math.random 单独压到 0.4（低于 XIYUECI_KNOCKUP_RATE）。
 */

const NO_RANDOM = 0.99;
const ALWAYS_KNOCKUP = 0.4;

function scene() {
    const state = makeGameState();
    const xiyueci = addHero(state, 'xiyueci', 'player1', [2, 2]);
    xiyueci.defense = 0;
    return { state, xiyueci };
}

function foe(state: GameState, position: Position, templateId = 'baize'): Hero {
    const unit = addHero(state, templateId, 'player2', position);
    unit.defense = 0;
    return unit;
}

function ally(state: GameState, position: Position, templateId = 'moran'): Hero {
    const unit = addHero(state, templateId, 'player1', position);
    unit.defense = 0;
    return unit;
}

function lamps(state: GameState) {
    return (state.boardEffects ?? []).filter(effect =>
        effect.type === 'lit-lamp' || effect.type === 'wake-lamp');
}

/** 直接把灯摆到指定格：几何与承伤用例不必每次都付一遍施法成本 */
function lampAt(state: GameState, caster: Hero, cell: Position) {
    return placeLamp(state, caster, cell)!;
}

function castSkill1(state: GameState, caster: Hero, clicked: Position) {
    return SkillSystem.executeSkill(caster, xiyueciSkill1, [clicked], state);
}

function castSkill2(state: GameState, caster: Hero, cell: Position) {
    return SkillSystem.executeSkill(caster, xiyueciSkill2, [cell], state);
}

/** 以致命伤害击杀，走完整 applyDamage → handleDeath 链路 */
function killWith(state: GameState, attacker: Hero, victim: Hero): void {
    const damage = DamageCalculator.calculate(attacker, victim, 999, false, true);
    DamageCalculator.applyDamage(victim, damage, attacker, state);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(NO_RANDOM);
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('夕月辞 · 名册与面板', () => {
    it('已上架：生命53、移动2，两记主动技能都在册', () => {
        expect(AVAILABLE_HERO_IDS).toContain('xiyueci');
        expect(getHeroInfo('xiyueci')?.name).toBe('夕月辞');

        const hero = createHero('xiyueci', 'player1', [0, 0]);
        expect(hero.maxHp).toBe(53);
        expect(hero.moveRange).toBe(2);
        expect(hero.passiveId).toBe('xiyueci_passive');
        expect(hero.tianweiId).toBe('xiyueci_tianwei');
        expect(SKILLS[hero.skill1Id]?.id).toBe('xiyueci_skill1');
        expect(SKILLS[hero.skill2Id]?.id).toBe('xiyueci_skill2');
    });
});

describe('夕月辞 · 技能一「辞光·散影」', () => {
    it('周围一圈敌人各吃8点；击飞没掷中时只掉血，圈外的人不受波及', () => {
        const { state, xiyueci } = scene();
        const corner = foe(state, [1, 1]);
        const side = foe(state, [2, 3]);
        const outOfRing = foe(state, [0, 0]);

        const output = castSkill1(state, xiyueci, [1, 1]);

        expect(output.success).toBe(true);
        expect(output.damageDealt).toEqual([XIYUECI_RING_DAMAGE, XIYUECI_RING_DAMAGE]);
        expect(corner.currentHp).toBe(corner.maxHp - 8);
        expect(side.currentHp).toBe(side.maxHp - 8);
        expect(outOfRing.currentHp).toBe(outOfRing.maxHp);
        expect(EffectManager.hasEffect(corner, '击飞')).toBe(false);
    });

    it('掷中的人被击飞：只断"本回合还没行动过"的人', () => {
        vi.spyOn(Math, 'random').mockReturnValue(ALWAYS_KNOCKUP);
        const { state, xiyueci } = scene();
        const fresh = foe(state, [1, 1]);
        const alreadyActed = foe(state, [2, 3]);
        alreadyActed.hasActedThisTurn = true;

        const output = castSkill1(state, xiyueci, [1, 1]);

        expect(fresh.currentHp).toBe(fresh.maxHp - 8);
        expect(EffectManager.hasEffect(fresh, '击飞')).toBe(true);
        expect(alreadyActed.currentHp).toBe(alreadyActed.maxHp - 8);
        expect(EffectManager.hasEffect(alreadyActed, '击飞')).toBe(false);
        expect(output.log.join('')).toContain('被击飞');
        expect(XIYUECI_KNOCKUP_RATE).toBe(0.5);
    });

    it('打死的人不再补控制：击杀链照常走', () => {
        const { state, xiyueci } = scene();
        vi.spyOn(Math, 'random').mockReturnValue(ALWAYS_KNOCKUP);
        const doomed = foe(state, [1, 3]);
        doomed.currentHp = 1;

        castSkill1(state, xiyueci, [1, 3]);

        expect(doomed.state).toBe(HeroState.DEAD);
        expect(EffectManager.hasEffect(doomed, '击飞')).toBe(false);
    });

    it('圈里没人时这一手不可用', () => {
        const { state, xiyueci } = scene();
        foe(state, [0, 0]);
        expect(SkillSystem.canUseSkill(xiyueci, xiyueciSkill1, state)).toBe(false);
    });

    it('致知二把一圈伤害抬到10、致知三把明灯抬到3回合', () => {
        const { state, xiyueci } = scene();
        grantZhizhi(xiyueci, 2);
        const target = foe(state, [3, 3]);
        castSkill1(state, xiyueci, [3, 3]);
        expect(target.currentHp).toBe(target.maxHp - 10);

        grantZhizhi(xiyueci, 3);
        expect(castSkill2(state, xiyueci, [0, 4]).success).toBe(true);
        expect(findLampAt(state, [0, 4])?.duration).toBe(3);
        expect(LAMP_DURATION).toBe(2);
    });
});

describe('夕月辞 · 技能二「明灯·照影」', () => {
    it('两格内一格空地上灯，持续两回合；越界/有人/已有灯都拒', () => {
        const { state, xiyueci } = scene();

        expect(castSkill2(state, xiyueci, [0, 4]).success).toBe(true);
        const lamp = findLampAt(state, [0, 4]);
        expect(lamp?.duration).toBe(LAMP_DURATION);
        expect(lamp?.owner).toBe('player1');
        expect(lamp?.sourceHeroId).toBe(xiyueci.id);

        expect(castSkill2(state, xiyueci, [5, 5]).success).toBe(false);   // 切比雪夫 3
        expect(castSkill2(state, xiyueci, [2, 2]).success).toBe(false);   // 她自己脚下
        expect(castSkill2(state, xiyueci, [0, 4]).success).toBe(false);   // 同格重灯
    });

    it('可点格就是自身两格内的 5×5（对角也算两格），脚下、有人与已立灯的格子都不亮', () => {
        const { state, xiyueci } = scene();

        const cells = SkillSystem.getValidTargetPositions(xiyueci, xiyueciSkill2, state);
        expect(cells).toHaveLength(24);                 // 5×5 扣掉脚下那格
        expect(cells.every(cell => chebyshev(cell, [2, 2]) <= 2)).toBe(true);
        expect(cells).toContainEqual([0, 4]);            // 对角两格
        expect(cells).toContainEqual([3, 4]);            // (1,2) 也算两格
        expect(cells).not.toContainEqual([2, 2]);        // 灯不落在人脚下，包括她自己
        expect(cells).not.toContainEqual([5, 2]);        // 切比雪夫 3，出圈
        expect(LAMP_AURA_RANGE).toBe(2);

        // 灯不进 board，所以"空格"口径本来会把已有灯的格子再亮一次——这里必须被剔掉
        lampAt(state, xiyueci, [0, 4]);
        expect(SkillSystem.getValidTargetPositions(xiyueci, xiyueciSkill2, state)).not.toContainEqual([0, 4]);
    });

    it('两格内已被灯占满时这一手判不可用（不会点了才告知失败）', () => {
        const state = makeGameState();
        const xiyueci = addHero(state, 'xiyueci', 'player1', [0, 0]);
        xiyueci.defense = 0;
        // 贴角站位：可选面只剩 [0..2]×[0..2] 里除她脚下的 8 格，全部提前立满灯
        for (const cell of SkillSystem.getValidTargetPositions(xiyueci, xiyueciSkill2, state)) {
            lampAt(state, xiyueci, cell);
        }
        expect(lamps(state)).toHaveLength(8);
        expect(SkillSystem.getValidTargetPositions(xiyueci, xiyueciSkill2, state)).toHaveLength(0);
        expect(SkillSystem.canUseSkill(xiyueci, xiyueciSkill2, state)).toBe(false);
    });

    it('灯把周围一圈的敌人照出影子，影子落在背离灯的那一格', () => {
        const { state, xiyueci } = scene();
        const enemy = foe(state, [3, 4]);
        const lamp = lampAt(state, xiyueci, [2, 3]);

        expect(shadowCellFor(lamp, enemy)).toEqual([4, 5]);
        const shadows = lampShadows(state);
        expect(shadows).toHaveLength(1);
        expect(shadows[0].body.id).toBe(enemy.id);
        expect(shadows[0].cell).toEqual([4, 5]);
    });

    it('贴边的目标照不出影子；圈外的人也不被照', () => {
        const { state, xiyueci } = scene();
        const corner = foe(state, [5, 5]);
        const far = ally(state, [0, 0]);
        const lamp = lampAt(state, xiyueci, [4, 4]);

        expect(shadowCellFor(lamp, corner)).toBeNull();     // 影子要出界
        expect(shadowCellFor(lamp, far)).toBeNull();        // 离灯三格
        expect(lampShadows(state)).toHaveLength(0);
    });

    it('影子不占格：别人站在影子上，那道影子还在', () => {
        const { state, xiyueci } = scene();
        const lit = foe(state, [3, 4]);
        const stander = foe(state, [4, 5]);     // 站在别人的影子上，且在本灯圈外
        const lamp = lampAt(state, xiyueci, [2, 3]);

        expect(shadowCellFor(lamp, lit)).toEqual([4, 5]);
        expect(shadowCellFor(lamp, stander)).toBeNull();
        expect(shadowBodiesOnCell(state, [4, 5]).map(hero => hero.id)).toContain(lit.id);
    });

    it('放灯把被照到的人与影格一并写进战报', () => {
        const state = makeGameState();
        const xiyueci = addHero(state, 'xiyueci', 'player1', [4, 4]);
        xiyueci.defense = 0;
        const enemy = foe(state, [3, 3]);

        expect(castSkill2(state, xiyueci, [2, 4]).success).toBe(true);
        expect(shadowBodiesOnCell(state, [4, 2]).map(hero => hero.id)).toContain(enemy.id);
        const report = state.battleLog.map(log => log.message).join('\n');
        expect(report).toContain('点起明灯');
        expect(report).toContain(enemy.name);
        expect(report).toContain('影子落在(5,3)');      // [4,2] 的 1 基坐标
    });

    it('场上没有敌人站在灯边时，战报如实说这一盏空照着', () => {
        const { state, xiyueci } = scene();
        ally(state, [1, 1]);                            // 队友贴着灯也不会落影
        expect(castSkill2(state, xiyueci, [0, 0]).success).toBe(true);
        expect(state.battleLog.map(log => log.message).join('\n')).toContain('一圈没有敌人');
    });

    it('灯到期即散：持续时间走通用回合衰减', () => {
        const { state, xiyueci } = scene();
        foe(state, [3, 4]);
        expect(castSkill2(state, xiyueci, [2, 3]).success).toBe(true);
        expect(lampShadows(state).length).toBeGreaterThan(0);

        state.roundNumber++;
        GameEngine.startNewTurn(state);
        expect(lamps(state)).toHaveLength(1);           // 还剩 1 回合

        state.roundNumber++;
        GameEngine.startNewTurn(state);
        expect(lamps(state)).toHaveLength(0);
        expect(lampShadows(state)).toHaveLength(0);     // 灯灭影散
    });
});

describe('夕月辞 · 灯影承伤', () => {
    it('打中影子＝本体只吃半刀：本体本来够不着，也能借影子出一手', () => {
        const { state, xiyueci } = scene();
        const moran = ally(state, [3, 3]);
        const victim = foe(state, [2, 4]);
        lampAt(state, xiyueci, [2, 5]);                 // 影子投在 [2,3]

        // 墨阑的十字范围（正交一格）够得着影格、够不着本体
        expect(moranSkill1.rangeType).toBe('cross');
        expect(Math.abs((moran.position as Position)[0] - (victim.position as Position)[0])
            + Math.abs((moran.position as Position)[1] - (victim.position as Position)[1])).toBe(2);
        expect(shadowBodiesOnCell(state, [2, 3]).map(hero => hero.id)).toContain(victim.id);
        expect(SkillSystem.canUseSkill(moran, moranSkill1, state)).toBe(true);

        const output = SkillSystem.executeSkill(moran, moranSkill1, [[2, 3]], state);
        expect(output.success).toBe(true);
        expect(output.damageDealt).toEqual([5]);            // 10 的一半
        expect(victim.currentHp).toBe(victim.maxHp - 5);
        expect(victim.position).toEqual([2, 4]);            // 本体没有挪窝
        expect(state.battleLog.some(log => log.message.includes('踩中灯影'))).toBe(true);

        // 折半只在这一手里有效：灯灭之后再正面挨一刀，吃满伤害
        state.boardEffects = [];
        expect(SkillSystem.canUseSkill(moran, moranSkill1, state)).toBe(false);
        const direct = DamageCalculator.calculate(moran, victim, 10, false, false, { canCrit: false });
        DamageCalculator.applyDamage(victim, direct, moran, state);
        expect(direct.finalDamage).toBe(10);
        expect(victim.currentHp).toBe(victim.maxHp - 15);   // 5 + 10：标记没跟到下一手
    });

    it('只有"打敌人"的口径认影子：治疗与护盾借它多不出射程', () => {
        const { state, xiyueci } = scene();
        const enemy = foe(state, [3, 4]);
        lampAt(state, xiyueci, [2, 3]);                 // 影格 [4,5]

        expect(shadowTargetsFor(state, xiyueci, [[4, 5]], 'enemy').map(h => h.id)).toContain(enemy.id);
        expect(shadowTargetsFor(state, xiyueci, [[4, 5]], 'ally')).toHaveLength(0);
        expect(shadowTargetsFor(state, xiyueci, [[4, 5]], 'any')).toHaveLength(0);
    });

    it('引擎展开的群攻认影子：本体在圈外、只有影子落在圈内，也照样被照到（半数）', () => {
        const { state, xiyueci } = scene();
        const enemy = foe(state, [4, 2]);               // 切比雪夫 2，本来在她圈外
        lampAt(state, xiyueci, [5, 2]);                 // 灯把人往外顶，影子落回圈内的 [3,2]

        expect(chebyshev(enemy.position as Position, [2, 2])).toBe(2);
        expect(shadowBodiesOnCell(state, [3, 2]).map(hero => hero.id)).toContain(enemy.id);

        const output = castSkill1(state, xiyueci, [3, 2]);
        expect(output.damageDealt).toEqual([XIYUECI_RING_DAMAGE / 2]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);      // 8 的一半
        expect(state.battleLog.some(log => log.message.includes('踩中灯影'))).toBe(true);
    });

    it('本体与影子同在作用面上只照一次，不会被范围技打两遍', () => {
        const { state, xiyueci } = scene();
        const enemy = foe(state, [1, 2]);               // 已在她的圈里
        lampAt(state, xiyueci, [1, 1]);                 // 影子落在同为圈内的 [1,3]

        expect(shadowBodiesOnCell(state, [1, 3]).map(hero => hero.id)).toContain(enemy.id);
        const targets = SkillSystem.getHeroesAtPositions([[1, 2], [1, 3]], xiyueci, 'enemy', state);
        expect(targets).toHaveLength(1);

        const output = castSkill1(state, xiyueci, [1, 2]);
        expect(output.damageDealt).toEqual([XIYUECI_RING_DAMAGE]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
    });

    it('灯只照敌方：队友与她本人都站在灯圈里也不落影', () => {
        const { state, xiyueci } = scene();
        const mate = ally(state, [3, 4]);
        const lamp = lampAt(state, xiyueci, [2, 3]);   // 敌我同处灯圈：[3,4] 队友、[2,2] 她自己

        expect(shadowCellFor(lamp, mate)).toBeNull();
        expect(shadowCellFor(lamp, xiyueci)).toBeNull();
        expect(shadowBodiesOnCell(state, [4, 5])).toHaveLength(0);
        expect(shadowBodiesOnCell(state, [2, 1])).toHaveLength(0);
        expect(lampShadows(state)).toHaveLength(0);
        // 对面拿她的灯也没用：那盏灯圈里根本没有她这一方的人
        expect(shadowTargetsFor(state, mate, [[4, 5], [2, 1]], 'enemy')).toHaveLength(0);
    });
});

describe('夕月辞 · 被动「灯下安身」', () => {
    function strike(state: GameState, attacker: Hero, target: Hero, amount = 10): number {
        const hpBefore = target.currentHp;
        const damage = DamageCalculator.calculate(attacker, target, amount, false, false, { canCrit: false });
        DamageCalculator.applyDamage(target, damage, attacker, state);
        return hpBefore - target.currentHp;
    }

    it('站在自己灯两格内时受到的伤害减少30%', () => {
        const { state, xiyueci } = scene();
        const attacker = foe(state, [0, 0]);
        lampAt(state, xiyueci, [2, 4]);                 // 相距正好 2

        expect(lampMitigationFor(state, xiyueci)).toBe(0.3);
        expect(strike(state, attacker, xiyueci)).toBe(7);
    });

    it('灯下与灯外一刀两断：三格外吃满伤害', () => {
        const { state, xiyueci } = scene();
        const attacker = foe(state, [0, 0]);
        expect(strike(state, attacker, xiyueci)).toBe(10);

        lampAt(state, xiyueci, [5, 0]);                 // (3,2) → 切比雪夫 3
        expect(chebyshev([5, 0], [2, 2])).toBe(3);
        expect(lampMitigationFor(state, xiyueci)).toBe(0);
        xiyueci.currentHp = xiyueci.maxHp;
        expect(strike(state, attacker, xiyueci)).toBe(10);
    });

    it('对角两格也算灯下', () => {
        const { state, xiyueci } = scene();
        lampAt(state, xiyueci, [0, 0]);
        expect(chebyshev([0, 0], [2, 2])).toBe(2);
        expect(lampMitigationFor(state, xiyueci)).toBe(0.3);
    });

    it('只认她自己的灯：敌方夕月辞的灯不替她挡刀', () => {
        const { state, xiyueci } = scene();
        const rival = foe(state, [2, 4], 'xiyueci');
        lampAt(state, rival, [2, 4]);

        expect(lampMitigationFor(state, xiyueci)).toBe(0);
        expect(lampMitigationFor(state, rival)).toBe(0.3);
    });

    it('别的角色永远拿不到这一档免伤，哪怕站在她的灯边', () => {
        const { state, xiyueci } = scene();
        const moran = ally(state, [0, 1]);
        lampAt(state, xiyueci, [0, 0]);
        expect(chebyshev([0, 0], [0, 1])).toBe(1);
        expect(lampMitigationFor(state, moran)).toBe(0);
    });
});

describe('夕月辞 · 天威「身后留灯」', () => {
    it('阵亡时旧灯全灭，倒下的那一格留下一盏留灯', () => {
        const { state, xiyueci } = scene();
        lampAt(state, xiyueci, [0, 4]);
        lampAt(state, xiyueci, [4, 0]);
        const attacker = foe(state, [3, 3]);

        killWith(state, attacker, xiyueci);

        expect(xiyueci.state).toBe(HeroState.DEAD);
        expect(lamps(state)).toHaveLength(1);
        const wake = lamps(state)[0];
        expect(wake.type).toBe('wake-lamp');
        expect(wake.position).toEqual([2, 2]);
        expect(wake.duration).toBe(LAMP_DURATION);
        expect(state.battleLog.some(log => log.message.includes('身后留灯'))).toBe(true);
        expect(lampShadows(state)).toHaveLength(0);     // 无主之灯不再照影子
    });

    it('留灯每回合末为两格内友方各恢复5点，敌人照不到', () => {
        const { state, xiyueci } = scene();
        const near = ally(state, [0, 2]);
        const far = ally(state, [5, 5]);
        const attacker = foe(state, [3, 3]);
        near.currentHp = 10;
        far.currentHp = 10;

        killWith(state, attacker, xiyueci);
        healFromWakeLamps(state);

        expect(near.currentHp).toBe(10 + WAKE_LAMP_HEAL);       // 距留灯 2
        expect(far.currentHp).toBe(10);                          // 距留灯 3
        expect(attacker.currentHp).toBe(attacker.maxHp);         // 敌方不吃这口血
        expect(state.battleLog.some(log => log.message.includes(`照回${WAKE_LAMP_HEAL}点生命`))).toBe(true);
    });

    it('满血的友方不溢出治疗，也不留多余战报', () => {
        const { state, xiyueci } = scene();
        const full = ally(state, [1, 1]);
        const attacker = foe(state, [3, 3]);

        killWith(state, attacker, xiyueci);
        const before = state.battleLog.length;
        healFromWakeLamps(state);

        expect(full.currentHp).toBe(full.maxHp);
        expect(state.battleLog.length).toBe(before);
    });

    it('留灯活两回合：两拍之后自己散掉，不再回血', () => {
        const { state, xiyueci } = scene();
        const attacker = foe(state, [3, 3]);
        killWith(state, attacker, xiyueci);
        expect(lamps(state)).toHaveLength(1);

        state.roundNumber++;
        GameEngine.startNewTurn(state);
        expect(lamps(state)).toHaveLength(1);

        state.roundNumber++;
        GameEngine.startNewTurn(state);
        expect(lamps(state)).toHaveLength(0);
    });

    it('回合末确实被引擎接到：整回合结束时结算一次', () => {
        const { state, xiyueci } = scene();
        const wounded = ally(state, [0, 2]);
        const attacker = foe(state, [3, 3]);
        wounded.currentHp = 20;

        killWith(state, attacker, xiyueci);
        const afterDeath = wounded.currentHp;

        for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
            if (hero.state === HeroState.ALIVE) hero.hasActedThisTurn = true;
        }
        GameEngine.endHeroAction(wounded, state);

        expect(wounded.currentHp).toBe(afterDeath + WAKE_LAMP_HEAL);
    });
});

describe('灯影 × 逐格扫盘的群攻', () => {
    it('帝兰「风压横扫」打到影格：本体吃半刀，但推不动一个不在风压格里的人', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        dilan.defense = 0;
        const xiyueci = addHero(state, 'xiyueci', 'player1', [0, 0]);
        xiyueci.defense = 0;
        const enemy = foe(state, [3, 4]);
        enemy.passiveId = '';
        lampAt(state, xiyueci, [3, 5]);             // 灯在(3,5)、人在(3,4) → 影格 (3,3)，正落在前方 2×3 风压面里

        expect(shadowBodiesOnCell(state, [3, 3]).map(hero => hero.id)).toContain(enemy.id);
        expect(enemy.position).toEqual([3, 4]);     // 本体自己站在面外

        dilan.counters['__dilan_skill2_dir'] = 1;   // 朝下
        const output = SkillSystem.executeSkill(dilan, dilanSkill2, [[3, 2]], state);

        expect(output.success).toBe(true);
        expect(output.damageDealt).toEqual([1]);    // 3 点的一半，向下取整
        expect(enemy.currentHp).toBe(enemy.maxHp - 1);
        expect(enemy.position).toEqual([3, 4]);     // 灯影没有实体，击退不跟影子走
    });
});
