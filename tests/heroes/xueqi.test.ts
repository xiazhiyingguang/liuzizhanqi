import { afterEach, describe, expect, it } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { MovementSystem } from '../../src/core/movement-system';
import { resolveHeroStatusFx } from '../../src/core/hero-status-fx';
import { resolveHeroLinks } from '../../src/core/hero-link-view';
import { SkillSystem } from '../../src/core/skill-system';
import { applyRage, getRageBinder } from '../../src/core/taunt';
import { syncPositionAnchoredEffects } from '../../src/data/extended-heroes';
import { useGameStore } from '../../src/store/game-store';
import { xueqiSkill1, xueqiSkill2 } from '../../src/data/extended-skills';
import { SKILLS } from '../../src/data/skills';
import type { GameState, Skill } from '../../src/types/game';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 血契：周身横扫续航 + 愤怒强锁 + 残血减伤 + 任意格天威。
 *
 * 愤怒是本作新增的"强制攻击目标"通道，收口在 SkillSystem.getValidTargetPositions，
 * 所以这里既测收窄规则，也测"打不到时绝不产生无合法动作"这条死锁底线。
 */

/** 点一格、以施法者为中心铺开 3×3 的全体技（检验"作用区必须罩住绑缚者"） */
const selfCenteredAoe: Skill = {
    id: 'test_self_aoe',
    name: '测试全体',
    type: 'damage',
    description: '测试用',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 'all',
};

/** 射程 3 的单体攻击技（检验"只能指向绑缚者"） */
const rangedSingle: Skill = {
    id: 'test_single',
    name: '测试单体',
    type: 'damage',
    description: '测试用',
    rangeType: 'single',
    range: 3,
    targetType: 'enemy',
    targetCount: 1,
};

function loadIntoStore(state: GameState) {
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        wukongSkill2State: undefined,
        libaiChainState: undefined,
        pendingBoardAction: undefined,
        suppressOnlineBroadcast: false,
    });
}

describe('血契技能1 · 血誓横扫', () => {
    it('对周身 3×3 内每名敌人造成 4 点伤害，并按已损生命 20% 回血', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const near = addHero(state, 'moran', 'player2', [2, 3]);
        const diagonal = addHero(state, 'baize', 'player2', [1, 1]);
        const far = addHero(state, 'changli', 'player2', [2, 5]);
        zui.currentHp = 38;   // 已损 20 → 应回 4

        const result = SkillSystem.executeSkill(zui, xueqiSkill1, [near.position!], state);

        expect(result.success).toBe(true);
        expect(near.currentHp).toBe(near.maxHp - 4);
        expect(diagonal.currentHp).toBe(diagonal.maxHp - 4);
        expect(far.currentHp, '周身一格以外的敌人不该被扫到').toBe(far.maxHp);
        expect(zui.currentHp).toBe(42);
    });

    it('满血时横扫不回血，日志也不虚报治疗', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const near = addHero(state, 'moran', 'player2', [2, 3]);

        const result = SkillSystem.executeSkill(zui, xueqiSkill1, [near.position!], state);

        expect(result.healingDone ?? [], '满血不该产生治疗').toHaveLength(0);
        expect(result.log.join()).not.toContain('以血还血');
    });
});

