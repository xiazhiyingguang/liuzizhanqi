import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BattleReplayPanel } from '../../src/components/Game/BattleReplayModal';
import ReplayBoard from '../../src/components/Game/ReplayBoard';
import { nextPlaybackToggle } from '../../src/core/replay-playback';
import type { BattleReplay, ReplayArea, ReplayDelta, ReplayFrame, ReplayStatic, ReplayUnit } from '../../src/core/battle-replay';
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

    it('存活数不把暂亡单位算进去', () => {
        const tempDead: ReplayUnit = { def: 1, r: -1, c: -1, hp: 0, shield: 0, state: 1, effects: [], counters: [] };
        const html = renderToStaticMarkup(
            <BattleReplayPanel
                replay={{ ...REPLAY, frames: [frame([unit(0, 2, 2, 40), tempDead], {}, 0)] }}
                onClose={() => { }}
            />
        );
        expect(html).toContain('存活 0/1');
        expect(html).toContain('暂亡');
    });

    it('返场节点有自己的图例与刻度，不再借用补员', () => {
        const html = renderToStaticMarkup(
            <BattleReplayPanel
                replay={{ ...REPLAY, marks: [{ frame: 0, kind: 'return', label: '墨阑返场' }] }}
                onClose={() => { }}
            />
        );
        expect(html).toContain('返场');
        expect(html).toContain('replay-event replay-mark-return');
    });

    it('末帧按播放会从头重播', () => {
        expect(nextPlaybackToggle(false, 5, 5)).toEqual({ playing: true, restartAt: 0 });
        expect(nextPlaybackToggle(false, 2, 5)).toEqual({ playing: true });
        expect(nextPlaybackToggle(true, 2, 5)).toEqual({ playing: false });
    });
});

describe('回放棋盘', () => {
    const BOARD_STATICS: ReplayStatic[] = [
        { heroId: 'a-player1-1', templateId: 'moran', name: '墨阑', className: '武曲', owner: 'player1', maxHp: 40, passiveId: 'moran_passive' },
        { heroId: 'b-player2-2', templateId: 'baize', name: '白泽', className: '天师', owner: 'player2', maxHp: 40, passiveId: 'baize_passive' },
        { heroId: 'c-player1-3', templateId: 'jetzmi', name: '杰茨米', className: '武曲', owner: 'player1', maxHp: 60, passiveId: 'jetzmi_passive' },
    ];

    function boardFrame(overrides: Partial<ReplayFrame>): ReplayFrame {
        return {
            index: 0, round: 1, player: 'player1', actions: 0, required: 8, actor: 0,
            units: [], areas: [], logFrom: 0, logTo: 0, sig: 'board', ended: false,
            ...overrides,
        };
    }

    function area(type: ReplayArea['type'], r: number, c: number, extra: Partial<ReplayArea> = {}): ReplayArea {
        return { type, r, c, owner: 'player1', duration: 2, ...extra };
    }

    it('完全被护盾挡下的伤害也会显示“挡下”', () => {
        const html = renderToStaticMarkup(
            <ReplayBoard
                frame={boardFrame({ units: [unit(0, 2, 2, 40)] })}
                statics={BOARD_STATICS}
                deltas={[{ def: 0, hp: 0, shield: -10, r: 2, c: 2, died: false }]}
            />
        );
        expect(html).toContain('挡下 10');
    });

    it('死亡格的击杀数字与阵亡标记不随棋子离场消失', () => {
        const html = renderToStaticMarkup(
            <ReplayBoard
                frame={boardFrame({ units: [unit(1, 3, 3, 40)] })}
                statics={BOARD_STATICS}
                deltas={[{ def: 0, hp: -7, shield: 0, r: 2, c: 2, died: true }]}
            />
        );
        expect(html).toContain('-7');
        expect(html).toContain('阵亡');
    });

    it('全部场地效果都有专属外观，水泽/暗夜/沙丘按真实范围铺开', () => {
        const html = renderToStaticMarkup(
            <ReplayBoard
                frame={boardFrame({
                    units: [],
                    areas: [
                        area('water-marsh', 2, 2, { owner: 'player2', radius: 2 }),
                        area('dark-circle', 2, 2),
                        area('sand-dune', 3, 3),
                        area('water-moon', 5, 0),
                        area('moon-seat', 5, 5),
                        area('shadow-mark', 3, 0),
                        area('light-prism', 3, 5),
                        area('fish-hook', 4, 2),
                        area('lightning-rod', 4, 3),
                        area('lit-lamp', 1, 3),
                        area('brush', 2, 4),
                    ],
                })}
                statics={BOARD_STATICS}
            />
        );

        expect((html.match(/data-replay-area="water-marsh"/g) ?? [])).toHaveLength(25);
        expect((html.match(/data-replay-area="dark-circle"/g) ?? [])).toHaveLength(9);
        expect((html.match(/data-replay-area="sand-dune"/g) ?? [])).toHaveLength(9);
        for (const type of ['water-moon', 'moon-seat', 'shadow-mark', 'light-prism', 'fish-hook', 'lightning-rod', 'lit-lamp', 'brush']) {
            expect(html, type).toContain(`data-replay-area="${type}"`);
        }
        expect(html).toContain('bf-water-moon');
        expect(html).toContain('bf-moon-seat');
        expect(html).toContain('bf-shadow-mark');
        expect(html).toContain('bf-prism');
        expect(html).toContain('bf-fish-hook');
        expect(html).toContain('bf-rod');
        expect(html).toContain('bf-lamp');
        expect(html).toContain('bf-brush');
    });

    it('灯影、英雄连线和时空停滞残影都能在回放里看到', () => {
        const enemy: ReplayUnit = { def: 1, r: 2, c: 3, hp: 40, shield: 0, state: 0, effects: [], counters: [] };
        const html = renderToStaticMarkup(
            <ReplayBoard
                frame={boardFrame({
                    units: [enemy],
                    areas: [area('lit-lamp', 2, 2)],
                    links: [{ from: [2, 3], to: [4, 3], kind: 'rage', length: 2, angleDeg: 90 }],
                    ghosts: [{ def: 2, r: 4, c: 4 }],
                })}
                statics={BOARD_STATICS}
            />
        );
        expect(html).toContain('bf-lamp-shadow');
        expect(html).toContain('hero-link hero-link-rage');
        expect(html).toContain('dai-stasis-ghost');
        expect(html).toContain('杰茨米');
    });

    it('机制徽章按被动与原始计数器还原', () => {
        const king: ReplayUnit = {
            def: 2, r: 2, c: 2, hp: 60, shield: 0, state: 0, effects: [], counters: [],
            rawCounters: { jetzmi_form: 1 },
        };
        const html = renderToStaticMarkup(
            <ReplayBoard frame={boardFrame({ units: [king] })} statics={BOARD_STATICS} />
        );
        expect(html).toContain('hero-mechanism-state');
        expect(html).toContain('data-mechanism-state="king"');
    });
});
