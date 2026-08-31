import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillSystem } from '../../src/core/skill-system';
import { resolveSkillFx } from '../../src/core/skill-fx';
import { computeFxCoveredPositions as deriveCovered } from '../../src/core/skill-fx-coverage';
import { SKILLS } from '../../src/data/skills';
import type { Hero, GameState, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * AOE 特效作用区防漂移回归。
 *
 * 判据只有一条：**这一手真实作用到的格子，必须都被特效作用区罩住**。
 * 作用区优先取技能 execute 自报的 fxCoveredPositions，其次引擎展开群体范围时用的
 * 那份格子，两者都没有才回退 skill-fx-coverage 的静态几何推导。
 * 谁把圈画小了，这里会直接点名到技能，不必再靠人工逐个比对。
 */
const CASTABLE_ID = /^.+_skill[12]$/;

/** 需要先选方向的技能：不设方向就永远放不出来 */
const PREP: Record<string, Array<(caster: Hero) => void>> = {
    dilan_skill2: [caster => { caster.counters['__dilan_skill2_dir'] = 3; }],
    libai_skill2: [caster => {
        caster.counters['__libai_skill2_dir'] = 3;
        caster.counters['醉意'] = 3;
    }],
    lingxi_skill2: [caster => { caster.counters['__lingxi_skill2_dir'] = 3; }],
    guying_skill1: [caster => { caster.counters['__guying_skill1_dir'] = 3; }],
    zuizhendao_skill1: [caster => { caster.counters['__zuizhendao_skill1_dir'] = 3; }],
    youjun_skill1: [caster => { caster.counters['__youjun_skill1_dir'] = 3; }],
};

interface CastOutcome {
    caster: Hero;
    casterCell: Position | null;
    target: Position;
    covered: Position[];
    /** 有空间后果的格：区域必须罩住它们 */
    hit: Position[];
    /** 任何被改动的格（含给自家挂的纯增益） */
    touched: Position[];
    before: Snapshot;
    after: Snapshot;
}

/** 全量快照：按格记录能反映"这一手动过谁"的状态 */
interface CellState {
    hp: number;
    shield: number;
    state: string;
    effects: string;
    /** 该单位是否属于施法者阵营：给自家单位挂 buff 往往是全团规则，不是空间作用 */
    ownTeam: boolean;
}

type Snapshot = Map<string, CellState>;

function cellKey(cell: Position): string {
    return `${cell[0]}:${cell[1]}`;
}

function snapshot(state: GameState, caster: Hero): Snapshot {
    const cells: Snapshot = new Map();
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        if (!hero.position) continue;
        cells.set(cellKey(hero.position), {
            hp: hero.currentHp,
            shield: hero.shield,
            state: hero.state,
            effects: hero.effects.map(effect => `${effect.name}×${effect.stackCount ?? 1}`).join('|'),
            ownTeam: hero.owner === caster.owner,
        });
    }
    return cells;
}

function sameCell(before: CellState | undefined, after: CellState | undefined): boolean {
    if (!before || !after) return before === after;
    return before.hp === after.hp && before.shield === after.shield
        && before.state === after.state && before.effects === after.effects;
}

/**
 * 这一手"真实作用到"的格子。
 *
 * 只算有空间后果的变化：生命/护盾/存活状态变了，或给敌方挂了效果（标记、减速、诅咒）。
 * 纯粹给自家单位挂 buff 不算——像「缚魂吸血」那种全团规则增益不落在任何区域上，
 * 要求 AOE 底光罩住它会把断言变成噪音。
 */
function diffCells(before: Snapshot, after: Snapshot): { spatial: Position[]; touched: Position[] } {
    const spatial: Position[] = [];
    const touched: Position[] = [];
    for (const [key, value] of before) {
        const next = after.get(key);
        if (sameCell(value, next)) continue;
        const [row, col] = key.split(':').map(Number);
        touched.push([row, col]);
        const isSpatial = value.hp !== next?.hp
            || value.shield !== next?.shield
            || value.state !== next?.state
            || value.effects !== next?.effects && !value.ownTeam;
        if (isSpatial) spatial.push([row, col]);
    }
    return { spatial, touched };
}