describe('血契技能2 · 血契锁', () => {
    it('强锁周身一格内的敌人：施加愤怒并铺下以血契为中心的 3×3 束缚格', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);

        const result = SkillSystem.executeSkill(zui, xueqiSkill2, [victim.position!], state);

        expect(result.success).toBe(true);
        expect(getRageBinder(victim, state)?.id, '被锁者应认出血契是绑缚者').toBe(zui.id);
        const zone = (state.boardEffects ?? []).filter(effect =>
            effect.type === 'binding-zone' && effect.sourceHeroId === zui.id);
        expect(zone, '束缚格应为血契周身 3×3 共 9 格').toHaveLength(9);
        expect(zone.every(effect => effect.owner === 'player1')).toBe(true);
        expect(resolveHeroStatusFx(victim), '被锁者棋子上应有愤怒徽标').toContain('rage');

        const links = resolveHeroLinks(state.board).filter(link => link.kind === 'rage');
        expect(links, '血契与被锁者之间应有一条血线').toHaveLength(1);
        expect(links[0].from, '线从血契格心出发').toEqual([2, 2]);
        expect(links[0].to, '线连到被锁者格心').toEqual([2, 3]);
        expect(links[0].length, '相邻连线长度为 1 格').toBeCloseTo(1);
    });

    it('只能强锁周身一格内的敌人', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const far = addHero(state, 'moran', 'player2', [2, 5]);

        const result = SkillSystem.executeSkill(zui, xueqiSkill2, [far.position!], state);

        expect(result.success).toBe(false);
        expect(EffectManager.hasEffect(far, '愤怒')).toBe(false);
    });

    it('被锁者出不了血契周身一格，友方却自由来去', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        SkillSystem.executeSkill(zui, xueqiSkill2, [victim.position!], state);

        const reachable = MovementSystem.getMovablePositions(victim, state);
        expect(reachable.length, '束缚格内仍有可走位置').toBeGreaterThan(0);
        expect(reachable.every(([row, col]) =>
            Math.abs(row - 2) <= 1 && Math.abs(col - 2) <= 1), '落点不得越出血契周身一格')
            .toBe(true);
    });

    it('血契被强行移位后，束缚圈跟着本体重铺而不是留在旧位置', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        SkillSystem.executeSkill(zui, xueqiSkill2, [victim.position!], state);

        // 模拟一次强制位移：血契被推到 (4,4)，棋盘与 position 都已同步
        state.board[2][2] = null;
        state.board[4][4] = zui;
        zui.position = [4, 4];

        expect(syncPositionAnchoredEffects(state), '圈应当被重铺').toBe(true);

        const zone = (state.boardEffects ?? []).filter(effect =>
            effect.type === 'binding-zone' && effect.sourceHeroId === zui.id);
        expect(zone, '圈仍是完整 3×3').toHaveLength(9);
        expect(zone.every(effect =>
            Math.abs(effect.position[0] - 4) <= 1 && Math.abs(effect.position[1] - 4) <= 1),
            '每一格都必须贴着血契的新位置')
            .toBe(true);
        expect(zone.filter(effect => effect.position[0] === 2 && effect.position[1] === 2), '旧圈不得残留')
            .toHaveLength(0);
        expect(new Set(zone.map(effect => effect.id)).size, '重建后的格子 id 不能撞车').toBe(zone.length);
    });

    it('圈随血契走后，落在旧圈里的敌人不再被限制', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        SkillSystem.executeSkill(zui, xueqiSkill2, [victim.position!], state);

        state.board[2][2] = null;
        state.board[4][4] = zui;
        zui.position = [4, 4];
        syncPositionAnchoredEffects(state);

        const reachable = MovementSystem.getMovablePositions(victim, state);
        expect(reachable.some(([row, col]) => row < 1 || col > 3), '旧圈已跟着血契移走，被锁者可自由走位')
            .toBe(true);
    });
});

