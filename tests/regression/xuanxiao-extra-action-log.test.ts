import { describe, expect, it } from 'vitest';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import type { Hero } from '../../src/types/game';

/**
 * 玄霄「惊鸿再舞」等"行动结束瞬间由引擎补写系统播报"的链路回归：
 * 引擎 addLog 写进 action 开头捕获的旧 battleLog 数组，而技能文案走 store addLog
 * 换新数组。收尾提交若只展开 store 那份，"XX触发再次行动！"就永远进不了界面，
 * 玩家看到"令队友立即再动"却没有任何后续，误以为再动没生效。
 */
function setupXuanxiaoBattle(): { p2: (prefix: string) => Hero } {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    for (const heroId of ['moran', 'zhenxiao', 'huifeng', 'feixue', 'baize', 'liuli']) {
        useGameStore.getState().selectHeroForPlayer('player1', heroId);
    }
    for (const heroId of ['xuanxiao', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        useGameStore.getState().selectHeroForPlayer('player2', heroId);
    }
    useGameStore.getState().confirmHeroSelectionForPlayer('player1');
    useGameStore.getState().confirmHeroSelectionForPlayer('player2');

    for (const [heroId, pos] of [
        ['feixue', [2, 1]], ['moran', [1, 0]], ['zhenxiao', [3, 0]], ['huifeng', [4, 0]],
    ] as Array<[string, [number, number]]>) {
        useGameStore.getState().deployHeroForPlayer('player1', heroId, pos);
    }
    for (const [heroId, pos] of [
        ['xuanxiao', [2, 4]], ['moran', [2, 5]], ['zhenxiao', [3, 5]], ['huifeng', [3, 4]],
    ] as Array<[string, [number, number]]>) {
        useGameStore.getState().deployHeroForPlayer('player2', heroId, pos);
    }
    useGameStore.getState().confirmDeploymentForPlayer('player1');
    useGameStore.getState().confirmDeploymentForPlayer('player2');

    return {
        p2: (prefix: string) =>
            [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith(prefix))!,
    };
}

describe('玄霄再动的引擎播报必须出现在战报里', () => {
    it('技能二结算后同时留有"立即再动"与"触发再次行动"，且控制权交给队友', () => {
        const { p2 } = setupXuanxiaoBattle();
        const xuanxiao = p2('xuanxiao-');
        const moran = p2('moran-');
        useGameStore.setState({ currentPlayer: 'player2', activeHero: xuanxiao, selectedHero: xuanxiao });
        moran.hasActedThisTurn = true;

        useGameStore.getState().selectSkill('xuanxiao_skill2');
        useGameStore.getState().executeSkill(moran.position!);

        const s = useGameStore.getState();
        expect(s.battleLog.some(l => l.message.includes('立即再动'))).toBe(true);
        expect(
            s.battleLog.some(l => l.message.includes('触发再次行动')),
            `引擎系统播报被收尾提交吞掉。实际日志：\n${s.battleLog.slice(-6).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBe(true);
        // 控制权确实交到被再动的队友，且其行动标记被清空
        expect(s.activeHero?.id).toBe(moran.id);
        expect(p2('moran-').hasActedThisTurn).toBe(false);
    });
});

/**
 * AI 侧回归：再动只改变"出手次数"，不产生伤害/效果/棋盘变化，
 * evaluateComputerBoard 看不见它，早先 AI 给技能二打 4 分、伤害技 25 分，从此不再施放。
 * 现在再动有显式加分，这里用真机双电脑整局钉住"会放 + 放了必生效"。
 */
describe('AI 会施放并兑现玄霄的再动', () => {
    it('双电脑整局里玄霄技能二至少释放一次，且每次施放都伴随引擎再动播报', () => {
        const realRandom = Math.random;
        let seed = 12345;
        Math.random = () => {
            seed = (seed + 0x6D2B79F5) >>> 0;
            let t = seed;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        try {
            useGameStore.getState().resetGame();
            useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
            useGameStore.getState().initGame();

            const team = ['xuanxiao', 'huifeng', 'feixue', 'moran', 'zhenxiao', 'liuli'];
            for (const heroId of team) {
                expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
                expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
            }
            expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
            expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);

            const p1Pos: Array<[number, number]> = [[5, 0], [5, 1], [4, 0], [4, 1]];
            const p2Pos: Array<[number, number]> = [[0, 4], [0, 5], [1, 4], [1, 5]];
            p1Pos.forEach((pos, index) => {
                expect(useGameStore.getState().deployHeroForPlayer('player1', team[index], pos)).toBe(true);
            });
            p2Pos.forEach((pos, index) => {
                expect(useGameStore.getState().deployHeroForPlayer('player2', team[index], pos)).toBe(true);
            });
            expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
            expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);
            expect(useGameStore.getState().phase).toBe('battle');

            let lastSignature = '';
            let repeatCount = 0;
            let steps = 0;
            while (steps < 1200 && useGameStore.getState().phase === 'battle') {
                const signature = JSON.stringify(useGameStore.getState(), (key, value) =>
                    typeof value === 'function' || key === 'battleLog' ? undefined : value
                );
                repeatCount = signature === lastSignature ? repeatCount + 1 : 0;
                lastSignature = signature;
                // 补员挂起期间由补员方（而非行动方）决策，否则会原地空转
                const stuck = useGameStore.getState();
                runComputerBattleStep(stuck.reinforcingPlayer ?? stuck.currentPlayer, repeatCount);
                steps++;
            }

            const s = useGameStore.getState();
            const cast = s.battleLog.filter(entry => entry.message.includes('立即再动'));
            const triggered = s.battleLog.filter(entry => entry.message.includes('触发再次行动'));
            expect(steps).toBeLessThan(1200);
            expect(cast.length, `AI 整局未施放玄霄技能二（round=${s.roundNumber}）`).toBeGreaterThan(0);
            // 再动通道是共享的：墨阑「为道」、游隼、薛定谔被动都会播报「触发再次行动」，
            // 因此只能按人名核对"玄霄这一次施放有没有被引擎兑现"，不能比较两条日志的总数
            for (const entry of cast) {
                const targetName = entry.message.split('令')[1]?.replace('立即再动', '').trim();
                expect(
                    triggered.some(item => item.message.startsWith(`${targetName}触发再次行动`)),
                    `玄霄令「${targetName}」再动，但引擎没有兑现：${triggered.map(item => item.message).join(' / ')}`
                ).toBe(true);
            }
        } finally {
            Math.random = realRandom;
        }
    }, 120000);
});
