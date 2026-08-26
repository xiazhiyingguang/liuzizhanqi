import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/game-engine';
import { useGameStore } from '../../src/store/game-store';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { normalizeGameState } from '../../src/services/online-state';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('暂时阵亡体系回归', () => {
    it('本回合已出手的英雄复活后不刷新出手机会（防无限出手）', () => {
        const state = makeGameState();
        const hero = addHero(state, 'libai', 'player1', [2, 2]);
        hero.hasActedThisTurn = true;
        hero.hasMovedThisTurn = true;
        GameEngine.tempDeath(hero, state);
        expect(hero.state).toBe(HeroState.TEMP_DEAD);

        const revived = GameEngine.resurrectHero(hero, 0.5, state);
        expect(revived).toBe(true);
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(hero.hasActedThisTurn, '已出手的英雄复活后不得再次行动').toBe(true);
        expect(hero.hasMovedThisTurn).toBe(true);
    });

    it('本回合未出手的英雄复活后仍可行动', () => {
        const state = makeGameState();
        const hero = addHero(state, 'libai', 'player1', [2, 2]);
        hero.hasActedThisTurn = false;
        GameEngine.tempDeath(hero, state);

        expect(GameEngine.resurrectHero(hero, 0.5, state)).toBe(true);
        expect(hero.hasActedThisTurn).toBe(false);
    });

    it('复活位置被占据时在周围一格内随机选择空位', () => {
        const state = makeGameState();
        const hero = addHero(state, 'libai', 'player1', [2, 2]);
        GameEngine.tempDeath(hero, state);
        // 原位置被友方占据
        addHero(state, 'moran', 'player1', [2, 2]);

        expect(GameEngine.resurrectHero(hero, 0.5, state)).toBe(true);
        expect(hero.state).toBe(HeroState.ALIVE);
        const [r, c] = hero.position!;
        const adjacent = Math.max(Math.abs(r - 2), Math.abs(c - 2)) === 1;
        expect(adjacent, `复活位置 [${r},${c}] 应在原位置 [2,2] 周围一格内`).toBe(true);
        expect(state.board[r][c]).toBe(hero);
        expect(state.board[2][2]?.id.startsWith('moran')).toBe(true);
    });

    it('周围一圈全被占据时回退到最近空位复活', () => {
        const state = makeGameState();
        const hero = addHero(state, 'libai', 'player1', [0, 0]);
        GameEngine.tempDeath(hero, state);
        addHero(state, 'moran', 'player1', [0, 0]);
        // 堵死 [0,0] 周围一圈：用敌方单位，避免己方场上存活达到 4 人编制上限
        addHero(state, 'zhenxiao', 'player2', [0, 1]);
        addHero(state, 'huifeng', 'player2', [1, 0]);
        addHero(state, 'baize', 'player2', [1, 1]);

        expect(GameEngine.resurrectHero(hero, 0.5, state)).toBe(true);
        expect(hero.state).toBe(HeroState.ALIVE);
        const [r, c] = hero.position!;
        expect(state.board[r][c]).toBe(hero);
        // 回退位置不能落在被堵死的原位与周围一圈
        const blocked: Array<[number, number]> = [[0, 0], [0, 1], [1, 0], [1, 1]];
        expect(
            blocked.some(([br, bc]) => br === r && bc === c),
            `复活位置 [${r},${c}] 不应在被占据的格子内`
        ).toBe(false);
    });
});

describe('联机快照归一化：暂时阵亡诈尸', () => {
    it('对手快照中 state=temp_dead 的棋盘格应被清空', () => {
        const state = makeGameState();
        const tempDead = addHero(state, 'soul_lamp', 'player2', [2, 4]);
        tempDead.state = HeroState.TEMP_DEAD;
        tempDead.currentHp = 0;
        state.board[2][4] = null; // 暂时阵亡离场

        const snapshot = JSON.parse(JSON.stringify({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes
        }));

        const normalized = normalizeGameState(snapshot);
        expect(normalized.board[2][4], '暂时阵亡英雄不得按旧 position 回填棋盘').toBeNull();
    });

    it('棋盘格上的 temp_dead 单位应被清除，alive 单位保留', () => {
        const state = makeGameState();
        const alive = addHero(state, 'moran', 'player1', [1, 1]);
        const tempDeadOnBoard = addHero(state, 'soul_lamp', 'player2', [3, 3]);
        tempDeadOnBoard.state = HeroState.TEMP_DEAD;
        tempDeadOnBoard.currentHp = 0;

        const snapshot = JSON.parse(JSON.stringify({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes
        }));

        const normalized = normalizeGameState(snapshot);
        expect(normalized.board[1][1]?.id).toBe(alive.id);
        expect(normalized.board[3][3], '棋盘上的 temp_dead 单位应清空').toBeNull();
    });
});