describe('愤怒（嘲讽）的目标收窄', () => {
    it('单体攻击技的合法目标被收窄为绑缚者所在格', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const locked = addHero(state, 'mirror', 'player2', [3, 4]);
        addHero(state, 'baize', 'player2', [3, 3]);
        applyRage(locked, zui, 99);

        const positions = SkillSystem.getValidTargetPositions(locked, rangedSingle, state);

        expect(positions, '血契在射程内时只能点他').toEqual([[2, 2]]);
    });

    it('全体技必须罩住绑缚者才允许释放', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const locked = addHero(state, 'mirror', 'player2', [2, 3]);
        // 被锁者身边再放一个敌方单位：证明"能不能放"只取决于罩不罩得住血契
        addHero(state, 'liuli', 'player1', [0, 3]);
        applyRage(locked, zui, 99);

        expect(SkillSystem.canUseSkill(locked, selfCenteredAoe, state), '作用区罩得住血契').toBe(true);

        state.board[2][2] = null;
        zui.position = [5, 0];
        state.board[5][0] = zui;

        expect(SkillSystem.canUseSkill(locked, selfCenteredAoe, state), '血契已移出作用区').toBe(false);
        const blocked = SkillSystem.executeSkill(locked, selfCenteredAoe, [[2, 2]], state);
        expect(blocked.success, '绕过界面直接调用也要被拦下').toBe(false);
    });

    it('打不到血契时被锁者仍可移动并结束行动，不产生无合法动作', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [0, 0]);
        const locked = addHero(state, 'mirror', 'player2', [5, 5]);
        applyRage(locked, zui, 99);

        expect(SkillSystem.getValidTargetPositions(locked, rangedSingle, state)).toHaveLength(0);
        expect(SkillSystem.canUseSkill(locked, rangedSingle, state)).toBe(false);
        expect(MovementSystem.getMovablePositions(locked, state).length, '仍可正常移动')
            .toBeGreaterThan(0);
    });

    it('绑缚者阵亡后限制自动解除', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const locked = addHero(state, 'mirror', 'player2', [2, 3]);
        applyRage(locked, zui, 99);
        expect(SkillSystem.getValidTargetPositions(locked, rangedSingle, state)).toEqual([[2, 2]]);

        zui.currentHp = 0;
        zui.state = HeroState.DEAD;
        state.board[2][2] = null;

        expect(getRageBinder(locked, state)).toBeNull();
        expect(resolveHeroLinks(state.board).filter(link => link.kind === 'rage'))
            .toHaveLength(0);
        expect(SkillSystem.getValidTargetPositions(locked, rangedSingle, state).length)
            .toBeGreaterThan(1);
    });

    it('治疗与增益类技能不受嘲讽支配', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const locked = addHero(state, 'mirror', 'player2', [2, 3]);
        addHero(state, 'guying', 'player2', [0, 0]);
        applyRage(locked, zui, 99);
        const healSkill = SKILLS.mirror_skill1 ?? SKILLS.xubai_skill1;
        const allySkill: Skill = { ...healSkill, targetType: 'ally' };

        expect(SkillSystem.getValidTargetPositions(locked, allySkill, state).length)
            .toBeGreaterThan(1);
    });
});

describe('血契被动 · 血契不灭', () => {
    it('每损失 2% 生命提升 1% 防御，残血时挨得更轻', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const attacker = addHero(state, 'moran', 'player2', [2, 3]);
        void state;

        zui.currentHp = zui.maxHp;
        const fullHpDamage = DamageCalculator.calculate(attacker, zui, 20).finalDamage;

        zui.currentHp = Math.floor(zui.maxHp / 2);
        const halfHpDamage = DamageCalculator.calculate(attacker, zui, 20).finalDamage;

        expect(halfHpDamage, '半血应多出约 25% 减免').toBeLessThan(fullHpDamage);
        expect(fullHpDamage - halfHpDamage).toBeGreaterThanOrEqual(4);
    });
});

