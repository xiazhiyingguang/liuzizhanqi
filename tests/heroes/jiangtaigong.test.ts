import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { MovementSystem } from '../../src/core/movement-system';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { addDilanFeather } from '../../src/data/extended-heroes';
import { getHeroInfo } from '../../src/data/heroes';
import { jiangtaigongSkill1, jiangtaigongSkill2 } from '../../src/data/extended-skills';
import {
    coveringMarshes,
    expandMarshesForTianwei,
    findHookAt,
    getMarshDodgeRate,
    HOOK_MAX,
    hookThrowLandings,
    hookThrowLocked,
    jiangtaigongDragCells,
    marshCells,
    placeHook,
    placeMarsh,
    releaseHookThrowLock,
    resolveHookThrow,
    rollWhaleFall,
    triggerHookBite,
    whaleFallRate,
    WHALEFALL_BASE_RATE,
    WHALEFALL_STEP_RATE,
    MARSH_DURATION,
    MARSH_MAX_RADIUS,
    MARSH_SKILL2_RADIUS,
    MARSH_STACK_CAP,
} from '../../src/core/water-marsh';
import { useGameStore } from '../../src/store/game-store';
import { HeroState, type GameState, type Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 姜太公：水泽（可叠加的闪避场地）→ 鱼钩（经过即上钩的一次性陷阱）→
 * 上钩后由他点一格把人抛过去；他自己站在水里时出手会累加「鲸落」概率。
 *
 * 随机数默认钉在 0.99：不闪避、不暴击、鲸落不落，所有结算走确定分支；
 * 需要命中概率的用例单独把 Math.random 改到 0。
 */

function scene() {
    const state = makeGameState();
    const taigong = addHero(state, 'jiangtaigong', 'player1', [2, 2]);
    taigong.defense = 0;
    return { state, taigong };
}

function enemy(state: GameState, position: [number, number]) {
    const unit = addHero(state, 'baize', 'player2', position);
    unit.defense = 0;
    return unit;
}

function ally(state: GameState, position: [number, number], templateId = 'moran') {
    const unit = addHero(state, templateId, 'player1', position);
    unit.defense = 0;
    return unit;
}

function hooks(state: GameState) {
    return (state.boardEffects ?? []).filter(effect => effect.type === 'fish-hook');
}

function marshes(state: GameState) {
    return (state.boardEffects ?? []).filter(effect => effect.type === 'water-marsh');
}

/** 一次普通出手：走引擎的出手组，被动的"每次出手之后"才按实战口径推进 */
function attackOnce(attacker: Hero, target: Hero, state: GameState, amount = 5) {
    const hit = DamageCalculator.calculate(attacker, target, amount, false);
    DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(target, hit, attacker, state));
    return hit.finalDamage;
}

describe('姜太公 · 面板', () => {
    it('生命52、移动力2、天师，两条技能与被动都接上', () => {
        const info = getHeroInfo('jiangtaigong');
        expect([info.name, info.class]).toEqual(['姜太公', '天师']);
        const { taigong } = scene();
        expect([taigong.maxHp, taigong.moveRange]).toEqual([52, 2]);
        expect([taigong.skill1Id, taigong.skill2Id, taigong.passiveId, taigong.tianweiId]).toEqual([
            'jiangtaigong_skill1', 'jiangtaigong_skill2', 'jiangtaigong_passive', 'jiangtaigong_tianwei',
        ]);
    });

    it('致知一：生命 +8', () => {
        const { taigong } = scene();
        grantZhizhi(taigong, 1);
        expect(taigong.maxHp).toBe(60);
    });

    it('技能二的可选目标格是八条射线各两格（16 格，不含贴身以外的斜线）', () => {
        const cells = jiangtaigongDragCells([3, 3]);
        expect(cells).toHaveLength(16);
        expect(cells).toContainEqual([1, 3]);
        expect(cells).toContainEqual([3, 5]);
        expect(cells).toContainEqual([1, 1]);
        expect(cells).not.toContainEqual([1, 2]);   // 马步形（行差2、列差1）不在八条射线上
        expect(cells).not.toContainEqual([3, 3]);
    });
});

