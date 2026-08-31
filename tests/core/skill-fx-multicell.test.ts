import { describe, expect, it } from 'vitest';
import type { BattleLogEntry } from '../../src/types/game';
import {
    collectImpactPositions,
    computeFxCellDelayMs,
    computeFxTailMs,
    isPerTargetFxKind,
    resolveSkillFx,
    type SkillFxEvent,
} from '../../src/core/skill-fx';
import { computeFxCoveredPositions } from '../../src/core/skill-fx-coverage';
import { getSkill } from '../../src/data/skills';

/** 造一条战斗日志：只需 type 与 details.position 参与采集 */
function logEntry(
    type: BattleLogEntry['type'],
    position?: [number, number]
): BattleLogEntry {
    return {
        id: `log-${type}-${position?.join(',') ?? 'none'}`,
        timestamp: 0,
        type,
        player: 'player1',
        message: '测试日志',
        details: position ? { kind: type, position } : { kind: type },
    };
}

/** 造一条特效事件：只有多格字段参与尾时长计算 */
function fxEvent(overrides: Partial<SkillFxEvent>): SkillFxEvent {
    return {
        id: 1,
        profile: resolveSkillFx('moran_skill2'),
        owner: 'player1',
        fromPos: [2, 1],
        targetPos: [2, 2],
        angleDeg: 0,
        direction: 'E',
        bornAt: 0,
        ...overrides,
    };
}

describe('collectImpactPositions', () => {
    it('按 damage/heal 日志逐格采集命中，同格多次伤害只算一格', () => {
        const { impactPositions } = collectImpactPositions([
            logEntry('damage', [2, 2]),
            logEntry('damage', [2, 2]),
            logEntry('damage', [2, 3]),
        ], [2, 2]);
        expect(impactPositions).toEqual([[2, 2], [2, 3]]);
    });

    it('忽略不带位置的日志类型（闪避只记 passive、system 提示、effect 无格）', () => {
        const { impactPositions } = collectImpactPositions([
            logEntry('system'),
            logEntry('passive'),
            logEntry('effect'),
            logEntry('move', [2, 4]),
        ], [2, 2]);
        expect(impactPositions).toBeUndefined();
    });

    it('越界与非数组 position 的脏数据不入格', () => {
        const dirty: BattleLogEntry = {
            id: 'dirty',
            timestamp: 0,
            type: 'damage',
            player: 'player1',
            message: '脏数据',
            details: { position: [9, 9] },
        };
        const notArray: BattleLogEntry = {
            ...dirty,
            id: 'dirty-2',
            details: { position: '2,3' },
        };
        expect(collectImpactPositions([dirty, notArray], [2, 2]).impactPositions).toBeUndefined();
    });

    it('按距主目标的切比雪夫距离升序排，斜向与正向同距', () => {
        const { impactPositions } = collectImpactPositions([
            logEntry('damage', [0, 0]),
            logEntry('damage', [2, 4]),
            logEntry('damage', [3, 3]),
            logEntry('damage', [1, 3]),
        ], [2, 2]);
        expect(impactPositions).toBeDefined();
        const steps = impactPositions!.map(cell => computeFxCellDelayMs([2, 2], cell!));
        // 距 [2,2]：(3,3) 与 (1,3) 各 1 格，(0,0) 与 (2,4) 各 2 格；同距保持日志原序
        expect(steps).toEqual([45, 45, 90, 90]);
    });

    it('全场技命中过多单位时截断到最近的一批', () => {
        const many = Array.from({ length: 12 }, (_, index) =>
            logEntry('damage', [index % 6, Math.floor(index / 6)])
        );
        const { impactPositions } = collectImpactPositions(many, [0, 0]);
        expect(impactPositions).toHaveLength(8);
    });

    it('治疗来源单独标记为柔光受益格，且只保留截断后仍在的格', () => {
        const { impactPositions, softImpactPositions } = collectImpactPositions([
            logEntry('damage', [2, 2]),
            logEntry('heal', [1, 2]),
            logEntry('heal', [3, 2]),
        ], [2, 2]);
        expect(impactPositions).toHaveLength(3);
        expect(softImpactPositions).toEqual([[1, 2], [3, 2]]);
    });
});

