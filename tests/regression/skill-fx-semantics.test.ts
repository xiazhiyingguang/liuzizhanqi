import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, createOnlineStateSnapshot } from '../../src/store/game-store';
import { getSkill } from '../../src/data/skills';
import { drainPendingSkillFxRequests, feixueSkill2 } from '../../src/data/extended-skills';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { SkillSystem } from '../../src/core/skill-system';
import { GameEngine } from '../../src/core/game-engine';
import { computeFxImpactDelayMs, computeFxTravelMs, isDamageFxAt, resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';
import { applySnapshotAction } from '../../src/services/online-state';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { resolveHeroLinks } from '../../src/core/hero-link-view';
import { addHero, makeGameState } from '../helpers/game-state';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';

function cast(state: GameState, hero: Hero, skillId: string, target: Position) {
    useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: false, suppressOnlineBroadcast: false,
        selectedHero: hero, selectedSkill: getSkill(skillId)!, skillFx: [], skillFxExtras: undefined });
    useGameStore.getState().executeSkill(target);
    return useGameStore.getState().skillFx;
}

describe('专属特效的真实结算语义', () => {
    beforeEach(() => {
        drainPendingSkillFxRequests(); useGameStore.getState().resetGame();
        vi.spyOn(Math, 'random').mockReturnValue(.99);
    });
    afterEach(() => { drainPendingSkillFxRequests(); useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

    it('连枝连接友方，追击有独立来源与伤害日志', () => {
        const state = makeGameState();
        const feixue = addHero(state, 'feixue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        const [bond] = cast(state, feixue, 'feixue_skill2', [2, 1]);
        expect(bond.profile.kind).toBe('feixue-bond');
        expect(isDamageFxAt(bond, [2, 1])).toBe(false);
        expect(resolveHeroLinks(useGameStore.getState().board).some(link => link.kind === 'frost')).toBe(true);
        SkillSystem.executeSkill(feixue, feixueSkill2, [[2, 1]], state);
        DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(enemy, DamageCalculator.calculate(ally, enemy, 5, false), ally, state));
        const request = drainPendingSkillFxRequests().find(fx => fx.skillId === 'feixue_followup');
        expect(request).toMatchObject({ sourceHeroId: feixue.id, fromPos: [2, 2], targetPos: [2, 4] });
        expect(request?.logIds?.length).toBeGreaterThan(0);
        expect(state.battleLog.filter(log => request?.logIds?.includes(log.id)).every(log => log.details?.sourceHeroId === feixue.id)).toBe(true);
    });

    it('琵琶音符落在真实受益者格上，不冒充治疗或伤害', () => {
        const state = makeGameState();
        const hero = addHero(state, 'pipa', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        addHero(state, 'huifeng', 'player1', [3, 2]);
        addHero(state, 'baize', 'player2', [5, 5]);
        const notes = cast(state, hero, 'pipa_skill1', ally.position!).find(event => event.profile.kind === 'chord-aura')!;
        expect(notes.impactPositions).toContainEqual([2, 3]);
        expect(notes.impactPositions).toContainEqual([3, 2]);
        expect(notes.damagePositions).toEqual([]);
        expect(notes.areaBounds).toBeUndefined();
    });

    it('帛画第一次开卷，已有金乌时改为本体攻击和独立神兽攻击', () => {
        const state = makeGameState();
        const painter = addHero(state, 't_painting', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        const first = cast(state, painter, 't_painting_skill1', [1, 2]);
        expect(first.at(-1)?.profile.kind).toBe('scroll-jinwu');
        expect(first.at(-1)?.damagePositions).toEqual([]);
        painter.hasActedThisTurn = false;
        const second = cast(useGameStore.getState(), painter, 't_painting_skill1', enemy.position!);
        expect(second.some(event => event.skillId === 'jinwu_skill' && event.sourceHeroId !== painter.id)).toBe(true);
        expect(second.at(-1)?.profile.kind).toBe('pierce');
        expect(second.at(-1)?.damagePositions).toContainEqual([2, 3]);
    });

    it('婉儿方向点击只决定方向，墨痕和爆点使用实际撞击格', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shangguan', 'player1', [2, 1]);
        addHero(state, 'moran', 'player2', [2, 4]);
        const dash = cast(state, hero, 'shangguan_skill2', [2, 2]).at(-1)!;
        expect(dash.profile.kind).toBe('ink-dash');
        expect(dash.fromPos).toEqual([2, 1]);
        expect(dash.targetPos).toEqual([2, 4]);
        expect(dash.coveredPositions).toContainEqual([2, 3]);
    });

    it('戴尔活人回溯与停滞唤回走不同原型', () => {
        const state = makeGameState();
        const dai = addHero(state, 'dai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        addHero(state, 'huifeng', 'player2', [5, 5]);
        ally.currentHp = 10;
        state.heroSnapshots = { [ally.id]: { hp: 30, effects: [] } };
        expect(cast(state, dai, 'dai_skill1', [2, 3]).at(-1)?.profile.kind).toBe('rewind-state');
        ally.state = HeroState.DEAD;
        ally.currentHp = 0;
        ally.counters['__dai_stasis_until'] = 2;
        ally.counters['__dai_hp_before_lethal'] = 10;
        state.board[2][3] = null;
        useGameStore.setState({ ...state, selectedHero: dai, selectedSkill: getSkill('dai_skill1')!,
            daiReviveHeroId: ally.id, skillFx: [], skillFxExtras: undefined });
        useGameStore.getState().executeSkill([3, 3]);
        expect(ally.position).toEqual([3, 3]);
        expect(useGameStore.getState().skillFx.at(-1)?.profile.kind).toBe('revive-rise');
    });

    it('旺财七层通灵独立出场，财神形态攻击带强化标记', () => {
        const state = makeGameState();
        const hero = addHero(state, 'wangcai', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        hero.counters['财气'] = 6;
        const first = cast(state, hero, 'wangcai_skill1', [2, 3]);
        const awaken = first.filter(event => event.profile.kind === 'coin-awaken');
        expect(awaken).toHaveLength(1);
        expect(awaken[0]).toMatchObject({ sourceHeroId: hero.id, fromPos: [2, 2], targetPos: [2, 2], damagePositions: [] });
        expect(first.at(-1)?.empowered).toBe(false);
        enemy.currentHp = enemy.maxHp;
        hero.hasActedThisTurn = false;
        const second = cast(useGameStore.getState(), hero, 'wangcai_skill1', [2, 3]);
        expect(second.at(-1)?.empowered).toBe(true);
        expect(second.some(event => event.profile.kind === 'coin-awaken')).toBe(false);
    });

    it('旺财通灵复活的金印放在实际复活格，不放在被占用的死亡格', () => {
        const state = makeGameState();
        const hero = addHero(state, 'wangcai', 'player1', [2, 2]);
        hero.state = HeroState.DEAD; hero.currentHp = 0; state.board[2][2] = null;
        const blocker = addHero(state, 'moran', 'player2', [2, 2]);
        hero.counters['财气'] = 6;
        GameEngine.transformWangcaiIfReady(hero, state);
        expect(drainPendingSkillFxRequests()).toHaveLength(0);
        hero.counters['财气'] = 7;
        GameEngine.transformWangcaiIfReady(hero, state);
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(hero.currentHp).toBe(hero.maxHp);
        expect(hero.position).not.toEqual([2, 2]);
        expect(state.board[2][2]).toBe(blocker);
        const requests = drainPendingSkillFxRequests();
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ skillId: 'wangcai_awaken', sourceHeroId: hero.id, fromPos: hero.position, targetPos: hero.position, damagePositions: [] });
        expect(requests[0].logIds?.length).toBeGreaterThan(0);
        GameEngine.transformWangcaiIfReady(hero, state);
        expect(drainPendingSkillFxRequests()).toHaveLength(0);
    });

    it('白泽技能二的治疗分支落在实际最低血量友方上', () => {
        const state = makeGameState();
        const hero = addHero(state, 'baize', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        addHero(state, 'huifeng', 'player2', [5, 5]);
        ally.currentHp = 5;
        const fx = cast(state, hero, 'baize_skill2', [2, 2]).at(-1)!;
        expect(fx.profile.kind).toBe('heal-single');
        expect(fx.targetPos).toEqual([2, 3]);
        expect(fx.damagePositions).toEqual([]);
    });

    it('联机读取分支元数据，帛画攻击不重播召唤画卷', () => {
        const state = makeGameState();
        const hero = addHero(state, 't_painting', 'player1', [2, 1]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        useGameStore.setState(state);
        const snapshot = createOnlineStateSnapshot(useGameStore.getState());
        snapshot.skillFxExtras = { fxVariant: 'painting_attack', targetPos: [2, 3] };
        snapshot.battleLog = [{ id: 'remote-hit', timestamp: 1, type: 'damage', player: 'player1', message: '命中',
            details: { sourceHeroId: hero.id, targetHeroId: enemy.id, amount: 6, position: [2, 3] } }];
        applySnapshotAction({ type: 'skill', data: { heroId: hero.id, skillId: 't_painting_skill1', targetPos: [2, 2] } }, snapshot);
        const fx = useGameStore.getState().skillFx.at(-1)!;
        expect(fx.profile.kind).toBe('pierce');
        expect(fx.targetPos).toEqual([2, 3]);
        expect(fx.logIds).toContain('remote-hit');
        expect(isDamageFxAt(fx, [2, 3])).toBe(true);
        expect(useGameStore.getState().skillFxExtras).toBeUndefined();
    });

    it('联机快照中的独立追击只派发一次并保留来源', () => {
        const state = makeGameState();
        const caster = addHero(state, 'moran', 'player1', [2, 1]);
        const feixue = addHero(state, 'feixue', 'player1', [1, 2]);
        addHero(state, 'huifeng', 'player2', [2, 3]);
        useGameStore.setState(state);
        const snapshot = createOnlineStateSnapshot(useGameStore.getState());
        snapshot.battleLog = [{ id: 'remote-followup', timestamp: 1, type: 'damage', player: 'player1', message: '追击',
            details: { sourceHeroId: feixue.id, amount: 6, position: [2, 3], skillFxRequest: {
                skillId: 'feixue_followup', sourceHeroId: feixue.id, owner: 'player1', fromPos: [1, 2], targetPos: [2, 3],
                impactPositions: [[2, 3]], damagePositions: [[2, 3]], logIds: ['remote-followup'],
            } } }];
        applySnapshotAction({ type: 'skill', data: { heroId: caster.id, skillId: 'moran_skill2', targetPos: [2, 3] } }, snapshot);
        const effects = useGameStore.getState().skillFx;
        expect(effects.filter(fx => fx.skillId === 'feixue_followup')).toHaveLength(1);
        expect(effects.find(fx => fx.skillId === 'feixue_followup')?.sourceHeroId).toBe(feixue.id);
        expect(effects.at(-1)?.damagePositions).toEqual([]);
    });

    it('回合结束的补段也能从联机快照重建，不依赖主动施法 action', () => {
        const state = makeGameState();
        const keeper = addHero(state, 'xubai', 'player1', [2, 1]);
        const ally = addHero(state, 'moran', 'player1', [2, 2]);
        useGameStore.setState(state);
        const snapshot = createOnlineStateSnapshot(useGameStore.getState());
        snapshot.battleLog = [{ id: 'remote-regen', timestamp: 1, type: 'heal', player: 'player1', message: '回血',
            details: { sourceHeroId: keeper.id, amount: 4, position: [2, 2], skillFxRequest: {
                skillId: 'xubai_regen', sourceHeroId: keeper.id, owner: 'player1', fromPos: [2, 1], targetPos: ally.position,
                impactPositions: [[2, 2]], softImpactPositions: [[2, 2]], damagePositions: [], logIds: ['remote-regen'],
            } } }];
        applySnapshotAction({ type: 'end-turn', data: { heroId: ally.id } }, snapshot);
        expect(useGameStore.getState().skillFx).toHaveLength(1);
        expect(useGameStore.getState().skillFx[0]).toMatchObject({ skillId: 'xubai_regen', damagePositions: [], logIds: ['remote-regen'] });
        applySnapshotAction({ type: 'end-turn', data: { heroId: ally.id } }, snapshot);
        expect(useGameStore.getState().skillFx).toHaveLength(1);
    });
});

describe('命中节奏与图鉴几何', () => {
    function event(skillId: string): SkillFxEvent {
        return { id: 1, bornAt: 0, owner: 'player1', profile: resolveSkillFx(skillId), fromPos: [2, 0], targetPos: [2, 4], angleDeg: 0, direction: 'E' };
    }
    it('投射物命中在飞行之后，远距离不会先爆点', () => {
        const fx = event('bounty_skill2');
        expect(computeFxImpactDelayMs(fx, fx.targetPos)).toBe(90 + computeFxTravelMs(fx));
        const near = { ...fx, targetPos: [2, 1] as Position };
        expect(computeFxImpactDelayMs(fx, fx.targetPos)).toBeGreaterThan(computeFxImpactDelayMs(near, near.targetPos));
    });
    it('折线和醉枕路径末端按行程递增，不能按直线距离倒放', () => {
        const coveredPositions: Position[] = [[2, 1], [3, 1], [3, 2], [2, 2]];
        const prism = { ...event('zhiguang_skill2'), coveredPositions };
        expect(coveredPositions.map(pos => computeFxImpactDelayMs(prism, pos))).toEqual([70, 140, 210, 280]);
        const blade = { ...prism, profile: resolveSkillFx('zuizhendao_skill1') };
        expect(computeFxImpactDelayMs(blade, [2, 2])).toBe(120 + 5 * 130);
    });
    it('治疗不抖动；同格受伤又回血仍保留受击', () => {
        const fx = { ...event('bounty_skill1'), softImpactPositions: [[2, 4]] as Position[], damagePositions: [] as Position[] };
        expect(isDamageFxAt(fx, [2, 4])).toBe(false);
        fx.damagePositions = [[2, 4]];
        expect(isDamageFxAt(fx, [2, 4])).toBe(true);
    });
    it('完整预览包含折线区域，钱币攻击和冰晶在施法者之外', () => {
        const prism = buildSkillPreviewScene('zhiguang_skill2');
        expect(prism.cols).toBe(6);
        expect(prism.event.areaBounds).toBeDefined();
        expect(new Set(prism.event.coveredPositions?.map(pos => pos[0])).size).toBeGreaterThan(1);
        for (const id of ['wangcai_skill1', 'hanjiangxue_skill2']) {
            const scene = buildSkillPreviewScene(id);
            expect(scene.event.targetPos).not.toEqual(scene.event.fromPos);
        }
    });
});