describe('姜太公 · 技能一「钓雪」', () => {
    it('在 5×5 内的空格下钩：钩子持续三回合，并当场铺好 3×3 水泽', () => {
        const { state, taigong } = scene();
        taigong.counters['__extended_target'] = 3 * 6 + 4;
        const output = jiangtaigongSkill1.execute!(taigong, [], state);
        expect(output.success).toBe(true);
        const hook = findHookAt(state, [3, 4]);
        expect(hook?.duration).toBe(3);
        expect(hook?.owner).toBe('player1');
        // 水泽不等上钩：下钩这一拍就以鱼钩为圆心铺好，两回合
        const marsh = marshes(state).find(effect => effect.position[0] === 3 && effect.position[1] === 4);
        expect(marshCells(marsh!)).toHaveLength(9);
        expect(marsh!.duration).toBe(MARSH_DURATION);
    });

    it('越界、有人、已有钩的落点都被拒', () => {
        const { state, taigong } = scene();
        taigong.counters['__extended_target'] = 5 * 6 + 5;
        expect(jiangtaigongSkill1.execute!(taigong, [], state).success).toBe(false);
        taigong.counters['__extended_target'] = 2 * 6 + 3;
        enemy(state, [2, 3]);
        expect(jiangtaigongSkill1.execute!(taigong, [], state).success).toBe(false);
        const fresh = scene();
        fresh.taigong.counters['__extended_target'] = 3 * 6 + 4;
        expect(jiangtaigongSkill1.execute!(fresh.taigong, [], fresh.state).success).toBe(true);
        expect(jiangtaigongSkill1.execute!(fresh.taigong, [], fresh.state).success).toBe(false);
    });

    it('同一个人场上至多三枚，第四枚挤掉最旧的那枚', () => {
        const { state, taigong } = scene();
        placeHook(state, taigong, [0, 0]);
        placeHook(state, taigong, [0, 5]);
        placeHook(state, taigong, [5, 0]);
        expect(hooks(state)).toHaveLength(HOOK_MAX);
        placeHook(state, taigong, [5, 5]);
        expect(hooks(state)).toHaveLength(HOOK_MAX);
        expect(findHookAt(state, [0, 0])).toBeUndefined();
        expect(findHookAt(state, [5, 5])?.position).toEqual([5, 5]);
    });
});

describe('姜太公 · 上钩与抛掷', () => {
    it('敌人经过钩子格：钩子消失、挂起等点落点，水泽沿用了下钩时铺的那片（不再叠第二片）', () => {
        const { state, taigong } = scene();
        const victim = addHero(state, 'baize', 'player2', [4, 4]);   // 钩子在 [3,4]，他往 [2,4] 走正好路过
        victim.defense = 0;
        taigong.counters['__extended_target'] = 3 * 6 + 4;
        jiangtaigongSkill1.execute!(taigong, [], state);
        expect(marshes(state)).toHaveLength(1);

        expect(triggerHookBite(state, victim, [3, 4])).toBe(true);
        expect(findHookAt(state, [3, 4])).toBeUndefined();
        expect(marshes(state)).toHaveLength(1);
        expect(marshCells(marshes(state)[0])).toHaveLength(9);
        expect(state.pendingBoardAction).toMatchObject({
            type: 'jiangtaigong-hook', heroId: taigong.id, hookTargetId: victim.id,
        });
    });

    it('走位路径经过钩子格时由移动系统当场触发，不是只在落点判', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [4, 4]);
        placeHook(state, taigong, [3, 4]);
        expect(MovementSystem.moveHero(victim, [2, 4], state)).toBe(true);
        expect(victim.position).toEqual([2, 4]);
        expect(findHookAt(state, [3, 4])).toBeUndefined();
        expect(state.pendingBoardAction?.type).toBe('jiangtaigong-hook');
    });

    it('自己人从钩子上跨过去什么也不会发生', () => {
        const { state, taigong } = scene();
        const mate = ally(state, [3, 4]);
        placeHook(state, taigong, [3, 4]);
        expect(triggerHookBite(state, mate, [3, 4])).toBe(false);
        expect(hooks(state)).toHaveLength(1);
        expect(state.pendingBoardAction).toBeUndefined();
    });

    it('钩主已阵亡：钩子跟着失效，不咬人也不留水泽', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [3, 4]);
        placeHook(state, taigong, [3, 4]);
        taigong.state = HeroState.DEAD;
        expect(triggerHookBite(state, victim, [3, 4])).toBe(false);
        expect(hooks(state)).toHaveLength(1);
        expect(marshes(state)).toHaveLength(0);
        expect(state.pendingBoardAction).toBeUndefined();
    });

    it('抛掷：落点必须空，成功后换格、吃10点伤害、并被上撤回锁', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [3, 4]);
        const hpBefore = victim.currentHp;
        expect(resolveHookThrow(state, taigong, victim, [9, 9])).toBe(0);   // 棋盘外一律不抛
        expect(victim.position).toEqual([3, 4]);
        ally(state, [0, 0]);
        expect(resolveHookThrow(state, taigong, victim, [0, 0])).toBe(0);   // 有人占着
        const dealt = resolveHookThrow(state, taigong, victim, [5, 5]);
        expect(dealt).toBe(10);
        expect(victim.position).toEqual([5, 5]);
        expect(victim.currentHp).toBe(hpBefore - 10);
        expect(hookThrowLocked(victim)).toBe(true);
        releaseHookThrowLock(victim);
        expect(hookThrowLocked(victim)).toBe(false);
    });

    it('落点集合是"全场任意空格"：有人站的格不在里面', () => {
        const { state } = scene();
        enemy(state, [3, 4]);
        const landings = hookThrowLandings(state);
        expect(landings).toHaveLength(34);
        expect(landings.some(([row, col]) => row === 3 && col === 4)).toBe(false);
    });
});

