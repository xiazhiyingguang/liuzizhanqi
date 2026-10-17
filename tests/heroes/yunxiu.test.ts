import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { applyChainMark, hasChainMark } from '../../src/core/chain-lightning';
import {
    CLOUD_MAX,
    cloudAnchorCells,
    cloudCells,
    cloudsOf,
    isParalyzed,
    placeCloud,
    rodsOf,
    strikeCloud,
    tingxiLayers,
} from '../../src/core/thunder-cloud';
import { yunxiuSkill1, yunxiuSkill2 } from '../../src/data/extended-skills';
import { getHeroInfo } from '../../src/data/heroes';
import { BATTLE_GLOSSARY } from '../../src/core/battle-glossary';
import { HERO_CODEX } from '../../src/data/hero-codex';
import type { GameState, Hero, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 云岫：会自己挪窝的雷云 + 一次性的引雷针 + 永久叠到五层的霆息。
 *
 * 她的本体站在 [2,2]，所以所有"合法云心"都只能取十字两格那八格
 * （[1,2]/[0,2]/[3,2]/[4,2]/[2,1]/[2,0]/[2,3]/[2,4]）——脚下那一格不是合法锚点。
 * Math.random 钉在 0.99：不闪避、不暴击，且云随机挪格时永远取到方向表的最后一格（东南）。
 */

function scene() {
    const state = makeGameState();
    const yunxiu = addHero(state, 'yunxiu', 'player1', [2, 2]);
    yunxiu.defense = 0;
    return { state, yunxiu };
}

function dummy(state: GameState, position: Position, owner: 'player1' | 'player2' = 'player2'): Hero {
    const unit = addHero(state, 'baize', owner, position);
    unit.defense = 0;
    unit.maxHp = 300;
    unit.currentHp = 300;
    return unit;
}

function click(caster: Hero, cell: Position): void {
    caster.counters['__extended_target'] = cell[0] * 6 + cell[1];
}

function cast1(caster: Hero, state: GameState, cell: Position) {
    click(caster, cell);
    return yunxiuSkill1.execute!(caster, [], state);
}

function cast2(caster: Hero, state: GameState, target: Hero) {
    return yunxiuSkill2.execute!(caster, [target], state);
}

function cloudPositions(state: GameState): Position[] {
    return cloudsOf(state, 'player1').map(cloud => [...cloud.position] as Position);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('云岫 · 模板与图鉴', () => {
    it('生命50、移动2、天师，没有天威', () => {
        const { yunxiu } = scene();
        expect(yunxiu.maxHp).toBe(50);
        expect(yunxiu.moveRange).toBe(2);
        expect(yunxiu.class).toBe('天师');
        expect(yunxiu.tianweiId).toBeUndefined();
        expect(getHeroInfo('yunxiu').name).toBe('云岫');
    });

    it('致知一 +8 生命', () => {
        const { yunxiu } = scene();
        grantZhizhi(yunxiu, 1);
        expect(yunxiu.maxHp).toBe(58);
    });

    it('图鉴与术语表都收录了她与雷云/引雷针/霆息/麻痹', () => {
        const entry = HERO_CODEX.find(hero => hero.id === 'yunxiu')!;
        expect(entry.skills.map(skill => skill.name)).toEqual(['布云·垂雷', '引雷·落针']);
        expect(entry.tags.length).toBeGreaterThanOrEqual(3);
        expect(entry.tips.length).toBeGreaterThanOrEqual(2);
        expect(entry.passive.description.length).toBeGreaterThan(8);
        for (const term of ['雷云', '引雷针', '霆息', '麻痹']) {
            expect(BATTLE_GLOSSARY.some(item => item.term === term), term).toBe(true);
        }
    });
});

describe('技能一 · 布云·垂雷', () => {
    it('只能落在自身上下左右各 1~2 格那八格上', () => {
        const { state, yunxiu } = scene();
        expect(cloudAnchorCells(yunxiu).sort()).toEqual(
            [[0, 2], [1, 2], [2, 0], [2, 1], [2, 3], [2, 4], [3, 2], [4, 2]].sort()
        );
        // 斜角与脚下都不在"十字两格"的口径里
        expect(cast1(yunxiu, state, [1, 1]).success).toBe(false);
        expect(cast1(yunxiu, state, [2, 2]).success).toBe(false);
        expect(cast1(yunxiu, state, [0, 3]).success).toBe(false);
    });

    it('落云当拍就劈一次 3×3，劈中几名敌人就叠几层霆息', () => {
        const { state, yunxiu } = scene();
        const near = dummy(state, [0, 1]);     // 云心 [1,2] 的斜角
        const also = dummy(state, [1, 3]);     // 云心正右
        const far = dummy(state, [5, 5]);      // 云罩不到
        const output = cast1(yunxiu, state, [1, 2]);
        expect(output.success).toBe(true);
        expect(near.currentHp).toBe(296);
        expect(also.currentHp).toBe(296);
        expect(far.currentHp).toBe(300);
        expect(tingxiLayers(yunxiu)).toBe(2);
    });

    it('雷云不占格：云心站着人也能落', () => {
        const { state, yunxiu } = scene();
        const victim = dummy(state, [1, 2]);
        expect(cast1(yunxiu, state, [1, 2]).success).toBe(true);
        expect(victim.currentHp).toBe(296);
        expect(cloudPositions(state)).toEqual([[1, 2]]);
    });

    it('每阵营最多三团，第四团挤散最早那团', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [0, 2]);
        cast1(yunxiu, state, [4, 2]);
        cast1(yunxiu, state, [2, 0]);
        expect(cloudsOf(state, 'player1').length).toBe(CLOUD_MAX);
        cast1(yunxiu, state, [2, 4]);
        const clouds = cloudPositions(state);
        expect(clouds.length).toBe(CLOUD_MAX);
        expect(clouds).not.toContainEqual([0, 2]);      // 最早那团被挤掉
        expect(clouds).toContainEqual([2, 4]);          // 新落那团在
    });

    it('云的覆盖格是以云心为圆心的 3×3，贴边时收在盘内', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [2, 4]);
        const middle = cloudsOf(state, 'player1')[0];
        expect(cloudCells(middle).length).toBe(9);      // 云心 [2,4]：列 3~5 全在盘内
        cast1(yunxiu, state, [0, 2]);
        const edge = cloudsOf(state, 'player1').find(cloud => cloud.position[0] === 0)!;
        expect(cloudCells(edge).length).toBe(6);        // 上边那三格出界
        expect(cloudCells(edge).every(([row]) => row >= 0)).toBe(true);
    });
});

