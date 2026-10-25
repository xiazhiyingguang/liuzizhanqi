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
import type { BattleLogEntry, BoardEffect, Effect } from '../../src/types/game';
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

function makeEffect(name: string, sourceHeroId = 'source', overrides: Partial<Effect> = {}): Effect {
    return {
        id: `effect-${name}`, type: 'buff', name, duration: 1, sourceHeroId, ...overrides,
    };
}

function makeArea(overrides: Partial<BoardEffect> & Pick<BoardEffect, 'type' | 'position'>): BoardEffect {
    return {
        id: `area-${overrides.type}`,
        owner: 'player1',
        sourceHeroId: 'source',
        duration: 2,
        ...overrides,
    };
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

    it('签名能区分两个非行动者互换位置，即使坐标总和不变', () => {
        const state = makeGameState();
        const left = addHero(state, 'huifeng', 'player1', [0, 1]);
        const right = addHero(state, 'moran', 'player1', [0, 2]);
        const before = stepSignature(state);

        state.board[0][1] = right;
        state.board[0][2] = left;
        left.position = [0, 2];
        right.position = [0, 1];

        expect(stepSignature(state)).not.toBe(before);
    });

    it('签名能区分两名单位等量一伤一疗，即使生命总和不变', () => {
        const state = makeGameState();
        const hurt = addHero(state, 'huifeng', 'player1', [0, 1]);
        const healed = addHero(state, 'liuli', 'player1', [0, 2]);
        const before = stepSignature(state);

        hurt.currentHp -= 5;
        healed.currentHp += 5;

        expect(stepSignature(state)).not.toBe(before);
    });

    it('签名能捕捉状态、计数器与场地效果内容变化', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        state.boardEffects = [makeArea({ type: 'water-moon', position: [4, 4] })];

        const baseline = stepSignature(state);
        hero.effects.push(makeEffect('潜行', hero.id));
        const withEffect = stepSignature(state);
        expect(withEffect).not.toBe(baseline);

        hero.counters['禅定'] = 1;
        const withCounter = stepSignature(state);
        expect(withCounter).not.toBe(withEffect);

        state.boardEffects = [{ ...state.boardEffects[0], duration: 1 }];
        expect(stepSignature(state)).not.toBe(withCounter);
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

    it('buildFrame 完整保留状态列表、原始计数器与被动 id', () => {
        const state = makeGameState();
        state.phase = 'battle';
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        hero.effects = Array.from({ length: 7 }, (_, index) => makeEffect(`状态${index}`, hero.id));
        hero.counters = { 禅定: 2, jetzmi_form: 1, __internal: 9 };

        const interner = createInterner();
        const frame = buildFrame(state, 0, 'sig', 0, 0, interner);
        const unit = frame.units[0];

        expect(unit.effects).toHaveLength(7);
        expect(unit.counters).toContainEqual(['禅定', 2]);
        expect(unit.counters).not.toContainEqual(['jetzmi_form', 1]);
        expect(unit.rawCounters).toMatchObject({ 禅定: 2, jetzmi_form: 1 });
        expect(interner.statics[0].passiveId).toBe('moran_passive');
    });

    it('buildFrame 保存水泽半径、英雄连线与时空停滞残影', () => {
        const state = makeGameState({ roundNumber: 2 });
        const caster = addHero(state, 'huifeng', 'player1', [1, 1]);
        const target = addHero(state, 'moran', 'player2', [1, 3]);
        caster.passiveId = 'yinyang_passive';
        target.effects = [makeEffect('阳线攻击', caster.id)];
        state.boardEffects = [makeArea({ type: 'water-marsh', position: [2, 2], owner: 'player2', radius: 2 })];

        const ghost = addHero(state, 'liuli', 'player2', [4, 4]);
        state.board[4][4] = null;
        ghost.state = HeroState.DEAD;
        ghost.currentHp = 0;
        ghost.counters['__dai_stasis_until'] = 3;

        const frame = buildFrame(state, 0, 'sig', 0, 0, createInterner());

        expect(frame.areas[0].radius).toBe(2);
        expect(frame.links).toHaveLength(1);
        expect(frame.links?.[0]).toMatchObject({
            from: [1, 1], to: [1, 3], kind: 'yang',
        });
        expect(frame.ghosts).toHaveLength(1);
        expect(frame.ghosts?.[0]).toMatchObject({ r: 4, c: 4 });
    });

    it('computeFrameDeltas 记录护盾变化与死亡落点', () => {
        const shielded = makeFrame({ units: [{ ...makeUnit(0, 2, 2, 40), shield: 10 }] });
        const blocked = makeFrame({ units: [makeUnit(0, 2, 2, 40)] }, 1);
        expect(computeFrameDeltas(shielded, blocked)).toEqual([
            { def: 0, hp: 0, shield: -10, r: 2, c: 2, died: false },
        ]);

        const dying = makeFrame({ units: [makeUnit(0, 1, 4, 7)] }, 2);
        const dead = makeFrame({ units: [{ ...makeUnit(0, -1, -1, 0), state: 2 }] }, 3);
        expect(computeFrameDeltas(dying, dead)).toEqual([
            { def: 0, hp: -7, shield: 0, r: 1, c: 4, died: true },
        ]);
    });

    it('computeFrameDeltas 给出本步生命增减', () => {
        const first = makeFrame({ units: [makeUnit(0, 2, 2, 40), makeUnit(1, 3, 3, 47)] });
        const second = makeFrame({ units: [makeUnit(0, 2, 2, 34), makeUnit(1, 3, 3, 50)] }, 1);

        expect(computeFrameDeltas(first, second)).toEqual([
            { def: 0, hp: -6, shield: 0, r: 2, c: 2, died: false },
            { def: 1, hp: 3, shield: 0, r: 3, c: 3, died: false },
        ]);
        expect(computeFrameDeltas(null, second)).toEqual([]);
    });

    it('detectKeyMoments 识别击杀、濒危、补员、回合切换与终局', () => {
        const narration = [
            logEntry('a', 'damage'),
            logEntry('b', 'kill', '回锋击杀了墨阑'),
            logEntry('c', 'tianwei', '回锋触发天威'),
        ];
        // 第 1 帧还没有 1 号单位：它在第 2 帧首次登记并上场，应判为补员
        const first = makeFrame({ units: [makeUnit(0, 2, 2, 30)], logTo: 1 });
        const second = makeFrame({
            units: [makeUnit(0, 2, 2, 8), makeUnit(1, 3, 3, 47)],
            logFrom: 1,
            logTo: 3,
            round: 2,
            ended: true,
            winner: 'player1',
        }, 1);

        const marks = detectKeyMoments([first, second], STATICS, narration);
        const secondFrameMarks = marks.filter(mark => mark.frame === 1);

        // 击杀与它触发的天威落在同一帧：合成一枚标签，不再成对刷屏
        expect(secondFrameMarks.map(mark => mark.kind).sort())
            .toEqual(['critical', 'end', 'kill', 'reinforce', 'round']);
        const killMark = secondFrameMarks.find(mark => mark.kind === 'kill');
        expect(killMark?.label).toContain('回锋击杀了墨阑');
        expect(killMark?.label).toContain('回锋触发天威');
    });

    it('老单位离场后重新上场记为返场，不再冒充补员', () => {
        const first = makeFrame({ units: [makeUnit(0, 2, 2, 40), makeUnit(1, -1, -1, 40)] });
        const second = makeFrame({
            units: [makeUnit(0, 2, 2, 40), makeUnit(1, 3, 3, 40)],
            logFrom: 0,
            logTo: 0,
        }, 1);

        const marks = detectKeyMoments([first, second], STATICS, []);
        expect(marks.filter(mark => mark.kind === 'reinforce')).toHaveLength(0);
        expect(marks.filter(mark => mark.kind === 'return')).toEqual([
            expect.objectContaining({ frame: 1, label: '墨阑返场' }),
        ]);
    });

    it('同一帧的多次击杀与多次天威全部一一配对，不留下重复刻度', () => {
        const narration = [
            logEntry('k1', 'kill', '回锋击杀了甲'),
            logEntry('k2', 'kill', '回锋击杀了乙'),
            logEntry('t1', 'tianwei', '回锋触发天威一'),
            logEntry('t2', 'tianwei', '回锋触发天威二'),
        ];
        const first = makeFrame({ units: [makeUnit(0, 2, 2, 40), makeUnit(1, 3, 3, 40)] });
        const second = makeFrame({
            units: [makeUnit(0, 2, 2, 20), makeUnit(1, 3, 3, 20)],
            logFrom: 0,
            logTo: 4,
        }, 1);

        const marks = detectKeyMoments([first, second], STATICS, narration);
        const kills = marks.filter(mark => mark.kind === 'kill');
        expect(kills).toHaveLength(2);
        expect(kills.every(mark => mark.label.includes('；'))).toBe(true);
        expect(marks.filter(mark => mark.kind === 'tianwei')).toHaveLength(0);
    });

    it('濒危节点每名单位整局只打一次点，避免残血单位反复刷屏', () => {
        const narration = [logEntry('a', 'damage')];
        const healthy = makeFrame({ units: [makeUnit(0, 2, 2, 38)] });
        const critical = makeFrame({ units: [makeUnit(0, 2, 2, 6)] }, 1);
        const stillCritical = makeFrame({ units: [makeUnit(0, 2, 2, 4)] }, 2);
        // 被抬回安全区后又跌破：仍然不再重复打点
        const healed = makeFrame({ units: [makeUnit(0, 2, 2, 38)] }, 3);
        const criticalAgain = makeFrame({ units: [makeUnit(0, 2, 2, 5)] }, 4);

        const marks = detectKeyMoments(
            [healthy, critical, stillCritical, healed, criticalAgain], STATICS, narration
        );
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