describe('血契天威 · 血誓不熄', () => {
    afterEach(() => useGameStore.getState().resetGame());

    it('击杀后玩家选空格，血契先跃过去再就地横扫并锁住命中敌人', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        const farA = addHero(state, 'baize', 'player2', [0, 4]);
        const farB = addHero(state, 'changli', 'player2', [1, 5]);
        loadIntoStore(state);

        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.selectSkill('xueqi_skill1');
        store.executeSkill([2, 3]);

        expect(victim.state, '横扫应收下残血的人头').toBe(HeroState.DEAD);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('xueqi-tianwei');
        expect(useGameStore.getState().highlightedPositions, '应高亮全盘供选格')
            .toHaveLength(36);

        useGameStore.getState().resolvePendingBoardAction([0, 5]);

        const after = useGameStore.getState();
        expect(after.pendingBoardAction).toBeUndefined();
        expect(zui.position, '天威是先移动再攻击：人应落在所选空格').toEqual([0, 5]);
        expect(after.board[2][2], '原本站立的格子应空出来').toBeNull();
        expect(after.board[0][5]?.id).toBe(zui.id);
        expect(farA.currentHp).toBe(farA.maxHp - 4);
        expect(farB.currentHp).toBe(farB.maxHp - 4);
        expect(getRageBinder(farA, after as unknown as GameState)?.id).toBe(zui.id);
        expect(getRageBinder(farB, after as unknown as GameState)?.id).toBe(zui.id);
        expect(
            (after.boardEffects ?? []).filter(effect => effect.type === 'binding-zone'),
            '天威只施加愤怒，不该带出技能二的束缚格'
        ).toHaveLength(0);
        expect(after.battleLog.some(entry => entry.message.includes('循血而起')), '战报应写明跃至落点')
            .toBe(true);
    });

    it('天威落点被人占着时拒绝，并把挂起态留给玩家重选', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        const blocker = addHero(state, 'baize', 'player2', [0, 4]);
        loadIntoStore(state);

        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.selectSkill('xueqi_skill1');
        store.executeSkill([2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('xueqi-tianwei');

        useGameStore.getState().resolvePendingBoardAction([0, 4]);

        const after = useGameStore.getState();
        expect(after.pendingBoardAction, '非法落点不该吃掉天威').toMatchObject({ type: 'xueqi-tianwei' });
        expect(zui.position, '不该发生位移').toEqual([2, 2]);
        expect(blocker.currentHp, '不该发生横扫结算').toBe(blocker.maxHp);
        expect(after.battleLog.some(entry => entry.message === '血契只能跃向空格')).toBe(true);

        useGameStore.getState().resolvePendingBoardAction([0, 5]);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(zui.position).toEqual([0, 5]);
        expect(blocker.currentHp).toBe(blocker.maxHp - 4);
    });

    it('天威每轮最多一次，第二次击杀不再挂起选格', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const first = addHero(state, 'moran', 'player2', [2, 3]);
        first.currentHp = 1;
        loadIntoStore(state);

        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.selectSkill('xueqi_skill1');
        store.executeSkill([2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('xueqi-tianwei');

        useGameStore.getState().resolvePendingBoardAction([4, 4]);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();

        // 同一轮内再送一个人头给血契
        const living = useGameStore.getState() as unknown as GameState;
        const second = addHero(living, 'baize', 'player2', [2, 3]);
        second.currentHp = 1;
        const damage = DamageCalculator.calculate(zui, second, 30);
        DamageCalculator.applyDamage(second, damage, zui, living);

        expect(second.state).toBe(HeroState.DEAD);
        expect(useGameStore.getState().pendingBoardAction, '本轮已用过天威').toBeUndefined();
    });

    it('联机下对手不能替血契所属方点这个天威格', () => {
        const state = makeGameState();
        const zui = addHero(state, 'xueqi', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        const bystander = addHero(state, 'baize', 'player2', [0, 4]);
        loadIntoStore(state);
        // 血契方（玩家1）本地出手，先拿到挂起选格
        useGameStore.setState({ isOnlineMode: true, localPlayerNumber: 1, currentPlayer: 'player1' });
        const hpBefore = bystander.currentHp;

        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.selectSkill('xueqi_skill1');
        store.executeSkill([2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('xueqi-tianwei');

        // 同一份挂起态随权威快照到了对手端：对手点格必须被拒
        useGameStore.setState({ localPlayerNumber: 2 });
        useGameStore.getState().resolvePendingBoardAction([0, 5]);

        const after = useGameStore.getState();
        expect(after.pendingBoardAction, '越权点击不应吃掉挂起态').toMatchObject({ type: 'xueqi-tianwei' });
        expect(after.battleLog.some(entry => entry.message === '当前无法操作'), '应给出无法操作的提示')
            .toBe(true);
        expect(bystander.currentHp, '对手不能替我们造成伤害').toBe(hpBefore);

        // 回到所属方手里则正常结算
        useGameStore.setState({ localPlayerNumber: 1 });
        useGameStore.getState().resolvePendingBoardAction([0, 5]);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(bystander.currentHp).toBe(hpBefore - 4);
    });
});

describe('血契接入完整性', () => {
    afterEach(() => useGameStore.getState().resetGame());

    it('两个技能都登记进技能表，几何元数据可供特效层推导作用区', () => {
        expect(SKILLS.xueqi_skill1).toBe(xueqiSkill1);
        expect(SKILLS.xueqi_skill2).toBe(xueqiSkill2);
        expect(xueqiSkill1.targetCount).toBe('all');
        expect(xueqiSkill1.areaSize).toBe(3);
        expect(xueqiSkill2.rangeType).toBe('area');
    });
});
