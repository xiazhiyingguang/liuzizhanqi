import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { resolveSkillFx } from '../../src/core/skill-fx';
import {
    drainPendingSkillFxRequests,
    huanongyingSkill1,
    huanongyingSkill2,
    resolveHnyReplay,
} from '../../src/data/extended-skills';
import { findHnyShadow } from '../../src/data/extended-heroes';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 花弄影：花间辞扇斩甩影 / 弄影身影互换 / 行动末影子重演 / 天威·花谢影不落。
 * 随机数钉死在 0.99：不闪避、不暴击，所有结算走确定分支。
 */
function setup() {
    const state = makeGameState();
    const hanying = addHero(state, 'huanongying', 'player1', [3, 3]);
    return { state, hanying };
}

function castFan(hanying: Hero, state: GameState, dirCode: number) {
    hanying.counters['__hny_dir'] = dirCode;
    return huanongyingSkill1.execute!(hanying, [], state);
}

function shadowOf(state: GameState): Position | null {
    const shadow = findHnyShadow(state, 'player1');
    return shadow ? shadow.position : null;
}

describe('花弄影', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('技能1花间辞：扇形三格各吃6点，影子落在最后被斩中的格子', () => {
        const { state, hanying } = setup();
        const front = addHero(state, 'nightowl', 'player2', [2, 3]);
        const flank = addHero(state, 'baize', 'player2', [2, 4]);

        const result = castFan(hanying, state, 0); // 朝上：[2,2]/[2,3]/[2,4]
        expect(result.success).toBe(true);
        expect(front.currentHp).toBe(front.maxHp - 6);
        expect(flank.currentHp).toBe(flank.maxHp - 6);
        // 扫描序里最后命中的是右前 [2,4]，影子甩到那里
        expect(shadowOf(state)).toEqual([2, 4]);
        expect(hanying.counters['__hny_last_attack']).toBe(1);
        expect(hanying.counters['__hny_last_dir']).toBe(0);
    });

    it('技能1可以斩空：全落空仍把影子摆在正前格，供下一段弄影用', () => {
        const { state, hanying } = setup();
        const result = castFan(hanying, state, 0);
        expect(result.success).toBe(true);
        expect(shadowOf(state)).toEqual([2, 3]);
    });

    it('技能1无方向计数时按点击格推导朝向（AI 直调路径）', () => {
        const { state, hanying } = setup();
        const front = addHero(state, 'nightowl', 'player2', [3, 4]); // 正右方
        hanying.counters['__extended_target'] = 3 * 6 + 4;
        const result = huanongyingSkill1.execute!(hanying, [], state);
        expect(result.success).toBe(true);
        expect(front.currentHp).toBe(front.maxHp - 6);
    });

    it('被动重演：行动末影子在影格沿同方向再挥扇形（3点），随后消耗重演额度', () => {
        const { state, hanying } = setup();
        addHero(state, 'nightowl', 'player2', [2, 3]);
        const deep = addHero(state, 'baize', 'player2', [1, 3]); // 影子在[2,3]，重演扇形罩住[1,3]

        castFan(hanying, state, 0);
        expect(shadowOf(state)).toEqual([2, 3]);
        resolveHnyReplay(hanying, state);
        expect(deep.currentHp).toBe(deep.maxHp - 3);
        expect(hanying.counters['__hny_last_attack']).toBe(0);

        // 额度已消耗：再叫一次重演不会有多余一刀
        resolveHnyReplay(hanying, state);
        expect(deep.currentHp).toBe(deep.maxHp - 3);
    });

    it('重演挂在行动末：GameEngine.endHeroAction 触发影子补刀', () => {
        const { state, hanying } = setup();
        state.currentPlayer = 'player1';
        state.activeHero = hanying;
        addHero(state, 'nightowl', 'player2', [2, 3]);
        const deep = addHero(state, 'baize', 'player2', [1, 2]);

        castFan(hanying, state, 0);
        GameEngine.endHeroAction(hanying, state);
        // 影子在 [2,3] 朝上重演扇形：[1,2] 在左前格内
        expect(deep.currentHp).toBe(deep.maxHp - 3);
    });

    it('技能2弄影：没有影子不可用；有影子则身影互换、落地环斩8点', () => {
        const { state, hanying } = setup();
        expect(SkillSystem.canUseSkill(hanying, huanongyingSkill2, state)).toBe(false);
        expect(huanongyingSkill2.execute!(hanying, [], state).success).toBe(false);

        castFan(hanying, state, 0); // 影子落在 [2,3]
        expect(SkillSystem.canUseSkill(hanying, huanongyingSkill2, state)).toBe(true);
        const neighbor = addHero(state, 'baize', 'player2', [1, 3]);

        const result = huanongyingSkill2.execute!(hanying, [], state);
        expect(result.success).toBe(true);
        expect(hanying.position).toEqual([2, 3]);
        expect(shadowOf(state)).toEqual([3, 3]); // 影子回到她出发的格子
        expect(neighbor.currentHp).toBe(neighbor.maxHp - 8);
        expect(hanying.hasMovedThisTurn).toBe(true);
        expect(hanying.counters['__hny_last_attack']).toBe(2);
    });

    it('技能2重演：行动末影子留在出发格环身补4点，进场断后两头咬', () => {
        const { state, hanying } = setup();
        castFan(hanying, state, 0); // 影子 [2,3]
        huanongyingSkill2.execute!(hanying, [], state); // 身影互换：影子回到 [3,3]
        const chaser = addHero(state, 'nightowl', 'player2', [3, 4]); // 贴着她的出发格

        resolveHnyReplay(hanying, state);
        expect(chaser.currentHp).toBe(chaser.maxHp - 4);
    });

    it('技能2被占位封锁：影子上站着别人时换不进去', () => {
        const { state, hanying } = setup();
        castFan(hanying, state, 0); // 影子 [2,3]
        addHero(state, 'baize', 'player1', [2, 3]);
        const result = huanongyingSkill2.execute!(hanying, [], state);
        expect(result.success).toBe(false);
        expect(hanying.position).toEqual([3, 3]);
    });

    it('天威花谢影不落：击杀当场追加七折重演，且不因重演击杀而连锁', () => {
        const { state, hanying } = setup();
        const victim = addHero(state, 'nightowl', 'player2', [2, 3]);
        victim.currentHp = 1; // 扇形6点必杀
        const echo = addHero(state, 'baize', 'player2', [1, 3]); // 影子重演扇形罩住

        castFan(hanying, state, 0);
        expect(victim.state).toBe(HeroState.DEAD);
        // 追加重演：3×0.7=2.1 → 2点
        expect(echo.currentHp).toBe(echo.maxHp - 2);
        const tianweiLogs = (state.battleLog ?? []).filter(entry =>
            entry.message.includes('花谢影不落'));
        expect(tianweiLogs).toHaveLength(1);
        // 天威追加不消耗行动末的重演额度
        expect(hanying.counters['__hny_last_attack']).toBe(1);
    });

    it('影子全场唯一且存续两回合：再次花间辞是挪影而非叠影', () => {
        const { state, hanying } = setup();
        castFan(hanying, state, 0);
        const first = findHnyShadow(state, 'player1')!;
        expect(first.duration).toBe(2);

        castFan(hanying, state, 1); // 朝下重新甩影
        const marks = (state.boardEffects ?? []).filter(effect => effect.type === 'shadow-mark');
        expect(marks).toHaveLength(1);
        expect(marks[0].position).toEqual([4, 3]);
    });

    it('花弄影阵亡：影子随之散去，不留无主跳板', () => {
        const { state, hanying } = setup();
        castFan(hanying, state, 0);
        const executioner = addHero(state, 'skeletonking', 'player2', [0, 0]);
        const lethal = DamageCalculator.calculate(executioner, hanying, 99, false, true);
        DamageCalculator.applyDamage(hanying, lethal, executioner, state);
        expect(hanying.state).toBe(HeroState.DEAD);
        expect(findHnyShadow(state, 'player1')).toBeNull();
    });

    it('特效档案与请求队列：花间辞/弄影/重演各有专属原型，重演走请求队列派发', () => {
        const { state, hanying } = setup();
        expect(resolveSkillFx('huanongying_skill1').kind).toBe('triple-slash');
        expect(resolveSkillFx('huanongying_skill2').kind).toBe('phase-swap');
        expect(resolveSkillFx('huanongying_replay').kind).toBe('arc-slash');

        addHero(state, 'nightowl', 'player2', [2, 3]);
        castFan(hanying, state, 0);
        drainPendingSkillFxRequests(); // 清掉施法阶段的残留
        resolveHnyReplay(hanying, state);
        const fxRequests = drainPendingSkillFxRequests();
        expect(fxRequests.some(request => request.skillId === 'huanongying_replay')).toBe(true);
    });
});
