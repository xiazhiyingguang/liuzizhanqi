import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BattleReplayPanel } from '../../src/components/Game/BattleReplayModal';
import type { BattleReplay, ReplayFrame, ReplayStatic, ReplayUnit } from '../../src/core/battle-replay';
import type { BattleLogEntry } from '../../src/types/game';

function unit(def: number, r: number, c: number, hp: number, effects: Array<[string, number]> = []): ReplayUnit {
    return { def, r, c, hp, shield: 0, state: 0, effects, counters: [] };
}

const STATICS: ReplayStatic[] = [
    { heroId: 'huifeng-player1-1', templateId: 'huifeng', name: '回锋', className: '武曲', owner: 'player1', maxHp: 40 },
    { heroId: 'moran-player2-2', templateId: 'moran', name: '墨阑', className: '武曲', owner: 'player2', maxHp: 47 },
];

function frame(units: ReplayUnit[], extra: Partial<ReplayFrame>, index: number): ReplayFrame {
    return {
        index, round: 1, player: 'player1', actions: index, required: 8, actor: 0,
        areas: [{ type: 'wind-blade', r: 3, c: 3, owner: 'player1', duration: 3, direction: 'right' }],
        logFrom: 0, logTo: 1, sig: `s${index}`, ended: false, ...extra, units,
    };
}

const NARRATION: BattleLogEntry[] = [
    { id: 'n0', timestamp: 0, type: 'kill', player: 'player1', message: '回锋击杀了墨阑' },
];

const REPLAY: BattleReplay = {
    matchId: 'match-test',
    statics: STATICS,
    narration: NARRATION,
    frames: [
        frame([unit(0, 2, 2, 40), unit(1, 3, 3, 20)], { round: 1 }, 0),
        frame([unit(0, 2, 2, 34, [['锋鸣', 2]]), unit(1, 3, 3, 0, [])], { round: 2, ended: true, winner: 'player1' }, 1),
    ],
    marks: [
        { frame: 0, kind: 'kill', label: '回锋击杀了墨阑' },
        { frame: 1, kind: 'round', label: '第 2 回合' },
    ],
    coarsened: false,
};

describe('对局回放面板', () => {
    it('渲染棋盘、当前帧信息与关键节点', () => {
        const html = renderToStaticMarkup(<BattleReplayPanel replay={REPLAY} onClose={() => { }} />);

        expect(html).toContain('对局回放');
        expect(html).toContain('第 1 / 2 步');
        expect(html).toContain('行动者：回锋');
        // 6x6 只读格
        expect(html).toContain('replay-cell-0-0');
        expect(html).toContain('replay-cell-5-5');
        // 场地效果与棋子都按帧数据渲染
        expect(html).toContain('bf-wind-blade');
        // 常驻风刃用弯月图形，刃尖朝向取自帧数据
        expect(html).toContain('bf-wind-blade-right');
        expect(html).toContain('wb-body');
        expect(html).toContain('wb-edge');
        expect(html).toContain('piece-p1');
        // 关键节点：击杀 chip + 时间轴刻度
        expect(html).toContain('击杀');
        expect(html).toContain('replay-tick replay-mark-kill');
        // 本步战报取自帧的战报区间
        expect(html).toContain('回锋击杀了墨阑');
    });

    it('只读棋盘不暴露可操作的战斗格子', () => {
        const html = renderToStaticMarkup(<BattleReplayPanel replay={REPLAY} onClose={() => { }} />);
        expect(html).not.toContain('data-testid="battle-cell-');
    });

    it('没有可回放数据时给出空态而不是崩溃', () => {
        const html = renderToStaticMarkup(
            <BattleReplayPanel
                replay={{ matchId: undefined, statics: [], narration: [], frames: [], marks: [], coarsened: false }}
                onClose={() => { }}
            />
        );
        expect(html).toContain('本局没有可回放的记录');
    });

    it('抽样模式要在标题栏提示', () => {
        const html = renderToStaticMarkup(
            <BattleReplayPanel replay={{ ...REPLAY, coarsened: true }} onClose={() => { }} />
        );
        expect(html).toContain('已按回合抽样');
    });
});