describe('computeFxCellDelayMs / computeFxTailMs', () => {
    it('主目标格零延迟，每远一格加一档', () => {
        expect(computeFxCellDelayMs([2, 2], [2, 2])).toBe(0);
        expect(computeFxCellDelayMs([2, 2], [2, 3])).toBe(45);
        expect(computeFxCellDelayMs([2, 2], [1, 1])).toBe(45);   // 斜向同距
        expect(computeFxCellDelayMs([2, 2], [0, 0])).toBe(90);
        // 6x6 棋盘上最远的一档：对角 5 格，仍远在最短档案时长之内
        expect(computeFxCellDelayMs([0, 0], [5, 5])).toBe(225);
    });

    it('单格事件不需要额外存活时长', () => {
        expect(computeFxTailMs(fxEvent({}))).toBe(0);
    });

    it('多格波浪时长按最远格延迟追加', () => {
        const tail = computeFxTailMs(fxEvent({
            impactPositions: [[2, 2], [0, 0]],
        }));
        expect(tail).toBe(90 + 140);
    });

    it('区域底光格也纳入尾时长（底光同样按格延后起播）', () => {
        const tail = computeFxTailMs(fxEvent({
            coveredPositions: [[2, 2], [5, 5]],
        }));
        expect(tail).toBe(135 + 140);
    });
});

describe('isPerTargetFxKind', () => {
    it('命中特写类原型每格各出一份主效', () => {
        for (const skillId of ['moran_skill2', 'skeletonking_skill1', 'huifeng_skill1', 'guying_skill2']) {
            expect(isPerTargetFxKind(resolveSkillFx(skillId).kind), skillId).toBe(true);
        }
    });

    it('法阵/领域/增益类只在主格出本体，其余格退回印记', () => {
        for (const skillId of ['moran_skill1', 'hanjiangxue_skill1', 'liuli_skill1', 'xuanxiao_skill2', 'wukong_skill1']) {
            expect(isPerTargetFxKind(resolveSkillFx(skillId).kind), skillId).toBe(false);
        }
    });
});

describe('computeFxCoveredPositions', () => {
    it('区域技铺出以主目标为中心的 N 宫格（含中心格）', () => {
        const cells = computeFxCoveredPositions(
            getSkill('zhenxiao_skill2'), [2, 1], [2, 2], resolveSkillFx('zhenxiao_skill2')
        );
        expect(cells).toHaveLength(9);
        expect(cells).toContainEqual([2, 2]);
        expect(cells).toContainEqual([1, 1]);
        expect(cells).toContainEqual([3, 3]);
    });

    it('贴边时按界内裁剪，不产生越界格', () => {
        const cells = computeFxCoveredPositions(
            getSkill('zhenxiao_skill2'), [0, 0], [0, 0], resolveSkillFx('zhenxiao_skill2')
        );
        expect(cells).toHaveLength(4);   // 角上 3x3 只剩 2x2
        for (const [row, col] of cells) {
            expect(row).toBeGreaterThanOrEqual(0);
            expect(col).toBeGreaterThanOrEqual(0);
        }
    });

    it('直线技沿施法者朝向铺开，不铺施法者所在格', () => {
        const cells = computeFxCoveredPositions(
            getSkill('libai_skill2'), [2, 0], [2, 3], resolveSkillFx('libai_skill2')
        );
        expect(cells.every(([row, col]) => row === 2 && col > 0)).toBe(true);
        expect(cells).not.toContainEqual([2, 0]);
    });

    it('斜向点选的直线技退化成主目标 3x3，不会出现空轮廓', () => {
        const cells = computeFxCoveredPositions(
            getSkill('libai_skill2'), [2, 0], [3, 1], resolveSkillFx('libai_skill2')
        );
        expect(cells).toHaveLength(9);
    });

    it('单体点选与召唤类技能不铺底光', () => {
        for (const skillId of ['wukong_skill1', 'shangguan_skill1', 'lilith_skill1']) {
            expect(computeFxCoveredPositions(getSkill(skillId), [2, 1], [2, 2], resolveSkillFx(skillId)), skillId)
                .toEqual([]);
        }
    });

    it('引擎带特判展开的技能由档案 fxArea 接管实际形状', () => {
        // 寒江雪技能一与薛定谔技能一名义 line，实际是点击格 3x3
        for (const skillId of ['hanjiangxue_skill1', 'schrodinger_skill1']) {
            expect(resolveSkillFx(skillId).fxArea, skillId).toBe(3);
            expect(computeFxCoveredPositions(getSkill(skillId), [2, 0], [2, 2], resolveSkillFx(skillId)))
                .toHaveLength(9);
        }
        // 震霄技能一实际是面前横排 3 格
        expect(resolveSkillFx('zhenxiao_skill1').fxArea).toBe('bar');
        expect(computeFxCoveredPositions(getSkill('zhenxiao_skill1'), [2, 1], [2, 2], resolveSkillFx('zhenxiao_skill1')))
            .toEqual([[1, 2], [2, 2], [3, 2]]);
    });
});