describe('姜太公 · 水泽', () => {
    it('一片 20%、两片 40%、三片仍按 40% 封顶；敌方站进去拿不到', () => {
        const { state, taigong } = scene();
        const mate = ally(state, [2, 2], 'baize');
        const foe = enemy(state, [2, 4]);
        expect(getMarshDodgeRate(state, mate)).toBe(0);
        placeMarsh(state, taigong, [2, 3]);
        expect(getMarshDodgeRate(state, mate)).toBeCloseTo(0.2);
        expect(getMarshDodgeRate(state, foe)).toBe(0);   // 位置就在水泽里，但阵营不对
        placeMarsh(state, taigong, [1, 2]);
        placeMarsh(state, taigong, [3, 2]);
        expect(coveringMarshes(state, mate)).toHaveLength(3);
        expect(MARSH_STACK_CAP).toBe(2);
        expect(getMarshDodgeRate(state, mate)).toBeCloseTo(0.4);
        expect(getMarshDodgeRate(state, foe)).toBe(0);
    });

    it('致知二：每片 20% → 25%，封顶 50%', () => {
        const { state, taigong } = scene();
        grantZhizhi(taigong, 2);
        const mate = ally(state, [2, 2]);
        placeMarsh(state, taigong, [2, 2]);
        expect(getMarshDodgeRate(state, mate)).toBeCloseTo(0.25);
        placeMarsh(state, taigong, [2, 3]);
        expect(getMarshDodgeRate(state, mate)).toBeCloseTo(0.5);
    });

    it('水泽按片独立倒计时，重新铺一片不会把旧的那片续期', () => {
        const { state, taigong } = scene();
        placeMarsh(state, taigong, [2, 2]);
        placeMarsh(state, taigong, [4, 4]);
        expect(marshes(state)).toHaveLength(2);
        expect(marshes(state).every(effect => effect.duration === MARSH_DURATION)).toBe(true);
    });

    it('站在水泽里真的能闪掉攻击（概率钉在闪避线内时伤害归零）', () => {
        const { state, taigong } = scene();
        const mate = ally(state, [2, 2]);
        const foe = enemy(state, [0, 5]);
        placeMarsh(state, taigong, [2, 2]);
        vi.spyOn(Math, 'random').mockReturnValue(0.05);
        const hpBefore = mate.currentHp;
        const hit = DamageCalculator.calculate(foe, mate, 8, false);
        DamageCalculator.applyDamage(mate, hit, foe, state);
        expect(mate.currentHp).toBe(hpBefore);
        expect(state.battleLog.some(log => log.message.includes('借水泽藏身'))).toBe(true);
    });
});