describe('雷云 · 每回合先挪一格再落一次雷', () => {
    it('回合开始：云先挪一格，雷落在新落点上', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [2, 2 - 0]);               // 脚下非法，改走下面的合法点
        expect(cloudsOf(state, 'player1').length).toBe(0);
        const ahead = dummy(state, [3, 3]);             // 往东南挪一格后才会被压住
        const behind = dummy(state, [0, 1]);            // 旧云心的斜角，挪走后就罩不到
        cast1(yunxiu, state, [1, 2]);                   // 云心 [1,2]，当拍先劈一次
        behind.currentHp = 300;
        ahead.currentHp = 300;
        GameEngine.startNewTurn(state);
        expect(cloudPositions(state)).toEqual([[2, 3]]);   // 方向表最后一格 = 东南
        expect(ahead.currentHp).toBe(296);
        expect(behind.currentHp).toBe(300);
    });

    it('贴边时只在盘内的方向里挪，不会飘出棋盘', () => {
        const state = makeGameState();
        const yunxiu = addHero(state, 'yunxiu', 'player1', [0, 0]);
        yunxiu.defense = 0;
        expect(cast1(yunxiu, state, [0, 2]).success).toBe(true);
        GameEngine.startNewTurn(state);
        const [row, col] = cloudsOf(state, 'player1')[0].position;
        expect(row).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThanOrEqual(5);
    });

    it('活三拍就散：第四回合开始场上不再有这团云', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [1, 2]);
        for (let round = 0; round < 3; round++) {
            expect(cloudsOf(state, 'player1').length).toBe(1);
            GameEngine.startNewTurn(state);
        }
        expect(cloudsOf(state, 'player1').length).toBe(0);
    });

    it('致知三策划案留白：给了也不改寿命（等定案后接 CLOUD_STRIKES_TALENT）', () => {
        const { state, yunxiu } = scene();
        grantZhizhi(yunxiu, 3);
        cast1(yunxiu, state, [1, 2]);
        expect(cloudsOf(state, 'player1')[0].duration).toBe(3);
    });

    it('劈中带着链式闪电的敌人时，把那条印续回 2 回合', () => {
        const { state, yunxiu } = scene();
        const tingyuan = addHero(state, 'tingyuan', 'player1', [0, 0]);
        const victim = dummy(state, [1, 3]);            // 在云心 [1,2] 的 3×3 里
        applyChainMark(victim, tingyuan.id);
        const mark = victim.effects.find(effect => effect.name === '链式闪电')!;
        mark.duration = 1;
        cast1(yunxiu, state, [1, 2]);
        expect(hasChainMark(victim, tingyuan.id)).toBe(true);
        expect(mark.duration).toBe(2);
    });

    it('云不替霆渊引爆传导：只续时长，不多打一发', () => {
        const { state, yunxiu } = scene();
        const tingyuan = addHero(state, 'tingyuan', 'player1', [0, 0]);
        const struck = dummy(state, [1, 2]);            // 被云劈中，身上带链
        const elsewhere = dummy(state, [5, 5]);         // 也带链，但云根本罩不到
        applyChainMark(struck, tingyuan.id);
        applyChainMark(elsewhere, tingyuan.id);
        cast1(yunxiu, state, [1, 2]);
        expect(struck.currentHp).toBe(296);
        expect(elsewhere.currentHp).toBe(300);
    });
});