describe('醉枕刀技能1 AI 方向选择', () => {
    function setupAiBattle(): { zui: ReturnType<typeof addHero>; victim: ReturnType<typeof addHero> } {
        useGameStore.getState().resetGame();
        useGameStore.setState({ isAiMode: true, aiPlayer: 'player2', isOnlineMode: false, aiDifficulty: 'master' });
        useGameStore.getState().initGame();
        for (const heroId of ['feixue', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
            expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
        }
        for (const heroId of ['zuizhendao', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
            expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
        }
        expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
        expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);
        for (const [heroId, pos] of [
            ['feixue', [2, 0]],
            ['moran', [1, 0]],
            ['zhenxiao', [3, 0]],
            ['huifeng', [4, 1]],
        ] as Array<[string, [number, number]]>) {
            expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
        }
        // AI 醉枕刀 [2,5]；玩家英雄 [4,3] 在其斜下方——不在任何直线上，
        // 但掷刀向下后 7 步路径可以绕过去踩到
        for (const [heroId, pos] of [
            ['zuizhendao', [2, 5]],
            ['moran', [0, 5]],
            ['zhenxiao', [0, 4]],
            ['huifeng', [1, 4]],
        ] as Array<[string, [number, number]]>) {
            expect(useGameStore.getState().deployHeroForPlayer('player2', heroId, pos)).toBe(true);
        }
        expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
        expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);

        const zui = [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('zuizhendao-player2-'))!;
        const victim = [...useGameStore.getState().player1Heroes].find(h => h.id.startsWith('feixue-player1-'))!;
        return { zui, victim };
    }

    /** 让玩家方空过本回合行动，把回合交给 AI（player2） */
    function passPlayer1Turn(): void {
        for (const hero of [...useGameStore.getState().player1Heroes]) {
            if (hero.state === 'alive' && !hero.hasActedThisTurn) {
                useGameStore.getState().selectHeroForAction(hero);
                useGameStore.getState().endHeroAction();
            }
        }
        expect(useGameStore.getState().currentPlayer).toBe('player2');
    }

    it('斜向敌人也应被掷刀路径覆盖（按真实路径评估方向）', () => {
        const { zui, victim } = setupAiBattle();
        const hpBefore = victim.currentHp;

        // 醉枕刀在 [2,5]，把 feixue 移到 [4,3]（斜向）：任何直线上都没有敌人，
        // 但掷刀向下/向左后 7 步绕路路径可以踩到
        const s = useGameStore.getState();
        s.board[2][0] = null;
        victim.position = [4, 3];
        s.board[4][3] = victim;

        passPlayer1Turn();
        useGameStore.getState().selectHeroForAction(zui);
        useGameStore.getState().selectSkill('zuizhendao_skill1');
        // AI 步进一次：方向评估应选中能绕路踩到斜向敌人的方向并掷刀
        runComputerBattleStep('player2', 0);

        expect(
            victim.currentHp,
            '斜向敌人在 7 步绕路范围内，掷刀应造成伤害'
        ).toBeLessThan(hpBefore);
        expect(zui.counters['醉意'] ?? 0, '踩到敌人应获得醉意').toBeGreaterThan(0);
    });

    it('所有方向都踩不到敌人时不再掷空刀', () => {
        const { zui, victim } = setupAiBattle();
        const hpBefore = victim.currentHp;
        // 把玩家英雄全部挪到远离 AI 醉枕刀的左下角，
        // 保证任何方向的 7 步路径都踩不到敌人
        const s = useGameStore.getState();
        const p1Heroes = [...s.player1Heroes].filter(h => h.state === 'alive');
        for (const hero of p1Heroes) {
            if (hero.position) s.board[hero.position[0]][hero.position[1]] = null;
        }
        const spots: Array<[number, number]> = [[5, 0], [4, 0], [5, 1], [3, 0]];
        p1Heroes.forEach((hero, index) => {
            const pos = spots[index % spots.length];
            hero.position = pos;
            s.board[pos[0]][pos[1]] = hero;
        });

        passPlayer1Turn();
        const posBefore = [...zui.position!] as [number, number];
        useGameStore.getState().selectHeroForAction(zui);
        useGameStore.getState().selectSkill('zuizhendao_skill1');
        runComputerBattleStep('player2', 0);

        // 修复前：直线无敌人时仍会随机方向掷刀（位移+0伤害）；
        // 修复后：踩不到敌人则不掷刀
        const moved = zui.position![0] !== posBefore[0] || zui.position![1] !== posBefore[1];
        expect(
            moved,
            `踩不到敌人时不应掷空刀位移：从 [${posBefore}] 到 [${zui.position}]`
        ).toBe(false);
        expect(victim.currentHp).toBe(hpBefore);
        expect(zui.counters['醉意'] ?? 0).toBe(0);
    });
});
