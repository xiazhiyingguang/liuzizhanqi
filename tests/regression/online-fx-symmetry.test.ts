import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AVAILABLE_HERO_IDS, createHero } from '../../src/data/heroes';
import { getSkill } from '../../src/data/skills';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applySnapshotAction } from '../../src/services/online-state';
import { soundManager } from '../../src/core/sound-manager';
import { HeroState, type Hero, type Position } from '../../src/types/game';
import { getPendingActionCells } from '../../src/store/game-store';

/**
 * 扫描：同一次施法，行动方客户端与对端客户端各拿到几个特效事件。
 * 行动方特效挂在 executeSkill 包装层，对端靠 applySnapshotAction 从 action 载荷 +
 * 日志锚点重建 —— 两边判据不同，任何一类技能只在一边出画面，就是玩家看到的"看不到特效"。
 */
let playSpy: Mock;
const fxWindow: string[] = [];

function snapshotFxKinds(): string[] {
    return useGameStore.getState().skillFx.map(event => `${event.skillId}:${event.profile.kind}`);
}

function buildScene(casterTemplate: string, side: 'player1' | 'player2') {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: true, isAiMode: false, localPlayerNumber: side === 'player1' ? 1 : 2 });
    useGameStore.getState().initGame();

    const p1 = ['moran', 'zhenxiao', 'liuli', 'feixue'].map(id => createHero(id, 'player1', [0, 0]));
    const p2 = ['huifeng', 'baize', 'guying', 'xubai'].map(id => createHero(id, 'player2', [0, 0]));
    const caster = createHero(casterTemplate, side, [0, 0]);
    const others = side === 'player1' ? p2 : p1;
    const allies = side === 'player1' ? p1 : p2;
    const casterAllies = allies.map(hero => createHero(hero.id.split('-')[0], side, [0, 0]));

    const layout: Array<[Hero, Position]> = side === 'player1'
        ? [
            [caster, [2, 1]],
            [casterAllies[0], [1, 1]],
            [casterAllies[1], [3, 1]],
            [casterAllies[2], [2, 0]],
            [others[0], [2, 2]],
            [others[1], [1, 2]],
            [others[2], [3, 2]],
            [others[3], [2, 3]],
        ]
        : [
            [caster, [2, 4]],
            [casterAllies[0], [1, 4]],
            [casterAllies[1], [3, 4]],
            [casterAllies[2], [2, 5]],
            [others[0], [2, 3]],
            [others[1], [1, 3]],
            [others[2], [3, 3]],
            [others[3], [2, 2]],
        ];

    const board = Array.from({ length: 6 }, () => Array<Hero | null>(6).fill(null));
    const ownHeroes: Hero[] = [];
    const foeHeroes: Hero[] = [];
    for (const [hero, pos] of layout) {
        hero.position = pos;
        board[pos[0]][pos[1]] = hero;
        if (hero.owner === side) ownHeroes.push(hero);
        else foeHeroes.push(hero);
    }
    // 治疗/复活类技能需要有残血目标
    for (const hero of [...ownHeroes, ...foeHeroes]) hero.currentHp = Math.max(1, Math.round(hero.maxHp * 0.4));

    useGameStore.setState({
        board,
        phase: 'battle',
        currentPlayer: side,
        roundNumber: 3,
        player1Heroes: side === 'player1' ? ownHeroes : foeHeroes,
        player2Heroes: side === 'player1' ? foeHeroes : ownHeroes,
        battleLog: [],
        skillFx: [],
    });
    return caster;
}

function legalTarget(caster: Hero, skillId: string): Position | null {
    useGameStore.getState().selectHeroForAction(caster);
    useGameStore.getState().selectSkill(skillId);
    const state = useGameStore.getState();
    const cells = (state.skillRange.length ? state.skillRange : state.highlightedPositions)
        .filter(cell => cell[0] >= 0 && cell[0] < 6 && cell[1] >= 0 && cell[1] < 6);
    if (cells.length) return cells[Math.floor(cells.length / 2)];
    const skill = getSkill(skillId);
    if (skill && (skill.targetType === 'self' || skill.rangeType === 'single')) return [...caster.position!] as Position;
    return null;
}

function runCast(caster: Hero, skillId: string, targetPos: Position) {
    const pre = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
    useGameStore.setState({ skillFx: [] });
    useGameStore.getState().selectHeroForAction(caster);
    useGameStore.getState().selectSkill(skillId);
    useGameStore.getState().executeSkill(targetPos);
    // 多段/挂起选择型技能：把后续点击也补完，两边都要走同样的步数
    for (let step = 0; step < 3; step++) {
        const state = useGameStore.getState();
        if (!state.pendingBoardAction) break;
        const cells = getPendingActionCells(state);
        if (!cells.length) break;
        useGameStore.getState().executeSkill(cells[0]);
    }
    const post = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
    return { pre, post, actorFx: snapshotFxKinds() };
}

interface CaseResult {
    hero: string;
    skillId: string;
    actorFx: string[];
    receiverFx: string[];
}

const mismatches: CaseResult[] = [];
const bothSilent: CaseResult[] = [];
const matched: CaseResult[] = [];

function evaluateCase(heroId: string, skillId: string, side: 'player1' | 'player2') {
    const caster = buildScene(heroId, side);
    const targetPos = legalTarget(caster, skillId);
    if (!targetPos) return;
    caster.hasActedThisTurn = false;
    caster.hasMovedThisTurn = false;
    const { pre, post, actorFx } = runCast(caster, skillId, targetPos);

    // 切到对端视角：回到施法前状态，只喂 action + 权威快照
    useGameStore.setState({ skillFx: [], localPlayerNumber: side === 'player1' ? 2 : 1 });
    applySnapshotAction(
        { type: 'skill', data: { heroId: caster.id, skillId, targetPos } },
        pre
    );
    playSpy.mockClear();
    applySnapshotAction(
        { type: 'skill', data: { heroId: caster.id, skillId, targetPos } },
        post
    );
    const receiverFx = snapshotFxKinds();

    const result: CaseResult = { hero: `${heroId}(${side})`, skillId, actorFx, receiverFx };
    if (actorFx.length === receiverFx.length) matched.push(result);
    else if (actorFx.length === 0 && receiverFx.length === 0) bothSilent.push(result);
    else mismatches.push(result);
}

describe('联机两端特效对称性扫描', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('每个英雄的每个技能，对端特效事件数应与行动方一致', () => {
        playSpy = vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined);
        fxWindow.length = 0;
        for (const heroId of AVAILABLE_HERO_IDS) {
            for (const skillId of [`${heroId}_skill1`, `${heroId}_skill2`]) {
                if (!getSkill(skillId)) continue;
                try {
                    evaluateCase(heroId, skillId, 'player1');
                } catch (error) {
                    mismatches.push({ hero: heroId, skillId, actorFx: [`抛错 ${String(error).slice(0, 60)}`], receiverFx: [] });
                }
            }
        }

        const report = [
            '',
            `一致 ${matched.length} 项，两端都无特效 ${bothSilent.length} 项，不一致 ${mismatches.length} 项`,
            ...mismatches.map(item => `  ✗ ${item.hero} ${item.skillId}\n      行动方 ${item.actorFx.length}: ${item.actorFx.join(' | ') || '无'}\n      对端   ${item.receiverFx.length}: ${item.receiverFx.join(' | ') || '无'}`),
        ].join('\n');
        console.log(report);

        expect(mismatches, `对端特效缺失/多出的用例：\n${report}`).toHaveLength(0);
    }, 120_000);
});
