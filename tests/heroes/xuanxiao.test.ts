import { afterEach, describe, expect, it } from 'vitest';
import { MovementSystem } from '../../src/core/movement-system';
import { chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { SkillSystem } from '../../src/core/skill-system';
import { triggerXuanxiaoEntrance } from '../../src/core/xuanxiao';
import { createHero } from '../../src/data/heroes';
import { getSkill, xuanxiaoSkill2 } from '../../src/data/skills';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { applyServerGameState } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(() => useGameStore.getState().resetGame());

function setupLineups() {
    useGameStore.getState().resetGame();
    useGameStore.getState().initGame();
    const selected = ['xuanxiao', 'moran', 'zhenxiao', 'huifeng', 'liuli', 'baize'];
    for (const player of ['player1', 'player2'] as const) {
        for (const id of selected) expect(useGameStore.getState().selectHeroForPlayer(player, id)).toBe(true);
        expect(useGameStore.getState().confirmHeroSelectionForPlayer(player)).toBe(true);
    }
    for (const [index, id] of selected.slice(0, 4).entries()) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', id, [index, 1])).toBe(true);
        expect(useGameStore.getState().deployHeroForPlayer('player2', id, [index, 4])).toBe(true);
    }
}

describe('玄霄新版神威与再动射程', () => {
    it('面板为55生命、基础移动2，图鉴标明是登场触发而非击杀', () => {
        const hero = createHero('xuanxiao', 'player1');
        const codex = HERO_CODEX.find(entry => entry.id === 'xuanxiao');
        expect(hero).toMatchObject({ maxHp: 55, currentHp: 55, moveRange: 2 });
        expect(hero.tianweiId).toBeUndefined();
        expect(codex).toMatchObject({ maxHp: 55, moveRange: 2, tianwei: { name: '神威', triggerLabel: '首次登场触发' } });
    });

    it('双方首发都只在开战时生效，场上队友与玄霄自身各加1，后来补员不继承', () => {
        setupLineups();
        const before = [...useGameStore.getState().player1Heroes, ...useGameStore.getState().player2Heroes]
            .map(hero => ({ hero, baseMove: hero.moveRange }));
        expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
        expect(before[0].hero.moveRange).toBe(2);
        expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);
        expect(useGameStore.getState().xuanxiaoEntranceTriggered).toEqual({ player1: true, player2: true });
        for (const { hero, baseMove } of before) expect(hero.moveRange).toBe(baseMove + 1);
        const leaving = before[1].hero;
        const state = useGameStore.getState();
        state.board[leaving.position![0]][leaving.position![1]] = null;
        leaving.state = HeroState.DEAD; leaving.position = null;
        useGameStore.setState({ reinforcingPlayer: 'player1' });
        expect(useGameStore.getState().selectReinforcementHero('liuli')).toBe(true);
        expect(useGameStore.getState().deployReinforcement([1, 1])).toBe(true);
        expect(useGameStore.getState().board[1][1]?.moveRange).toBe(createHero('liuli', 'player1').moveRange);
        expect(useGameStore.getState().battleLog.filter(log => log.message.includes('触发「神威」'))).toHaveLength(2);
    });

    it('玄霄作为替补首次登场也生效；阵亡、暂离、敌人与临时召唤物不加成', () => {
        const state = makeGameState({ reinforcingPlayer: 'player1', player1BenchHeroIds: ['xuanxiao'] });
        const ally = addHero(state, 'moran', 'player1', [0, 1]);
        const foe = addHero(state, 'huifeng', 'player2', [3, 4]);
        const offboard = addHero(state, 'jinghua', 'player1', [2, 1]);
        state.board[2][1] = null; offboard.state = HeroState.TEMP_DEAD; offboard.position = null;
        const dead = addHero(state, 'zhenxiao', 'player1', [2, 0]);
        state.board[2][0] = null; dead.state = HeroState.DEAD; dead.position = null;
        const summon = addHero(state, 'wukong', 'player1', [3, 0]); summon.counters.__isSummon = 1;
        const [allyMove, foeMove, offMove, deadMove, summonMove] = [ally, foe, offboard, dead, summon].map(hero => hero.moveRange);
        useGameStore.setState(state);
        expect(useGameStore.getState().selectReinforcementHero('xuanxiao')).toBe(true);
        expect(useGameStore.getState().deployReinforcement([0, 2])).toBe(true);
        const result = useGameStore.getState();
        expect(result.board[0][2]?.moveRange).toBe(3);
        expect([ally, foe, offboard, dead, summon].map(hero => hero.moveRange)).toEqual([allyMove + 1, foeMove, offMove, deadMove, summonMove]);
        expect(result.battleLog.some(log => log.message.includes('触发「神威」'))).toBe(true);
    });

    it('神威标记和移动力通过联机快照保存，重建同一方玄霄也不会再加', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [3, 2]);
        triggerXuanxiaoEntrance(hero, state);
        useGameStore.setState(state);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        const restored = useGameStore.getState();
        const rebuilt = addHero(restored, 'xuanxiao', 'player1', [1, 2]);
        triggerXuanxiaoEntrance(rebuilt, restored);
        expect(restored.xuanxiaoEntranceTriggered).toEqual({ player1: true });
        expect(restored.board[3][2]?.moveRange).toBe(ally.moveRange);
        expect(rebuilt.moveRange).toBe(2);
        expect(restored.battleLog.filter(log => log.message.includes('触发「神威」'))).toHaveLength(1);
    });

    it('镜花从候补席带玄霄上场也算首次登场；已退入月座的镜花不加成', () => {
        const state = makeGameState({ player1BenchHeroIds: ['xuanxiao'] });
        const jinghua = addHero(state, 'jinghua', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [3, 1]);
        const [jinghuaMove, allyMove] = [jinghua.moveRange, ally.moveRange];
        jinghua.counters.__jinghua_summon_pick = 0;
        const skill = getSkill('jinghua_skill2')!;
        expect(SkillSystem.executeSkill(jinghua, skill, [[2, 3]], state).success).toBe(true);
        expect(jinghua.state).toBe(HeroState.TEMP_DEAD);
        expect([jinghua.moveRange, ally.moveRange, state.board[2][3]?.moveRange]).toEqual([jinghuaMove, allyMove + 1, 3]);
        expect(state.xuanxiaoEntranceTriggered).toEqual({ player1: true });
    });

    it('再动能选斜向两格内的队友，三格外无效；合法目标依然获得移动和施法', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [4, 4]);
        const far = addHero(state, 'feixue', 'player1', [5, 2]);
        addHero(state, 'huifeng', 'player2', [5, 5]);
        ally.hasActedThisTurn = true; ally.hasMovedThisTurn = true;
        expect(SkillSystem.getValidTargetPositions(hero, xuanxiaoSkill2, state)).toContainEqual(ally.position);
        expect(SkillSystem.getValidTargetPositions(hero, xuanxiaoSkill2, state)).not.toContainEqual(far.position);
        expect(SkillSystem.executeSkill(hero, xuanxiaoSkill2, [far.position!], state).success).toBe(false);
        expect(chooseComputerSkillPlan(state, hero, xuanxiaoSkill2.id)?.targetPositions).toEqual([ally.position]);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero });
        useGameStore.getState().selectSkill(xuanxiaoSkill2.id);
        useGameStore.getState().executeSkill(ally.position!);
        const result = useGameStore.getState();
        expect(result.activeHero?.id).toBe(ally.id);
        expect(result.performingExtraAction).toBe(true);
        expect([ally.hasMovedThisTurn, ally.hasActedThisTurn]).toEqual([false, false]);
        expect(MovementSystem.getMovablePositions(ally, result).length).toBeGreaterThan(0);
        expect(result.actionsThisTurn).toBe(1);
    });
});
