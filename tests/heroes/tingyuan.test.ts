import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { SkillSystem } from '../../src/core/skill-system';
import {
    CHAIN_MARK_DURATION,
    THUNDER_MARK_DURATION,
    applyChainMark,
    applyThunderMark,
    chainDamageFor,
    chainMarkedEnemies,
    hasChainMark,
    hasThunderMark,
    thunderMarkedEnemies,
} from '../../src/core/chain-lightning';
import { tingyuanSkill1, tingyuanSkill2 } from '../../src/data/extended-skills';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { getHeroInfo } from '../../src/data/heroes';
import { BATTLE_GLOSSARY } from '../../src/core/battle-glossary';
import { HeroState, type GameState, type Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 霆渊：技能一全场随机落雷染印（先打完再挂，本次不跳），技能二全场点名并按带链者数量互跳传导。
 * 默认把 Math.random 钉在 0.99——不闪避、不暴击，全部结算走确定分支。
 */

function scene() {
    const state = makeGameState();
    const tingyuan = addHero(state, 'tingyuan', 'player1', [1, 2]);
    tingyuan.defense = 0;
    return { state, tingyuan };
}

function dummy(state: GameState, position: [number, number], owner: 'player1' | 'player2' = 'player2'): Hero {
    const unit = addHero(state, 'baize', owner, position);
    unit.defense = 0;
    unit.maxHp = 300;
    unit.currentHp = 300;
    return unit;
}

function marks(hero: Hero, name: string) {
    return hero.effects.filter(effect => effect.name === name);
}

function cast1(caster: Hero, state: GameState) {
    return tingyuanSkill1.execute!(caster, [], state);
}

function cast2(caster: Hero, state: GameState) {
    return tingyuanSkill2.execute!(caster, [], state);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('霆渊 · 模板与图鉴', () => {
    it('生命45、移动2、天师，设计稿的被动与天威都是暂无', () => {
        const state = makeGameState();
        const tingyuan = addHero(state, 'tingyuan', 'player1', [2, 2]);
        expect(tingyuan.maxHp).toBe(45);
        expect(tingyuan.moveRange).toBe(2);
        expect(tingyuan.class).toBe('天师');
        expect(tingyuan.tianweiId).toBeUndefined();
        expect(getHeroInfo('tingyuan').name).toBe('霆渊');
    });

    it('图鉴不为他编一个被动，但仍收录两条技能与两枚印的术语', () => {
        const entry = HERO_CODEX.find(hero => hero.id === 'tingyuan')!;
        expect(entry.passive).toBeUndefined();
        expect(entry.skills.map(skill => skill.name)).toEqual(['引雷', '万雷朝宗']);
        expect(entry.tips.length).toBeGreaterThanOrEqual(2);
        const terms = BATTLE_GLOSSARY.map(item => item.term);
        expect(terms).toContain('引雷印');
        expect(terms).toContain('链式闪电');
    });

    it('致知一 +8 生命、致知二把引雷的 10 点抬到 12 点，致知三留白', () => {
        const { tingyuan } = scene();
        grantZhizhi(tingyuan, 1);
        expect(tingyuan.maxHp).toBe(53);
    });
});

describe('技能一 · 引雷', () => {
    it('随机优先于点击：点中的那个人不是挨劈的那个', () => {
        // Math.random 钉在 0.99 → 两个敌人时取最后一个（[3,4]），
        // 而玩家点的是 [3,3]。这一条就是"点谁劈谁"那个回归的直接反证。
        const { state, tingyuan } = scene();
        const clicked = dummy(state, [3, 3]);
        const struck = dummy(state, [3, 4]);

        const output = SkillSystem.executeSkill(tingyuan, tingyuanSkill1, [[3, 3]], state);

        expect(output.success).toBe(true);
        expect(struck.currentHp).toBe(290);
        expect(clicked.currentHp).toBe(300);
        expect(marks(struck, '引雷印')).toHaveLength(1);
        expect(marks(clicked, '引雷印')).toHaveLength(0);
    });

    it('只剩一个敌人时随机退化成必中：点它就用它', () => {
        const { state, tingyuan } = scene();
        const only = dummy(state, [3, 3]);

        SkillSystem.executeSkill(tingyuan, tingyuanSkill1, [[3, 3]], state);

        expect(only.currentHp).toBe(290);
        expect(marks(only, '引雷印')).toHaveLength(1);
    });

    it('雷光跟着真挨劈的人走，不跟着被点中的那格', () => {
        const { state, tingyuan } = scene();
        dummy(state, [3, 3]);
        const struck = dummy(state, [3, 4]);

        SkillSystem.executeSkill(tingyuan, tingyuanSkill1, [[3, 3]], state);

        expect(state.skillFxExtras?.targetPos).toEqual([...struck.position!]);
    });

    it('先打完再挂上引雷印（3回合）与链式闪电（2回合）', () => {
        const { state, tingyuan } = scene();
        const victim = dummy(state, [3, 3]);
        const output = cast1(tingyuan, state);
        expect(output.success).toBe(true);
        expect(victim.currentHp).toBe(290);
        expect(marks(victim, '引雷印')).toHaveLength(1);
        expect(marks(victim, '链式闪电')).toHaveLength(1);
        expect(marks(victim, '引雷印')[0].duration).toBe(THUNDER_MARK_DURATION);
        expect(marks(victim, '链式闪电')[0].duration).toBe(CHAIN_MARK_DURATION);
    });

    it('先打完再挂：这一记本身不引发传导，身上已有链也只挨那10点', () => {
        const { state, tingyuan } = scene();
        const victim = dummy(state, [3, 3]);
        applyThunderMark(victim, tingyuan.id);
        applyChainMark(victim, tingyuan.id);
        const output = cast1(tingyuan, state);
        expect(output.success).toBe(true);
        expect(output.damageDealt).toHaveLength(1);
        expect(victim.currentHp).toBe(290);
    });

    it('可刷新不可叠加：连劈两次仍是各一条印，时长回到满格', () => {
        const { state, tingyuan } = scene();
        const victim = dummy(state, [3, 3]);
        cast1(tingyuan, state);
        EffectManager.updateEffectDurations(state);
        cast1(tingyuan, state);
        expect(marks(victim, '引雷印')).toHaveLength(1);
        expect(marks(victim, '链式闪电')).toHaveLength(1);
        expect(marks(victim, '引雷印')[0].duration).toBe(THUNDER_MARK_DURATION);
        expect(marks(victim, '链式闪电')[0].duration).toBe(CHAIN_MARK_DURATION);
    });

    it('劈死就不挂印：雷不把靶子钉在尸体上', () => {
        const { state, tingyuan } = scene();
        const victim = dummy(state, [3, 3]);
        victim.currentHp = 4;
        const output = cast1(tingyuan, state);
        expect(output.success).toBe(true);
        expect(victim.state).toBe(HeroState.DEAD);
        expect(marks(victim, '引雷印')).toHaveLength(0);
        expect(marks(victim, '链式闪电')).toHaveLength(0);
    });

    it('致知二让落雷多2点；场上没有敌人时直接放不出来', () => {
        const plain = scene();
        const plainVictim = dummy(plain.state, [3, 3]);
        cast1(plain.tingyuan, plain.state);

        const boosted = scene();
        const boostedVictim = dummy(boosted.state, [3, 3]);
        grantZhizhi(boosted.tingyuan, 2);
        cast1(boosted.tingyuan, boosted.state);
        expect(plainVictim.currentHp - boostedVictim.currentHp).toBe(2);

        const empty = scene();
        expect(cast1(empty.tingyuan, empty.state).success).toBe(false);
    });

    it('伤害走常规结算：防御越高掉血越少', () => {
        const { state, tingyuan } = scene();
        const tough = dummy(state, [3, 3]);
        tough.defense = 6;
        cast1(tingyuan, state);
        expect(tough.currentHp).toBeGreaterThan(290);
    });
});

describe('技能二 · 万雷朝宗', () => {
    it('场上没有引雷印就是空放，直接失败', () => {
        const { state, tingyuan } = scene();
        dummy(state, [3, 3]);
        const output = cast2(tingyuan, state);
        expect(output.success).toBe(false);
        expect(output.log[0]).toContain('没有引雷印');
    });

    it('全场带印者一起挨点名，带链的每人牵出一轮传导，每轮对所有带链者造成1+命中的印数', () => {
        const { state, tingyuan } = scene();
        const first = dummy(state, [3, 2]);
        const second = dummy(state, [3, 4]);
        applyThunderMark(first, tingyuan.id);
        applyThunderMark(second, tingyuan.id);
        applyChainMark(first, tingyuan.id);
        applyChainMark(second, tingyuan.id);
        // 1 + 本次命中的引雷印数量（2）
        expect(chainDamageFor(2)).toBe(3);

        const output = cast2(tingyuan, state);
        expect(output.success).toBe(true);
        // 每人：点名10 + 两轮传导各3 = 16
        expect(first.currentHp).toBe(284);
        expect(second.currentHp).toBe(284);
        expect(output.damageDealt).toHaveLength(6);
    });

    it('印还在、链已散：挨点名却牵不动传导', () => {
        const { state, tingyuan } = scene();
        const marked = dummy(state, [3, 2]);
        applyThunderMark(marked, tingyuan.id);
        const output = cast2(tingyuan, state);
        expect(output.success).toBe(true);
        expect(marked.currentHp).toBe(290);
        expect(output.damageDealt).toHaveLength(1);
    });

    it('只跳一层：四名带链者互跳，每人恰好挨四轮传导', () => {
        const { state, tingyuan } = scene();
        const carriers = [[3, 0], [3, 2], [3, 4], [3, 5]].map(position => {
            const unit = dummy(state, position as [number, number]);
            applyThunderMark(unit, tingyuan.id);
            applyChainMark(unit, tingyuan.id);
            return unit;
        });
        const output = cast2(tingyuan, state);
        expect(output.success).toBe(true);
        // 点名10 + 4轮 × (1+4)=20
        for (const carrier of carriers) expect(carrier.currentHp).toBe(270);
        expect(output.damageDealt).toHaveLength(20);
    });

    it('传导途中死掉的人不再挨后面的雷', () => {
        const { state, tingyuan } = scene();
        const walkingDead = dummy(state, [3, 2]);
        const sturdy = dummy(state, [3, 4]);
        walkingDead.currentHp = 12;
        applyThunderMark(walkingDead, tingyuan.id);
        applyThunderMark(sturdy, tingyuan.id);
        applyChainMark(walkingDead, tingyuan.id);
        applyChainMark(sturdy, tingyuan.id);
        const output = cast2(tingyuan, state);
        expect(walkingDead.state).toBe(HeroState.DEAD);
        // 存活者仍挨点名10 + 两轮传导3+3
        expect(sturdy.currentHp).toBe(284);
        expect(output.success).toBe(true);
    });

    it('只认霆渊自己的手：别的霆渊挂的印与链都不是他的靶', () => {
        const { state, tingyuan } = scene();
        const other = addHero(state, 'tingyuan', 'player1', [1, 4]);
        other.defense = 0;
        // 同一毫秒创建的两名霆渊会撞 id，这里手动分开，才测得出"印只认挂它的那只手"
        other.id = 'tingyuan-player1-other';
        const victim = dummy(state, [3, 3]);
        applyThunderMark(victim, other.id);
        applyChainMark(victim, other.id);
        expect(thunderMarkedEnemies(state, tingyuan)).toHaveLength(0);
        expect(chainMarkedEnemies(state, tingyuan)).toHaveLength(0);
        expect(hasThunderMark(victim, tingyuan.id)).toBe(false);
        expect(hasChainMark(victim, other.id)).toBe(true);
        expect(cast2(tingyuan, state).success).toBe(false);
        // 那位霆渊自己来收口，才认这枚印
        expect(cast2(other, state).success).toBe(true);
    });

    it('死人不当靶：阵亡的带印者不进点名名单', () => {
        const { state, tingyuan } = scene();
        const alive = dummy(state, [3, 2]);
        const fallen = dummy(state, [3, 4]);
        applyThunderMark(alive, tingyuan.id);
        applyThunderMark(fallen, tingyuan.id);
        fallen.state = HeroState.DEAD;
        expect(thunderMarkedEnemies(state, tingyuan)).toEqual([alive]);
        const output = cast2(tingyuan, state);
        expect(output.damageDealt).toHaveLength(1);
    });

    it('印与链各有各的时钟：两回合后链先散、印还留着', () => {
        const { state, tingyuan } = scene();
        const victim = dummy(state, [3, 3]);
        cast1(tingyuan, state);
        EffectManager.updateEffectDurations(state);
        EffectManager.updateEffectDurations(state);
        expect(marks(victim, '链式闪电')).toHaveLength(0);
        expect(marks(victim, '引雷印')).toHaveLength(1);
    });
});