describe('姜太公 · 被动「太公垂钩」', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('不在水泽里不掷概率，档位也不涨', () => {
        const { state, taigong } = scene();
        const foe = enemy(state, [0, 5]);
        expect(rollWhaleFall(state, taigong)).toBe(false);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE);
        attackOnce(taigong, foe, state);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE);
    });

    it('用技能也算出手：站在水泽里丢一竿就掷一次概率', () => {
        const { state, taigong } = scene();
        placeMarsh(state, taigong, [2, 2]);
        taigong.counters['__extended_target'] = 2 * 6 + 4;
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        expect(jiangtaigongSkill1.execute!(taigong, [], state).success).toBe(true);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE + WHALEFALL_STEP_RATE);
    });

    it('技能二铺完泽当场掷一次：档位攒满后这一竿必落', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [0, 2]);
        const mate = ally(state, [1, 1], 'baize');
        mate.currentHp = 20;
        placeMarsh(state, taigong, [2, 2]);
        const roll = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        // 先空掷三次把 25% 顶到必落档
        rollWhaleFall(state, taigong);
        rollWhaleFall(state, taigong);
        rollWhaleFall(state, taigong);
        expect(whaleFallRate(taigong)).toBe(1);

        roll.mockReturnValue(0);
        expect(jiangtaigongSkill2.execute!(taigong, [victim], state).success).toBe(true);
        expect(mate.currentHp).toBe(25);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE);
    });

    it('没落一次就加一档：25% → 50% → 75% → 100% 必落，落下后回到 25%', () => {
        const { state, taigong } = scene();
        placeMarsh(state, taigong, [2, 2]);
        const roll = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        expect(rollWhaleFall(state, taigong)).toBe(false);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE + WHALEFALL_STEP_RATE);
        expect(rollWhaleFall(state, taigong)).toBe(false);
        expect(rollWhaleFall(state, taigong)).toBe(false);
        expect(whaleFallRate(taigong)).toBe(1);
        // 100% 档：这一掷必然落下，落完回到起手值
        roll.mockReturnValue(0.99);
        expect(rollWhaleFall(state, taigong)).toBe(true);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE);
    });

    it('致知三：30% 起、每次 +30%', () => {
        const { state, taigong } = scene();
        grantZhizhi(taigong, 3);
        placeMarsh(state, taigong, [2, 2]);
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        expect(whaleFallRate(taigong)).toBeCloseTo(0.3);
        rollWhaleFall(state, taigong);
        expect(whaleFallRate(taigong)).toBeCloseTo(0.6);
        rollWhaleFall(state, taigong);
        expect(whaleFallRate(taigong)).toBeCloseTo(0.9);
    });

    it('鲸落：以随机一格为圆心 3×3，友方各回5、敌方各受5', () => {
        const { state, taigong } = scene();
        const mate = ally(state, [1, 1], 'baize');
        const foe = enemy(state, [1, 2]);
        placeMarsh(state, taigong, [2, 2]);
        mate.currentHp = 20;
        const foeHpBefore = foe.currentHp;
        vi.spyOn(Math, 'random').mockReturnValue(0);   // 必落 + 随机格取片内第一格 [1,1]
        expect(rollWhaleFall(state, taigong)).toBe(true);
        expect(mate.currentHp).toBe(25);
        expect(foe.currentHp).toBe(foeHpBefore - 5);
        expect(state.battleLog.some(log => log.message.includes('鲸落'))).toBe(true);
    });

    it('鲸落自己的伤害不会再滚出第二次鲸落', () => {
        const { state, taigong } = scene();
        const foe = enemy(state, [1, 2]);
        placeMarsh(state, taigong, [1, 1]);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        attackOnce(taigong, foe, state);
        expect(whaleFallRate(taigong)).toBeCloseTo(WHALEFALL_BASE_RATE);
    });
});

describe('姜太公 · 技能二「渭水垂竿」', () => {
    it('把两格内的敌人沿直线拖到自己身边，并在自己周围铺开一片 5×5 水泽', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [0, 2]);
        const output = jiangtaigongSkill2.execute!(taigong, [victim], state);
        expect(output.success).toBe(true);
        expect(victim.position).toEqual([1, 2]);
        expect(marshes(state)).toHaveLength(1);
        expect(marshes(state)[0].position).toEqual([2, 2]);
        // 半径 2 = 5×5：技能二一铺就能罩住自己周围两格整圈
        expect(marshCells(marshes(state)[0])).toHaveLength(25);
    });

    it('沿途被别的单位挡住时一步都不动，但水泽照样铺开', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [0, 2]);
        ally(state, [1, 2]);
        const output = jiangtaigongSkill2.execute!(taigong, [victim], state);
        expect(output.success).toBe(true);
        expect(victim.position).toEqual([0, 2]);
        expect(state.battleLog.some(log => log.message.includes('一步都没被拖过来'))).toBe(true);
        expect(marshes(state)).toHaveLength(1);
    });

    it('拖拽途中压过自己的鱼钩：当场钩住并挂起落点选择', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [0, 2]);
        placeHook(state, taigong, [1, 2]);
        jiangtaigongSkill2.execute!(taigong, [victim], state);
        expect(victim.position).toEqual([1, 2]);
        expect(findHookAt(state, [1, 2])).toBeUndefined();
        expect(state.pendingBoardAction).toMatchObject({
            type: 'jiangtaigong-hook', heroId: taigong.id, hookTargetId: victim.id,
        });
    });

    it('拖拽按"被对手摆布的位置"记羽化：帝兰的羽化会跟着掉血', () => {
        const { state, taigong } = scene();
        const dilan = ally(state, [5, 5], 'dilan');
        const victim = enemy(state, [0, 2]);
        addDilanFeather(victim, dilan, 1);
        const hpBefore = victim.currentHp;
        // 随机数钉死：不暴击、也不掷出鲸落（技能二本身会掷），才量得准羽化那一下
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        jiangtaigongSkill2.execute!(taigong, [victim], state);
        expect(victim.position).toEqual([1, 2]);
        expect(victim.currentHp).toBe(hpBefore - 1);   // 拖一格，羽化每格1点
    });
});