/** 在一块塞满单位的棋盘上试着放出这个技能；放不出来就返回 null（不计入断言） */
function castOnPopulatedBoard(skillId: string): CastOutcome | null {
    const heroId = skillId.replace(/_skill[12]$/, '');
    const slot = (skillId.endsWith('skill1') ? 'skill1Id' : 'skill2Id') as 'skill1Id' | 'skill2Id';
    const preps: Array<(caster: Hero) => void> = [() => undefined, ...(PREP[skillId] ?? [])];

    for (const prep of preps) {
        const state = makeGameState();
        let caster: Hero;
        try {
            caster = addHero(state, heroId, 'player1', [2, 2]);
        } catch {
            return null;
        }
        if (caster[slot] !== skillId) return null;
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                if (row === 2 && col === 2) continue;
                if (row <= 1) addHero(state, 'baize', 'player1', [row, col]);
                else if (row >= 3) addHero(state, 'liuli', 'player2', [row, col]);
            }
        }
        prep(caster);

        for (const target of [[3, 2], [2, 3], [3, 3], [2, 2], [1, 2], [2, 1]] as Position[]) {
            const skill = SKILLS[skillId];
            if (!skill) return null;
            const casterCell = caster.position ? ([...caster.position] as Position) : null;
            const before = snapshot(state, caster);
            const result = SkillSystem.executeSkill(caster, skill, [target], state);
            if (!result.success) continue;
            const after = snapshot(state, caster);
            const covered = result.fxCoveredPositions
                ?? deriveCovered(skill, casterCell ?? target, target, resolveSkillFx(skillId)) ?? [];
            const diff = diffCells(before, after);
            return {
                caster,
                casterCell,
                target,
                covered,
                hit: diff.spatial,
                touched: diff.touched,
                before,
                after,
            };
        }
    }
    return null;
}

const SKILL_IDS = Object.keys(SKILLS).filter(id => CASTABLE_ID.test(id));

/**
 * 点击单格、真实作用却是一片格的特例：引擎按单体选点，
 * 只有技能自己上报才有区域表现，因此也纳入"必须铺作用区"的检查。
 */
const SELF_REPORTED_REGIONAL = ['hero_x_skill2', 'soul_lamp_skill1', 'fengling_skill2', 'youjun_skill2'];