describe('技能二 · 引雷·落针', () => {
    it('打 5×5 内的敌人 6 点并挂上 1 回合麻痹', () => {
        const { state, yunxiu } = scene();
        const victim = dummy(state, [3, 3]);
        const output = cast2(yunxiu, state, victim);
        expect(output.success).toBe(true);
        expect(victim.currentHp).toBe(294);
        expect(isParalyzed(victim)).toBe(true);
        expect(victim.effects.find(effect => effect.name === '麻痹')!.duration).toBe(1);
        expect(rodsOf(state, 'player1').length).toBe(1);
        expect(rodsOf(state, 'player1')[0].position).toEqual([3, 3]);
    });

    it('针只够得着自身 5×5 内的敌人，外沿那一格不在候选里', () => {
        const { state, yunxiu } = scene();
        dummy(state, [0, 5]);                                   // 切比雪夫距离 3，超出 5×5
        const cells = SkillSystem.getValidTargetPositions(yunxiu, yunxiuSkill2, state);
        expect(cells).toContainEqual([3, 3]);
        expect(cells).not.toContainEqual([0, 5]);
        expect(rodsOf(state, 'player1').length).toBe(0);
    });

    it('引雷针只生效一次：下一拍云朝针挪一格，随后针消失', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [2, 3]);                   // 云心 [2,3]
        const victim = dummy(state, [0, 5]);            // 针落在东北角外沿
        cast2(yunxiu, state, victim);
        expect(cloudPositions(state)).toEqual([[2, 3]]);
        GameEngine.startNewTurn(state);
        expect(cloudPositions(state)).toEqual([[1, 4]]);   // 朝针走一格（行减一、列加一）
        expect(rodsOf(state, 'player1').length).toBe(0);
    });

    it('针会把场上每一团云都拽过来，且优先于随机方向', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [2, 3]);                   // 东
        cast1(yunxiu, state, [2, 1]);                   // 西
        const victim = dummy(state, [0, 5]);
        cast2(yunxiu, state, victim);
        GameEngine.startNewTurn(state);
        // Math.random 钉在 0.99 时随机方向只会往东南；两团云都改朝东北贴针，说明针说了算
        expect(cloudPositions(state).sort()).toEqual([[1, 2], [1, 4]].sort());
    });

    it('场上没有她的云时针原地等着，不会凭空消失', () => {
        const { state, yunxiu } = scene();
        const victim = dummy(state, [3, 3]);
        cast2(yunxiu, state, victim);
        GameEngine.startNewTurn(state);
        expect(rodsOf(state, 'player1').length).toBe(1);
    });
});

