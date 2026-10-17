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
        expect(html).toContain('第 <b>1</b> / 2 步');
        expect(html).toContain('行动者 <b>回锋</b>');
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
        // 关键节点：时间轴上的可点事件刻度 + 图例
        expect(html).toContain('击杀');
        expect(html).toContain('replay-event replay-mark-kill');
        // 本步战报取自帧的战报区间
        expect(html).toContain('回锋击杀了墨阑');
    });

    it('两条舷分别列出自家阵容，棋盘外的人员状态也能看到', () => {
        const html = renderToStaticMarkup(<BattleReplayPanel replay={REPLAY} onClose={() => { }} />);
        expect(html).toContain('replay-rail-player1');
        expect(html).toContain('replay-rail-player2');
        expect(html).toContain('玩家一');
        expect(html).toContain('玩家二');
        // 当前行动者在自己那条舷上要被标出来
        expect(html).toContain('is-actor');
    });

    it('时间轴按回合分段，点一段就能跳到该回合首步', () => {
        const html = renderToStaticMarkup(<BattleReplayPanel replay={REPLAY} onClose={() => { }} />);
        expect(html).toContain('replay-round-band');
        expect(html).toContain('replay-round-band is-current');
        expect(html).toContain('第 1 回合 · 第 1–1 步');
    });

    it('回合段够宽时才写回合号，窄段留空而不是被裁成半个 R', () => {
        const steps = 60;
        const frames = Array.from({ length: steps }, (_, index) => frame(
            [unit(0, 2, 2, Math.max(4, 40 - index)), unit(1, 3, 3, Math.max(4, 47 - index))],
            { round: 1 + Math.floor(index / 15) },
            index,
        ));
        const html = renderToStaticMarkup(
            <BattleReplayPanel replay={{ ...REPLAY, frames, marks: [{ frame: 20, kind: 'kill', label: '回锋击杀了墨阑' }] }} onClose={() => { }} />
        );
        expect(html).toContain('>R1<');
        expect(html).toContain('>R4<');
        // 击杀事件做成可点刻度，回合切换不再重复打点
        expect(html).toContain('replay-event replay-mark-kill');
        expect(html).not.toContain('replay-event replay-mark-round');
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

    it('刻度按滑块可行程定位，单帧录像也不会算出 NaN', () => {
        const html = renderToStaticMarkup(<BattleReplayPanel replay={REPLAY} onClose={() => { }} />);
        // 两帧时 lastIndex=1：首帧 ratio=0，末帧 ratio=1，交由 CSS 做 thumb 半宽内缩
        expect(html).toContain('--replay-ratio:0');
        expect(html).toContain('--replay-ratio:1');

        const singleFrame = renderToStaticMarkup(
            <BattleReplayPanel
                replay={{ ...REPLAY, frames: [REPLAY.frames[0]], marks: [{ frame: 0, kind: 'kill', label: '击杀' }] }}
                onClose={() => { }}
            />
        );
        expect(singleFrame).not.toContain('NaN');
        expect(singleFrame).toContain('--replay-ratio:0');
    });

    it('战报滚动区用固定类名，供竖屏钉死高度（否则两舷随帧上下跳）', () => {
        const html = renderToStaticMarkup(<BattleReplayPanel replay={REPLAY} onClose={() => { }} />);
        expect(html).toContain('replay-log-scroll');
        expect(html).toContain('replay-action-count');
        expect(html).toContain('replay-roster');
    });
});
