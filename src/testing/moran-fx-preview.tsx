/**
 * 临时视觉验收台（墨阑·入道 + 为道常驻特效）：直接挂真实的 SkillFxVisual /
 * HeroStatusFx，不挂生命周期，于是事件不会被回收，可用 headless Chrome 的
 * --virtual-time-budget 把动画定格在任意时刻截图。验收完连同 moran-fx-preview.html 删除。
 */

/* eslint-disable react-refresh/only-export-components -- 临时视觉验收台：自挂载预览页，无导出属预期 */
import { createRoot } from 'react-dom/client';
import '../styles/ink-wash.css';
import { SkillFxVisual } from '../components/Game/SkillFxLayer';
import { HeroStatusFx } from '../components/Game/HeroStatusFx';
import { computeFxAngleDeg, computeFxDirection, resolveSkillFx, type SkillFxEvent } from '../core/skill-fx';
import { createHero } from '../data/heroes';
import type { Position } from '../types/game';

function makeEvent(fromPos: Position, targetPos: Position): SkillFxEvent {
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    return {
        id: 1,
        profile: resolveSkillFx('moran_skill1'),
        owner: 'player1',
        fromPos,
        targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        impactPositions: [targetPos],
        bornAt: 0,
    };
}

/** 与 Board.skillFxAtCell 同样的变体归属 */
function variantsFor(event: SkillFxEvent, cell: Position) {
    const same = (a: Position) => a[0] === cell[0] && a[1] === cell[1];
    const list: Array<'caster' | 'target' | 'impact'> = [];
    if (same(event.fromPos)) list.push('caster');
    if (same(event.targetPos)) list.push('target');
    else if ((event.impactPositions ?? []).some(same)) list.push('impact');
    return list;
}

const EVENTS: SkillFxEvent[] = [
    makeEvent([1, 1], [1, 2]),   // 真实几何：十字相邻一格
    makeEvent([3, 1], [3, 3]),   // 两格外：检查墨痕按距离铺满
    makeEvent([5, 1], [4, 2]),   // 斜向：检查攻击轴旋转
];

function wayPiece(label: string, hits: number) {
    const hero = createHero('moran', 'player1', [0, 0]);
    hero.effects = [{
        id: 'moran-preview-weidao',
        type: 'buff',
        name: '为道',
        duration: -1,
        description: '',
        sourceHeroId: 'moran-player1-1',
    }];
    hero.counters['为道受击'] = hits;
    return (
        <span className="mw-demo-piece" data-label={label}>
            <HeroStatusFx hero={hero} />
        </span>
    );
}

function Preview() {
    const rows = [0, 1, 2, 3, 4, 5];
    const cols = [0, 1, 2, 3, 4];
    const pieces: Record<string, ReturnType<typeof wayPiece>> = {
        '0,1': wayPiece('为道 0/2', 0),
        '0,3': wayPiece('为道 1/2', 1),
    };
    return (
        <div className="battle-board-stage" style={{ padding: 48 }}>
            <div className="battle-board-grid">
                {rows.map(row => cols.map(col => {
                    const cell: Position = [row, col];
                    return (
                        <div key={`${row}-${col}`} className="battle-board-cell cell-ground"
                             style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {pieces[`${row},${col}`] ?? (row > 0 && col === 1 && row % 2 === 1
                                ? <span className="mw-demo-piece mw-demo-plain" />
                                : null)}
                            {EVENTS.flatMap(event => variantsFor(event, cell).map(variant => (
                                <SkillFxVisual key={`${event.fromPos}-${event.targetPos}-${variant}`}
                                               event={event} variant={variant} atPos={cell} />
                            )))}
                        </div>
                    );
                }))}
            </div>
            <style>{`
                .mw-demo-piece {
                    position: relative;
                    width: 56%;
                    height: 56%;
                    border-radius: 50%;
                    background: radial-gradient(circle at 40% 35%, #6f7f8f, #2f3a46);
                    color: #fff;
                    font-size: 11px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .mw-demo-plain { background: radial-gradient(circle at 40% 35%, #8f6f6f, #46302f); }
                .mw-demo-piece::after {
                    content: attr(data-label);
                    position: absolute;
                    left: 50%;
                    top: 104%;
                    transform: translateX(-50%);
                    font-size: 10px;
                    color: #6b6152;
                    white-space: nowrap;
                }
            `}</style>
        </div>
    );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<Preview />);
