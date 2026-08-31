/**
 * 临时视觉验收台（AOE 多格特效）：直接挂载真实的 SkillFxVisual，
 * 但不挂 SkillFxLifecycle，于是事件不会被回收，可把动画冻结在任意时刻逐帧截图。
 * 验收完毕连同 fx-aoe-preview.html 一并删除。
 */

/* eslint-disable react-refresh/only-export-components -- 临时视觉验收台：自挂载预览页，无导出属预期 */
import { createRoot } from 'react-dom/client';
import '../styles/ink-wash.css';
import { SkillFxVisual } from '../components/Game/SkillFxLayer';
import { computeFxAngleDeg, computeFxDirection, resolveSkillFx, type SkillFxEvent } from '../core/skill-fx';
import type { Position } from '../types/game';

function makeEvent(
    skillId: string,
    fromPos: Position,
    targetPos: Position,
    extra: Partial<SkillFxEvent>
): SkillFxEvent {
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    return {
        id: 1,
        profile: resolveSkillFx(skillId),
        owner: 'player1',
        fromPos,
        targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        bornAt: 0,
        ...extra,
    };
}

/** 与 Board.skillFxAtCell 同样的变体归属：主格=target，命中格=impact，其余作用格=area */
function variantsFor(event: SkillFxEvent, cell: Position) {
    const same = (a: Position) => a[0] === cell[0] && a[1] === cell[1];
    const list: Array<'target' | 'impact' | 'area'> = [];
    if (same(event.targetPos)) list.push('target');
    else if ((event.impactPositions ?? []).some(same)) list.push('impact');
    else if ((event.coveredPositions ?? []).some(same)) list.push('area');
    return list;
}

const EVENTS: SkillFxEvent[] = [
    // 法阵/控制类：主格出本体，其余命中格出轻量印记（其中 [1,4] 为柔光受益格）
    makeEvent('zhenxiao_skill2', [2, 1], [2, 3], {
        impactPositions: [[2, 3], [2, 4], [1, 4]],
        softImpactPositions: [[1, 4]],
        coveredPositions: [[1, 2], [1, 3], [1, 4], [2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4]],
    }),
    // 命中特写类：每个命中格各出一份完整主效
    makeEvent('skeletonking_skill1', [4, 1], [4, 2], {
        impactPositions: [[4, 2], [5, 2], [4, 3]],
        coveredPositions: [[3, 1], [3, 2], [3, 3], [4, 1], [4, 2], [4, 3], [5, 1], [5, 2], [5, 3]],
    }),
    // 绯雪：技能2踏雪追命（主格特写）与技能1破冰爆震形态（主格+区域冰棱）
    makeEvent('feixue_skill2', [2, 2], [2, 3], {
        impactPositions: [[2, 3]],
    }),
    makeEvent('feixue_skill1', [4, 1], [5, 4], {
        impactPositions: [[5, 4], [5, 3], [4, 4]],
        coveredPositions: [[4, 3], [4, 4], [4, 5], [5, 3], [5, 4], [5, 5]],
    }),
];

const PIECES: Record<string, string> = {
    '2,3': '墨阑', '2,4': '回锋', '1,4': '白泽', '4,2': '琉璃', '5,2': '上官婉儿', '4,3': '帝兰',
};

function Preview() {
    const rows = [1, 2, 3, 4, 5];
    const cols = [1, 2, 3, 4, 5];
    return (
        <div className="battle-board-stage" style={{ padding: 48 }}>
            <div className="battle-board-grid">
                {rows.map(row => cols.map(col => {
                    const cell: Position = [row, col];
                    return (
                        <div key={`${row}-${col}`} className="battle-board-cell cell-ground"
                             style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {PIECES[`${row},${col}`] && (
                                <span style={{
                                    position: 'relative', width: '56%', height: '56%', borderRadius: '50%',
                                    background: 'radial-gradient(circle at 40% 35%, #6f7f8f, #2f3a46)',
                                    color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>{PIECES[`${row},${col}`]}</span>
                            )}
                            {EVENTS.flatMap(event => variantsFor(event, cell).map(variant => (
                                <SkillFxVisual key={`${event.profile.kind}-${variant}`} event={event} variant={variant} atPos={cell} />
                            )))}
                        </div>
                    );
                }))}
            </div>
        </div>
    );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<Preview />);

declare global {
    interface Window {
        freezeAt: (t: number) => number;
    }
}
window.freezeAt = (t: number) => {
    const anims = document.getAnimations().filter(a =>
        (a.effect as KeyframeEffect | null)?.target?.closest?.('.skill-fx'));
    anims.forEach(a => { a.pause(); a.currentTime = t; });
    return anims.length;
};
