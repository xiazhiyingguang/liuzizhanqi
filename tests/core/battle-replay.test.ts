import { describe, expect, it } from 'vitest';
import {
    buildFrame,
    computeFrameDeltas,
    createInterner,
    detectKeyMoments,
    isCoarseWorthy,
    stepSignature,
    templateIdOf,
    type ReplayFrame,
    type ReplayStatic,
    type ReplayUnit,
} from '../../src/core/battle-replay';
import { addHero, makeGameState } from '../helpers/game-state';
import type { BattleLogEntry } from '../../src/types/game';
import { HeroState } from '../../src/types/game';

function logEntry(id: string, type: BattleLogEntry['type'], message = id): BattleLogEntry {
    return { id, timestamp: 0, type, player: 'player1', message };
}

/** 造一个最小可用的帧：只填被测函数关心的字段 */
function makeFrame(overrides: Partial<ReplayFrame> & { units: ReplayUnit[] }, index = 0): ReplayFrame {
    return {
        index,
        round: 1,
        player: 'player1',
        actions: 0,
        required: 8,
        actor: -1,
        areas: [],
        logFrom: 0,
        logTo: 0,
        sig: `sig-${index}`,
        ended: false,
        ...overrides,
    };
}

function makeUnit(def: number, r: number, c: number, hp: number): ReplayUnit {
    return { def, r, c, hp, shield: 0, state: 0, effects: [], counters: [] };
}

const STATICS: ReplayStatic[] = [
    { heroId: 'huifeng-player1-1', templateId: 'huifeng', name: '回锋', className: '武曲', owner: 'player1', maxHp: 40 },
    { heroId: 'moran-player2-2', templateId: 'moran', name: '墨阑', className: '武曲', owner: 'player2', maxHp: 47 },
];