describe('姜太公 · 天威「太公逐泽」', () => {
    it('击杀时每片水泽各扩一圈并多留一回合，最大压到 6×6 就停', () => {
        const { state, taigong } = scene();
        const foe = enemy(state, [2, 3]);
        placeMarsh(state, taigong, [0, 0]);
        placeMarsh(state, taigong, [3, 3], MARSH_SKILL2_RADIUS);
        expect(expandMarshesForTianwei(state, taigong)).toBe(2);
        expect(marshes(state).map(effect => effect.radius)).toEqual([2, MARSH_MAX_RADIUS]);
        expect(marshes(state).every(effect => effect.duration === MARSH_DURATION + 1)).toBe(true);
        // 覆盖窗口贴边时整体平移进棋盘，不裁切：角落那片仍是完整 5×5；名义 7×7 压成 6×6 = 整张棋盘
        const corner = marshes(state).find(effect => effect.position[0] === 0)!;
        const wide = marshes(state).find(effect => effect.position[0] === 3)!;
        expect(marshCells(corner)).toHaveLength(25);
        expect(marshCells(corner)).toContainEqual([4, 4]);
        expect(marshCells(wide)).toHaveLength(36);
        expect(expandMarshesForTianwei(state, taigong)).toBe(2);
        // 已经到 6×6 上限的水泽：再触发天威只续期，不会鼓得更大
        expect(marshes(state).map(effect => effect.radius)).toEqual([MARSH_MAX_RADIUS, MARSH_MAX_RADIUS]);
        expect(marshes(state).every(effect => effect.duration === MARSH_DURATION + 2)).toBe(true);
        expect(foe.position).toEqual([2, 3]);
    });

    it('一片水泽都没有时天威空响，不报错', () => {
        const { state, taigong } = scene();
        expect(expandMarshesForTianwei(state, taigong)).toBe(0);
    });
});