describe('被动 · 霆息', () => {
    it('每劈中一名敌人叠一层，+1 移动力，封顶五层', () => {
        const { state, yunxiu } = scene();
        // 云心 [1,2] 罩住行 0~2、列 1~3：五个人全在里头
        for (const cell of [[0, 1], [0, 2], [0, 3], [1, 3], [2, 3]] as Position[]) {
            const victim = dummy(state, cell);
            victim.maxHp = 900;
            victim.currentHp = 900;
        }
        cast1(yunxiu, state, [1, 2]);
        expect(tingxiLayers(yunxiu)).toBe(5);
        expect(yunxiu.moveRange).toBe(7);
        // 再劈也只到封顶，移动力不会一路涨下去
        GameEngine.startNewTurn(state);
        expect(tingxiLayers(yunxiu)).toBe(5);
        expect(yunxiu.moveRange).toBe(7);
    });

    it('每层再给 5% 防御，五层就是少挨 25%', () => {
        const { state, yunxiu } = scene();
        const attacker = dummy(state, [5, 5], 'player2');
        const bare = DamageCalculator.calculate(attacker, yunxiu, 20, false).finalDamage;
        yunxiu.counters['霆息'] = 5;
        const armored = DamageCalculator.calculate(attacker, yunxiu, 20, false).finalDamage;
        expect(armored).toBeLessThan(bare);
        expect(armored).toBeCloseTo(bare * 0.75, 1);
    });

    it('霆息只涨不掉：过两回合层数与移动力都不变', () => {
        const { state, yunxiu } = scene();
        const victim = dummy(state, [0, 1]);
        victim.maxHp = 900;
        victim.currentHp = 900;
        cast1(yunxiu, state, [1, 2]);
        const layers = tingxiLayers(yunxiu);
        const move = yunxiu.moveRange;
        expect(layers).toBe(1);
        expect(move).toBe(3);
        GameEngine.startNewTurn(state);
        GameEngine.startNewTurn(state);
        expect(tingxiLayers(yunxiu)).toBeGreaterThanOrEqual(layers);
        expect(yunxiu.moveRange).toBeGreaterThanOrEqual(move);
    });
});

describe('麻痹 · 封天威', () => {
    it('被麻痹的人这一回合即使击杀也不触发天威', () => {
        const { state } = scene();
        const aoyuan = addHero(state, 'aoyuan', 'player1', [2, 2]);
        aoyuan.defense = 0;
        const prey = dummy(state, [2, 3]);
        prey.currentHp = 1;
        DamageCalculator.applyDamage(prey, DamageCalculator.calculate(aoyuan, prey, 30, false), aoyuan, state);
        expect(aoyuan.counters['__aoyuan_dash_bonus']).toBe(1);       // 正常击杀会领到天威

        const other = scene();
        const paralyzed = addHero(other.state, 'aoyuan', 'player1', [2, 2]);
        paralyzed.defense = 0;
        EffectManager.addEffect(paralyzed, {
            type: 'debuff', name: '麻痹', duration: 1, sourceHeroId: 'yunxiu-test', description: '测试',
        });
        const prey2 = dummy(other.state, [2, 3]);
        prey2.currentHp = 1;
        DamageCalculator.applyDamage(
            prey2, DamageCalculator.calculate(paralyzed, prey2, 30, false), paralyzed, other.state);
        expect(prey2.state).not.toBe('ALIVE');                        // 人确实死了
        expect(paralyzed.counters['__aoyuan_dash_bonus']).toBeUndefined();
        expect(other.state.battleLog.some(log => log.message.includes('麻痹锁住经脉'))).toBe(true);
    });
});

describe('结算细节', () => {
    it('一次云落雷算一次出手：两名敌人各挨一口，层数按人数涨', () => {
        const { state, yunxiu } = scene();
        const first = dummy(state, [1, 3]);
        const second = dummy(state, [3, 3]);
        cast1(yunxiu, state, [2, 3]);                   // 云心正东，罩住行 1~3
        expect(first.currentHp).toBe(296);
        expect(second.currentHp).toBe(296);
        expect(tingxiLayers(yunxiu)).toBe(2);
    });

    it('云下没人时 strikeCloud 返回 0 且不叠层', () => {
        const { state, yunxiu } = scene();
        cast1(yunxiu, state, [0, 2]);
        const cloud = cloudsOf(state, 'player1')[0];
        expect(strikeCloud(state, cloud, [])).toBe(0);
        expect(tingxiLayers(yunxiu)).toBe(0);
    });

    it('落点非法时不消耗云、也不叠层', () => {
        const { state, yunxiu } = scene();
        expect(cast1(yunxiu, state, [4, 4]).success).toBe(false);
        expect(cloudsOf(state, 'player1').length).toBe(0);
        expect(placeCloud(state, yunxiu, [9, 9])).toBeNull();
    });
});
