import { describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import type { Hero } from '../../src/types/game';

/** 热座双人模式：绯雪(player1) 对阵 李太白(player2) */
function setupHotseatBattle(): { feixue: () => Hero | undefined; libai: () => Hero | undefined } {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, aiPlayer: undefined, localPlayerNumber: 1 });
    useGameStore.getState().initGame();

    for (const heroId of ['feixue', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    for (const heroId of ['libai', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
    }
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);

    for (const [heroId, pos] of [
        ['feixue', [2, 2]],
        ['moran', [1, 0]],
        ['zhenxiao', [3, 0]],
        ['huifeng', [1, 1]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    }
    for (const [heroId, pos] of [
        ['libai', [2, 3]],
        ['moran', [2, 5]],
        ['zhenxiao', [3, 5]],
        ['huifeng', [3, 4]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player2', heroId, pos)).toBe(true);
    }
    expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);

    expect(useGameStore.getState().phase).toBe('battle');
    return {
        feixue: () => [...useGameStore.getState().player1Heroes].find(h => h.id.startsWith('feixue-player1-')),
        libai: () => [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-')),
    };
}

describe('绯雪攻击李太白的热座双人回归', () => {
    it('绯雪技能1攻击李太白：李太白受伤，玩家1结束行动后玩家2可正常操作李太白', () => {
        const { feixue, libai } = setupHotseatBattle();
        const feixueHero = feixue()!;
        const libaiHero = libai()!;
        const hpBefore = libaiHero.currentHp;
        expect(feixueHero).toBeDefined();
        expect(libaiHero).toBeDefined();
        expect(useGameStore.getState().currentPlayer).toBe('player1');

        // 玩家1：绯雪技能1攻击相邻李太白
        useGameStore.getState().selectHeroForAction(feixueHero);
        useGameStore.getState().selectSkill('feixue_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        let s = useGameStore.getState();
        // 李太白必须掉血（用户报告"没有受到伤害"）
        expect(
            libai()!.currentHp,
            `攻击后李太白血量未变化。日志：\n${s.battleLog.slice(-6).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBeLessThan(hpBefore);

        // 玩家1结束所有行动（绯雪已行动，结束其余）
        for (const hero of s.player1Heroes) {
            if (hero.state === 'alive' && !hero.hasActedThisTurn) {
                useGameStore.getState().selectHeroForAction(hero);
                useGameStore.getState().endHeroAction();
                s = useGameStore.getState();
                if (s.currentPlayer === 'player2') break;
            }
        }

        s = useGameStore.getState();
        expect(s.currentPlayer).toBe('player2');

        // 玩家2：应能选中并操作李太白
        const libaiNow = libai()!;
        useGameStore.getState().selectHeroForAction(libaiNow);
        s = useGameStore.getState();
        expect(
            s.selectedHero?.id,
            `玩家2无法选中李太白。currentPlayer=${s.currentPlayer} activeHero=${s.activeHero?.id ?? 'null'}\n日志：\n${s.battleLog.slice(-6).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBe(libaiNow.id);

        // 李太白技能1应能施放（攻击相邻绯雪）
        useGameStore.getState().selectSkill('libai_skill1');
        expect(useGameStore.getState().selectedSkill?.id).toBe('libai_skill1');
        useGameStore.getState().executeSkill([2, 2]);
        s = useGameStore.getState();
        // 施法应写入非 system 日志
        const freshLogs = s.battleLog.slice(-3).map(l => l.type);
        expect(freshLogs.some(t => t !== 'system'), `李太白技能施放失败。日志：\n${s.battleLog.slice(-6).map(l => `[${l.type}]${l.message}`).join('\n')}`).toBe(true);
    });

    it('绯雪普攻（移动后近战）李太白后再切换回合也正常', () => {
        const { feixue, libai } = setupHotseatBattle();
        const feixueHero = feixue()!;
        const libaiHero = libai()!;
        const hpBefore = libaiHero.currentHp;

        // 普攻路径：选中绯雪 → 展示移动范围 → 直接点击李太白所在格（近战攻击逻辑视技能范围而定）
        useGameStore.getState().selectHeroForAction(feixueHero);
        useGameStore.getState().executeSkill([2, 3]);
        const s = useGameStore.getState();
        // 无论普攻是否结算（普攻需技能面板支持），断言流程未卡死：玩家1仍能结束行动
        let ended = false;
        for (const hero of s.player1Heroes) {
            if (hero.state === 'alive' && !hero.hasActedThisTurn) {
                useGameStore.getState().selectHeroForAction(hero);
                useGameStore.getState().endHeroAction();
                if (useGameStore.getState().currentPlayer === 'player2') { ended = true; break; }
            }
        }
        expect(ended).toBe(true);
        expect(libai()!.currentHp).toBeLessThanOrEqual(hpBefore);
    });
});