describe('姜太公 · store 真实链路（踩钩 → 点落点）', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });
    afterEach(() => {
        useGameStore.getState().resetGame();
        vi.restoreAllMocks();
    });

    function loadScene() {
        const state = makeGameState({ currentPlayer: 'player2' });
        const taigong = addHero(state, 'jiangtaigong', 'player1', [2, 2]);
        const victim = addHero(state, 'baize', 'player2', [4, 4]);
        taigong.defense = 0;
        victim.defense = 0;
        placeHook(state, taigong, [3, 4]);
        // 真实施放是"下钩 + 当场铺 3×3 水泽"，这里照做
        placeMarsh(state, taigong, [3, 4]);
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            isAiMode: false,
            moveRange: [],
            skillRange: [],
            suppressOnlineBroadcast: false,
        });
        return { taigong, victim };
    }

    it('敌人走位经过钩子格就当场被钩住，落点高亮是全场空格', () => {
        const { victim } = loadScene();
        const store = useGameStore.getState();
        store.selectHeroForAction(victim);
        store.moveHero([2, 4]);

        const after = useGameStore.getState();
        expect(victim.position).toEqual([2, 4]);
        expect(after.pendingBoardAction).toMatchObject({ type: 'jiangtaigong-hook' });
        const biteMarsh = marshes(after).find(effect => effect.position[0] === 3 && effect.position[1] === 4);
        expect(biteMarsh).toBeDefined();
        // 技能一的水泽是"上钩那一下"以鱼钩为圆心铺的 3×3（不是下钩当场铺）
        expect(marshCells(biteMarsh!)).toHaveLength(9);
        expect(after.highlightedPositions.length).toBeGreaterThan(25);
        expect(after.highlightedPositions.some(([row, col]) => row === 2 && col === 4)).toBe(false);
    });

    it('钩主被冰冻/眩晕时整条不触发：钩子留着，等他能动再咬', () => {
        const { state, taigong } = scene();
        const victim = enemy(state, [4, 4]);
        placeHook(state, taigong, [3, 4]);
        EffectManager.addEffect(taigong, {
            type: 'stun', name: '冰冻', duration: 2, sourceHeroId: 'probe', description: '跳过下一次可行动机会',
        });
        expect(triggerHookBite(state, victim, [3, 4])).toBe(false);
        expect(findHookAt(state, [3, 4])).toBeDefined();
        expect(state.pendingBoardAction).toBeUndefined();

        // 解冻之后同一枚钩子照样咬人
        taigong.effects = taigong.effects.filter(effect => effect.name !== '冰冻');
        expect(triggerHookBite(state, victim, [3, 4])).toBe(true);
        expect(state.pendingBoardAction?.type).toBe('jiangtaigong-hook');
    });

    it('挂起已经挂上、钩主随后被冻住：交接时当场作废，绝不悬在无人可答的回合里', () => {
        const { taigong, victim } = loadScene();
        useGameStore.getState().selectHeroForAction(victim);
        useGameStore.getState().moveHero([2, 4]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('jiangtaigong-hook');

        EffectManager.addEffect(taigong, {
            type: 'stun', name: '冰冻', duration: 2, sourceHeroId: 'probe', description: '跳过下一次可行动机会',
        });
        useGameStore.getState().endHeroAction();

        const after = useGameStore.getState();
        expect(after.pendingBoardAction).toBeUndefined();
        expect(after.battleLog.some(entry => entry.message.includes('这一钩先放过去'))).toBe(true);
        // 作废不等于白送：人留在原地，钩子也确实消耗了
        expect(victim.position).toEqual([2, 4]);
        expect(findHookAt(after, [3, 4])).toBeUndefined();
    });

    it('抛完之后那片 3×3 水泽还在盘上（不会随钩子一起消失）', () => {
        const { taigong, victim } = loadScene();
        useGameStore.getState().selectHeroForAction(victim);
        useGameStore.getState().moveHero([2, 4]);
        useGameStore.getState().resolvePendingBoardAction([0, 0]);

        const after = useGameStore.getState();
        const kept = marshes(after).find(effect => effect.position[0] === 3 && effect.position[1] === 4);
        expect(marshCells(kept!)).toHaveLength(9);
        expect(kept!.duration).toBe(MARSH_DURATION);
        expect(kept!.owner).toBe(taigong.owner);
        expect(victim.position).toEqual([0, 0]);
    });

    it('点一格把人抛过去：换格、掉10血、挂起清掉，且这一手没被误收尾', () => {
        const { taigong, victim } = loadScene();
        const hpBefore = victim.currentHp;
        useGameStore.getState().selectHeroForAction(victim);
        useGameStore.getState().moveHero([2, 4]);
        useGameStore.getState().resolvePendingBoardAction([0, 0]);

        const after = useGameStore.getState();
        expect(victim.position).toEqual([0, 0]);
        expect(victim.currentHp).toBe(hpBefore - 10);
        expect(after.pendingBoardAction).toBeUndefined();
        expect(after.currentPlayer).toBe('player2');
        expect(victim.hasActedThisTurn).toBe(false);
        expect(taigong.position).toEqual([2, 2]);
    });

    it('点有人站的格会被拒；被抛过的人这一回合不能撤回移动', () => {
        const { victim } = loadScene();
        const store = useGameStore.getState();
        store.selectHeroForAction(victim);
        store.moveHero([2, 4]);
        const before = victim.currentHp;
        useGameStore.getState().resolvePendingBoardAction([2, 2]);   // 姜太公自己脚下
        expect(useGameStore.getState().pendingBoardAction).toMatchObject({ type: 'jiangtaigong-hook' });
        expect(victim.currentHp).toBe(before);

        useGameStore.getState().resolvePendingBoardAction([5, 5]);
        expect(victim.position).toEqual([5, 5]);
        expect(hookThrowLocked(victim)).toBe(true);
        useGameStore.getState().selectHeroForAction(victim);
        useGameStore.getState().undoMove();
        expect(victim.position).toEqual([5, 5]);   // 撤回被拒：落点已定
    });
});
