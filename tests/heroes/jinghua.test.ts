import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import {
    drainPendingSkillFxRequests,
    getJinghuaSwapDestinations,
    jinghuaSkill1,
    jinghuaSkill2,
    jinghuaSwapLocked,
    resolveJinghuaSwapMove,
    tickJinghuaMoonSeats,
} from '../../src/data/extended-skills';
import { getJinghuaStacks } from '../../src/data/extended-heroes';
import { isPerTargetFxKind, resolveSkillFx } from '../../src/core/skill-fx';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 镜花·水月：水月换身 / 印月替身 / 镜湖双照 / 月座归场 / 天威·镜花照水。
 * 随机数钉死在 0.99：不闪避、不暴击，所有结算走确定分支。
 */
function setup() {
    const state = makeGameState();
    const jinghua = addHero(state, 'jinghua', 'player1', [3, 3]);
    const ally = addHero(state, 'baize', 'player1', [1, 1]);
    const enemy = addHero(state, 'nightowl', 'player2', [3, 5]);
    return { state, jinghua, ally, enemy };
}

function findEffect(hero: Hero, prefix: string) {
    return hero.effects.filter(effect => effect.name.startsWith(prefix));
}

describe('镜花·水月', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('技能1：全场换位并在原位放水月，被换上的队友落地即得5护盾', () => {
        const { state, jinghua, ally } = setup();
        const result = jinghuaSkill1.execute!(jinghua, [ally], state);
        expect(result.success).toBe(true);
        expect(state.board[1][1]).toBe(jinghua);
        expect(state.board[3][3]).toBe(ally);
        expect(ally.shield).toBe(5); // 换身正好踩进月影格，当场结盾
        const moon = (state.boardEffects ?? []).find(effect => effect.type === 'water-moon');
        expect(moon).toBeDefined();
        expect(moon!.position).toEqual([3, 3]);
        expect(moon!.expireAtActionSerial).toBe((jinghua.counters['__actionSerial'] ?? 0) + 2);
    });

    it('被动：与真身换位不耗移动力、镜影+1；与水月换影额外拿5护盾、月影退回原位', () => {
        const { state, jinghua, ally } = setup();
        const ally2 = addHero(state, 'xubai', 'player1', [0, 0]);
        // 真身交换：ally 走到镜花格 [3,3]，镜花退回 [1,1]
        expect(resolveJinghuaSwapMove(ally, [3, 3], state)).toBe('self');
        expect(state.board[3][3]).toBe(ally);
        expect(state.board[1][1]).toBe(jinghua);
        expect(getJinghuaStacks(jinghua)).toBe(1);
        expect(jinghuaSwapLocked(ally)).toBe(true);

        // 镜花与 ally 施放技能1换身：镜花落回 [3,3]，水月凝在她出发的 [1,1]——
        // 换身把 ally 正好送进月影格，落地即结5护盾
        jinghuaSkill1.execute!(jinghua, [ally], state);
        const moon = (state.boardEffects ?? []).find(effect => effect.type === 'water-moon')!;
        expect(moon.position).toEqual([1, 1]); // 施放时镜花站在 [1,1]
        expect(state.board[1][1]).toBe(ally);  // 换身后 ally 正落在水月上
        expect(ally.shield).toBe(5);           // 落地即得盾

        // 月影格被 ally 占着时不再提供踏月：ally2 直接踩会被拒绝
        expect(resolveJinghuaSwapMove(ally2, [1, 1], state)).toBeNull();
        // ally 走开后可再踩：月影换到 ally2 出发格
        state.board[1][1] = null;
        ally.position = [0, 1];
        state.board[0][1] = ally;
        expect(resolveJinghuaSwapMove(ally2, [1, 1], state)).toBe('moon');
        expect(state.board[1][1]).toBe(ally2);
        expect(ally2.shield).toBe(5);
        expect(getJinghuaStacks(jinghua)).toBe(2);
        const moved = (state.boardEffects ?? []).find(effect => effect.type === 'water-moon')!;
        expect(moved.position).toEqual([0, 0]);
    });

    it('镜影上限5层，且提供50%闪避与50%增伤', () => {
        const { state, jinghua, ally, enemy } = setup();
        for (let i = 0; i < 7; i++) {
            // 两名友方来回换身，每次都应尝试叠一层
            const from: Position = i % 2 === 0 ? [1, 1] : [3, 3];
            const to: Position = i % 2 === 0 ? [3, 3] : [1, 1];
            ally.position = from;
            state.board[from[0]][from[1]] = ally;
            jinghua.position = to;
            state.board[to[0]][to[1]] = jinghua;
            resolveJinghuaSwapMove(ally, to, state);
        }
        expect(getJinghuaStacks(jinghua)).toBe(5);

        // 增伤：0层 vs 5层对同一目标的面板伤害比 1:1.5
        jinghua.counters['镜影'] = 0;
        const plain = DamageCalculator.calculate(jinghua, enemy, 10, false, true);
        jinghua.counters['镜影'] = 5;
        const boosted = DamageCalculator.calculate(jinghua, enemy, 10, false, true);
        expect(boosted.finalDamage).toBeGreaterThan(plain.finalDamage);

        // 闪避：0.4 < 5层×10% → 免伤；0.6 ≥ 0.5 → 正常承受（闪避只对外敌生效）
        const hpBefore = jinghua.currentHp;
        vi.spyOn(Math, 'random').mockReturnValue(0.4);
        const dodged = DamageCalculator.calculate(enemy, jinghua, 8, false, true);
        DamageCalculator.applyDamage(jinghua, dodged, enemy, state);
        expect(jinghua.currentHp).toBe(hpBefore);
        vi.spyOn(Math, 'random').mockReturnValue(0.6);
        const hit = DamageCalculator.calculate(enemy, jinghua, 8, false, true);
        DamageCalculator.applyDamage(jinghua, hit, enemy, state);
        expect(jinghua.currentHp).toBeLessThan(hpBefore);
    });

    it('技能2：候补携印月登场、镜花下场留月座，镜影转入印月后清空', () => {
        const { state, jinghua, ally } = setup();
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['镜影'] = 3;
        ally.hasActedThisTurn = false;
        const landing: Position = [2, 4];
        jinghua.counters['__extended_target'] = landing[0] * 6 + landing[1];
        jinghua.counters['__jinghua_summon_pick'] = 0;

        const result = jinghuaSkill2.execute!(jinghua, [], state);
        expect(result.success).toBe(true);

        const rookie = state.board[2][4] as Hero;
        expect(rookie).toBeTruthy();
        expect(rookie.name).toBe('琉璃');
        expect(rookie.counters['__jinghua_substitute']).toBe(1); // 挂了替身印记，本体归场时要退位
        expect(rookie.hasActedThisTurn).toBe(true); // 登场当回合只入座
        expect(findEffect(rookie, '印月')).toHaveLength(2);
        expect(rookie.effects.find(e => e.name === '印月增伤')!.value).toBeCloseTo(0.3);
        expect(state.player1Heroes.some(hero => hero.id === rookie.id)).toBe(true);
        expect(state.player1BenchHeroIds).toEqual([]);

        // 镜花下场：暂死留编制、镜影清空、月座钉在原位
        expect(jinghua.state).toBe(HeroState.TEMP_DEAD);
        expect(jinghua.position).toBeNull();
        expect(jinghua.counters['__jinghua_offboard']).toBe(1);
        expect(jinghua.counters['镜影']).toBe(0);
        expect(jinghua.counters['__jinghua_return_hp']).toBeGreaterThan(0);
        const seat = (state.boardEffects ?? []).find(effect => effect.type === 'moon-seat');
        expect(seat!.position).toEqual([3, 3]);
    });

    it('月座：友方踏座即接镜花归场并触发登场天威，替身同步退位', () => {
        const { state, jinghua, enemy } = setup();
        // 用怀璧身法（游隼）来踏座；琉璃是替身，归场时要被收回
        const stepper = addHero(state, 'youjun', 'player1', [2, 3]);
        // 快速构造下场态
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghuaSkill2.execute!(jinghua, [], state);

        // 把踏座者已摆在月座旁 [2,3]，点击月座 [3,3]
        const hpBefore = enemy.currentHp;
        expect(resolveJinghuaSwapMove(stepper, [3, 3], state)).toBe('moonseat');

        expect(jinghua.state).toBe(HeroState.ALIVE);
        expect(state.board[3][3]).toBe(jinghua);
        expect(stepper.position).not.toEqual([3, 3]); // 踏座者让位（可能回填自己的出发格）
        expect(state.board[(stepper.position![0])][(stepper.position![1])]).toBe(stepper);
        expect((state.boardEffects ?? []).some(effect => effect.type === 'moon-seat')).toBe(false);
        expect(enemy.currentHp).toBeLessThan(hpBefore); // 天威照到了最近的敌人
        // 替身同步退位：琉璃离场回候补席，场上不出现第五名现役
        expect(state.board[2][4]).toBeNull();
        expect(state.player1Heroes.some(hero => hero.name === '琉璃')).toBe(false);
        expect(state.player1BenchHeroIds).toContain('liuli');
    });

    it('月座：替身自己去踏座，归场后棋盘不留幽灵棋子', () => {
        const { state, jinghua } = setup();
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghuaSkill2.execute!(jinghua, [], state);

        const sub = state.board[2][4] as Hero; // 琉璃替身，离月座 [3,3] 一步
        expect(sub.name).toBe('琉璃');
        expect(sub.counters['__jinghua_substitute']).toBe(1);
        expect(resolveJinghuaSwapMove(sub, [3, 3], state)).toBe('moonseat');

        expect(jinghua.state).toBe(HeroState.ALIVE);
        expect(state.board[3][3]).toBe(jinghua);
        // 逐格扫盘：棋盘上不允许存在不在名册里的"幽灵"（曾把退场替身摆回棋盘卡死）
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const unit = state.board[r][c];
                if (!unit) continue;
                expect(
                    state.player1Heroes.includes(unit) || state.player2Heroes.includes(unit),
                    `(${r},${c}) 残留幽灵 ${unit.name}`
                ).toBe(true);
            }
        }
        expect(state.player1Heroes.some(hero => hero.name === '琉璃')).toBe(false);
        expect(state.player1BenchHeroIds).toContain('liuli');
    });

    it('月座：敌方踩上不响应，被占期间不提供踏座落点', () => {
        const { state, jinghua, enemy } = setup();
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghuaSkill2.execute!(jinghua, [], state);

        // 敌方夜枭踏入月座格：只是普通移动，绝不触发归场
        expect(resolveJinghuaSwapMove(enemy, [3, 3], state)).toBeNull();
        expect(jinghua.state).toBe(HeroState.TEMP_DEAD);

        // 夜枭占座后：队友既拿不到踏座落点，也无法强踏
        state.board[3][3] = enemy;
        enemy.position = [3, 3];
        const ally = state.player1Heroes.find(hero => hero.name === '白泽')!;
        expect(getJinghuaSwapDestinations(ally, state)).not.toContainEqual([3, 3]);
        expect(resolveJinghuaSwapMove(ally, [3, 3], state)).toBeNull();
        expect(jinghua.state).toBe(HeroState.TEMP_DEAD);
    });

    it('月座：三回合无人踏则自动归位，替身因此能行动两拍', () => {
        const { state, jinghua } = setup();
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghua.counters['镜影'] = 2; // 带两层镜影下场，替身才携印月登场
        jinghuaSkill2.execute!(jinghua, [], state);
        const seat = (state.boardEffects ?? []).find(effect => effect.type === 'moon-seat')!;
        // 窗口三回合：登场那拍只入座，之后第1、2回合都能动手
        expect(seat.duration).toBe(3);
        const rookie = state.board[2][4] as Hero;
        const yinyue = rookie.effects.filter(effect => effect.name.startsWith('印月'));
        expect(yinyue.map(effect => effect.duration)).toEqual([3, 3]);

        seat.duration = 2;
        tickJinghuaMoonSeats(state); // 还有余量：不动
        expect(jinghua.state).toBe(HeroState.TEMP_DEAD);

        seat.duration = 1;
        tickJinghuaMoonSeats(state); // 时辰到：自动归位回月座格
        expect(jinghua.state).toBe(HeroState.ALIVE);
        expect(state.board[3][3]).toBe(jinghua);
        expect((state.boardEffects ?? []).some(effect => effect.type === 'moon-seat')).toBe(false);
        // 自动归位同样收回替身：琉璃退回候补席
        expect(state.player1Heroes.some(hero => hero.name === '琉璃')).toBe(false);
        expect(state.player1BenchHeroIds).toContain('liuli');
    });

    it('镜花阵亡：水月与月座随镜碎散，不留无主标记', () => {
        const { state, jinghua, ally, enemy } = setup();
        jinghuaSkill1.execute!(jinghua, [ally], state);
        expect((state.boardEffects ?? []).some(effect => effect.type === 'water-moon')).toBe(true);

        const lethal = DamageCalculator.calculate(enemy, jinghua, 99, false, true);
        DamageCalculator.applyDamage(jinghua, lethal, enemy, state);
        expect(jinghua.state).toBe(HeroState.DEAD);
        expect((state.boardEffects ?? []).some(effect =>
            (effect.type === 'water-moon' || effect.type === 'moon-seat') &&
            effect.sourceHeroId === jinghua.id)).toBe(false);
    });

    it('天威：登场照击杀敌人时回声一名友方的天威', () => {
        const { state, jinghua, ally } = setup();
        // 回声池要有可点名的天威持有者（排除镜花自己）
        const bank = addHero(state, 'wangcai', 'player1', [5, 5]);
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghuaSkill2.execute!(jinghua, [], state);

        // 把最近敌人削到残血，让登场照击一发击杀 → 触发友方天威回声
        const enemy = state.board[3][5] as Hero;
        enemy.currentHp = 1;
        state.board[ally.position![0]][ally.position![1]] = null;
        ally.position = [2, 3];
        state.board[2][3] = ally;
        const attackBefore = bank.baseAttack ?? 0;
        resolveJinghuaSwapMove(ally, [3, 3], state);

        expect(enemy.state).toBe(HeroState.DEAD);
        expect(state.battleLog.some(entry => entry.message.includes('月影回声'))).toBe(true);
        // 随机钉 0.99 → 点名池最后一位：旺财的击杀天威（永久+2攻击）应已响起
        expect(bank.baseAttack).toBe(attackBefore + 2);
        // 回声要看得见：被点名者脚下排队派发一次月华光柱特效
        const fxRequests = drainPendingSkillFxRequests();
        expect(fxRequests.some(request => request.skillId === 'jinghua_tianwei_echo')).toBe(true);
    });

    it('天威回声：场上没有天威持有者时明确播报，不再静默', () => {
        const { state, jinghua } = setup();
        // setup 阵容：白泽/夜枭都无天威设计（白泽只有复活技能），镜花自己排除
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghuaSkill2.execute!(jinghua, [], state);

        const enemy = state.board[3][5] as Hero;
        enemy.currentHp = 1;
        const stepper = addHero(state, 'youjun', 'player1', [2, 3]);
        resolveJinghuaSwapMove(stepper, [3, 3], state);

        expect(enemy.state).toBe(HeroState.DEAD);
        expect(state.battleLog.some(entry => entry.message.includes('没有携带天威的友方'))).toBe(true);
    });

    it('候补席为空时技能2直接失败，不动镜花状态', () => {
        const { state, jinghua } = setup();
        state.player1BenchHeroIds = [];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        const result = jinghuaSkill2.execute!(jinghua, [], state);
        expect(result.success).toBe(false);
        expect(jinghua.state).toBe(HeroState.ALIVE);
    });

    it('镜花自己移动不会触发被动交换，也不能借自己的水月', () => {
        const { state, jinghua, ally } = setup();
        jinghuaSkill1.execute!(jinghua, [ally], state);
        // 施放后镜花在 ally 原位 [1,1]，月影在 [3,3]
        expect(resolveJinghuaSwapMove(jinghua, [3, 3], state)).toBeNull();
        expect(getJinghuaStacks(jinghua)).toBe(0);
    });

    it('天威特效：月牙飞斩档案，且从镜花格飞向每一名被照中的敌人', () => {
        const { state, jinghua } = setup();
        state.player1BenchHeroIds = ['liuli'];
        jinghua.counters['__extended_target'] = 2 * 6 + 4;
        jinghua.counters['__jinghua_summon_pick'] = 0;
        jinghuaSkill2.execute!(jinghua, [], state);
        const stepper = addHero(state, 'youjun', 'player1', [2, 3]);
        resolveJinghuaSwapMove(stepper, [3, 3], state);

        const strike = drainPendingSkillFxRequests()
            .find(request => request.skillId === 'jinghua_tianwei');
        expect(strike).toBeDefined();
        // 起手格是镜花自己，命中格是被照中的敌人——飞刃由此起于她、落于敌
        expect(strike!.fromPos).toEqual(jinghua.position);
        expect(strike!.impactPositions).toEqual([strike!.targetPos]);
        // 用专属月牙原型，而不是退回通用弧斩；照中几人就飞来几弯
        expect(resolveSkillFx('jinghua_tianwei').kind).toBe('jinghua-moonblade');
        expect(isPerTargetFxKind('jinghua-moonblade')).toBe(true);
    });
});