describe('AOE 特效作用区与结算一致', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('画了作用区就必须罩住真实作用格', () => {
        const offenders: string[] = [];
        let checked = 0;
        for (const skillId of SKILL_IDS) {
            const skill = SKILLS[skillId]!;
            // 全场技走整盘 areaBounds，本就不铺区域格
            if (skill.rangeType === '全场') continue;
            const outcome = castOnPopulatedBoard(skillId);
            if (!outcome || outcome.covered.length === 0) continue;
            checked++;
            const coveredKeys = new Set(outcome.covered.map(cellKey));
            // 施法者本格由起手格变体负责表现，不要求区域罩住
            const selfKey = outcome.casterCell ? cellKey(outcome.casterCell) : '';
            const escaped = outcome.hit.filter(cell => {
                const key = cellKey(cell);
                return key !== selfKey && !coveredKeys.has(key);
            });
            if (escaped.length > 0) {
                const detail = escaped.map(cell => {
                    const key = cellKey(cell);
                    const label = (value?: CellState) => value
                        ? `HP${value.hp} 盾${value.shield} ${value.state}${value.effects ? ` ${value.effects}` : ''}`
                        : '离场';
                    return `${key}[${label(outcome.before.get(key))} → ${label(outcome.after.get(key))}]`;
                }).join(' ');
                offenders.push(`${skillId}：漏罩 ${detail}`);
            }
        }
        expect(checked, '这张网必须真的覆盖到一批技能').toBeGreaterThan(10);
        expect(offenders, `以下技能的作用区小于实际作用范围：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('范围型技能打到两格以上时必须铺出作用区', () => {
        const offenders: string[] = [];
        for (const skillId of SKILL_IDS) {
            const skill = SKILLS[skillId]!;
            const isGroupTargeting = skill.targetCount === 'all'
                && ['area', 'cross', 'line'].includes(skill.rangeType);
            if (!isGroupTargeting && !SELF_REPORTED_REGIONAL.includes(skillId)) continue;
            const outcome = castOnPopulatedBoard(skillId);
            if (!outcome || outcome.hit.length < 2) continue;
            if (outcome.covered.length === 0) {
                offenders.push(`${skillId}：打到 ${outcome.hit.length} 格却没铺作用区`);
            }
        }
        expect(offenders, `以下 AOE 完全没有区域表现：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('前方矩形类技能以施法者为基准，不再画成点击格附近的一条线', () => {
        for (const skillId of ['dilan_skill2', 'libai_skill2', 'lingxi_skill2']) {
            const outcome = castOnPopulatedBoard(skillId);
            if (!outcome) continue;
            const [casterRow, casterCol] = outcome.caster.position!;
            // 前方 2×3 矩形紧贴施法者：至少有一格与施法者相邻
            const touchesCaster = outcome.covered.some(
                ([row, col]) => Math.abs(row - casterRow) <= 1 && Math.abs(col - casterCol) <= 1
            );
            expect(touchesCaster, `${skillId} 的作用区应紧贴施法者前方`).toBe(true);
            expect(outcome.covered.length, `${skillId} 的作用区应是 2×3 而非 2 格直线`).toBeGreaterThan(2);
        }
    });

    it('以自己为中心的场（金银错/暗夜法阵/沙丘/四向风刃）罩住自身周围', () => {
        for (const skillId of ['zhenxiao_skill2', 'soul_lamp_skill1', 'fengling_skill2', 'youjun_skill2']) {
            const outcome = castOnPopulatedBoard(skillId);
            if (!outcome) continue;
            const coveredKeys = new Set(outcome.covered.map(cellKey));
            expect(
                coveredKeys.has(cellKey(outcome.caster.position!)) || skillId === 'youjun_skill2',
                `${skillId} 的作用区应包含施法者周围`
            ).toBe(true);
            expect(outcome.covered.length, `${skillId} 只画了单格，场没铺开`).toBeGreaterThan(1);
        }
    });

    it('离散目标技能（终焉斩/来财）不再被铺成整片区域', () => {
        for (const skillId of ['jetzmi_skill1', 'wangcai_skill2']) {
            const outcome = castOnPopulatedBoard(skillId);
            if (!outcome) continue;
            // 斩 1~2 个离散目标、给 1~2 名友方挂增益：作用区不应超过 2 格
            expect(outcome.covered.length, `${skillId} 是离散目标技能，不该铺区域`).toBeLessThanOrEqual(2);
            const touchedKeys = new Set(outcome.touched.map(cellKey));
            for (const cell of outcome.covered) {
                expect(touchedKeys.has(cellKey(cell)), `${skillId} 上报了没作用到的格子`).toBe(true);
            }
        }
    });

    it('兜底推导出的作用格不会越出棋盘', () => {
        for (const skillId of SKILL_IDS) {
            const skill = SKILLS[skillId]!;
            const cells = deriveCovered(skill, [0, 0], [5, 5], resolveSkillFx(skillId)) ?? [];
            for (const [row, col] of cells) {
                expect(row, `${skillId} 推导越界`).toBeGreaterThanOrEqual(0);
                expect(row, `${skillId} 推导越界`).toBeLessThan(6);
                expect(col, `${skillId} 推导越界`).toBeGreaterThanOrEqual(0);
                expect(col, `${skillId} 推导越界`).toBeLessThan(6);
            }
        }
    });
});