describe('battle-replay 数据层', () => {
    it('签名能区分阶段、站位与血量，且不随纯视觉字段变化', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        state.phase = 'battle';
        const before = stepSignature(state);

        expect(stepSignature(state)).toBe(before);

        hero.currentHp -= 5;
        expect(stepSignature(state)).not.toBe(before);
    });

    it('buildFrame 只存数字与字符串，历史帧不会被后续就地改写影响', () => {
        const state = makeGameState();
        state.phase = 'battle';
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const interner = createInterner();

        const frame = buildFrame(state, 0, 'sig', 0, 0, interner);
        const unit = frame.units.find(candidate => candidate.def === 0);
        expect(unit).toMatchObject({ r: 2, c: 2, hp: hero.currentHp });

        // 模拟 undoMove / 结算这类原地改写
        hero.currentHp = 1;
        hero.position = [0, 0];
        expect(frame.units.find(candidate => candidate.def === 0)).toMatchObject({ r: 2, c: 2 });
        expect(frame.units.find(candidate => candidate.def === 0)?.hp).not.toBe(1);
    });

    it('未部署与替补单位也进帧，坐标记为 -1', () => {
        const state = makeGameState();
        state.phase = 'battle';
        addHero(state, 'huifeng', 'player1', [2, 2]);
        const benched = addHero(state, 'moran', 'player1', [0, 0]);
        // 从棋盘上摘掉，模拟还在替补席
        state.board[0][0] = null;
        benched.position = null;

        const frame = buildFrame(state, 0, 'sig', 0, 0, createInterner());
        const offBoard = frame.units.filter(unit => unit.r === -1);
        expect(offBoard).toHaveLength(1);
    });

    it('尸体保留的死亡格不再被当成上场位置：一格只画真正占位的单位', () => {
        const state = makeGameState();
        state.phase = 'battle';
        const fallen = addHero(state, 'moran', 'player2', [0, 0]);
        const living = addHero(state, 'huifeng', 'player1', [3, 3]);
        // 阵亡不清 position（时空停滞的尸体就是这样），随后有人站上了这格
        fallen.state = HeroState.DEAD;
        fallen.currentHp = 0;
        state.board[3][3] = null;
        state.board[0][0] = living;
        living.position = [0, 0];

        const frame = buildFrame(state, 0, 'sig', 0, 0, createInterner());
        expect(frame.units.filter(unit => unit.r === 0 && unit.c === 0), '同一格不得叠两个单位')
            .toHaveLength(1);
        expect(frame.units.filter(unit => unit.r === -1), '离场单位不该画在板上')
            .toHaveLength(1);
    });

    it('强制位移只改棋盘时，帧坐标跟着棋盘走而不是滞后的 position', () => {
        const state = makeGameState();
        state.phase = 'battle';
        const hero = addHero(state, 'huifeng', 'player1', [1, 1]);
        state.board[1][1] = null;
        state.board[4][2] = hero;   // 忘了同步 hero.position 的那类位移

        const frame = buildFrame(state, 0, 'sig', 0, 0, createInterner());
        expect(frame.units[0]).toMatchObject({ r: 4, c: 2 });
    });

    it('模板 id 归一只剥掉部署后缀，召唤物 id 原样保留', () => {
        const state = makeGameState();
        const hero = addHero(state, 'youjun', 'player1', [2, 2]);
        expect(templateIdOf(hero)).toBe('youjun');
        expect(templateIdOf({ ...hero, id: 'summon|p1|t_painting|3' })).toBe('summon|p1|t_painting|3');
    });

    it('computeFrameDeltas 给出本步生命增减', () => {
        const first = makeFrame({ units: [makeUnit(0, 2, 2, 40), makeUnit(1, 3, 3, 47)] });
        const second = makeFrame({ units: [makeUnit(0, 2, 2, 34), makeUnit(1, 3, 3, 50)] }, 1);

        expect(computeFrameDeltas(first, second)).toEqual([
            { def: 0, hp: -6, shield: 0 },
            { def: 1, hp: 3, shield: 0 },
        ]);
        expect(computeFrameDeltas(null, second)).toEqual([]);
    });

    it('detectKeyMoments 识别击杀、濒危、补员、回合切换与终局', () => {
        const narration = [
            logEntry('a', 'damage'),
            logEntry('b', 'kill', '回锋击杀了墨阑'),
            logEntry('c', 'tianwei', '回锋触发天威'),
        ];
        const first = makeFrame({ units: [makeUnit(0, 2, 2, 30), makeUnit(1, -1, -1, 47)], logTo: 1 });
        const second = makeFrame({
            units: [makeUnit(0, 2, 2, 8), makeUnit(1, 3, 3, 47)],
            logFrom: 1,
            logTo: 3,
            round: 2,
            ended: true,
            winner: 'player1',
        }, 1);

        const marks = detectKeyMoments([first, second], STATICS, narration);
        const kindsAtSecond = marks.filter(mark => mark.frame === 1).map(mark => mark.kind).sort();

        expect(kindsAtSecond).toEqual(['critical', 'end', 'kill', 'reinforce', 'round', 'tianwei']);
    });

    it('濒危节点在同一回合内只打一次点，避免残血单位刷屏', () => {
        const narration = [logEntry('a', 'damage')];
        const healthy = makeFrame({ units: [makeUnit(0, 2, 2, 38)] });
        const critical = makeFrame({ units: [makeUnit(0, 2, 2, 6)] }, 1);
        const stillCritical = makeFrame({ units: [makeUnit(0, 2, 2, 4)] }, 2);

        const marks = detectKeyMoments([healthy, critical, stillCritical], STATICS, narration);
        expect(marks.filter(mark => mark.kind === 'critical')).toHaveLength(1);
    });

    it('抽样准入判据只保留有信息量的帧', () => {
        const previous = makeFrame({ units: [makeUnit(0, 2, 2, 40)] });
        expect(isCoarseWorthy(null, previous)).toBe(true);
        expect(isCoarseWorthy(previous, makeFrame({ units: [makeUnit(0, 2, 2, 40)], round: 2 }, 1))).toBe(true);
        expect(isCoarseWorthy(previous, makeFrame({ units: [makeUnit(0, 2, 2, 30)] }, 1))).toBe(true);
        expect(isCoarseWorthy(previous, makeFrame({ units: [makeUnit(0, 1, 1, 40)] }, 1))).toBe(false);
    });
});
