import { HeroState, type Hero, type Position } from '../types/game';
import { RAGE_EFFECT } from './taunt';

/**
 * 英雄之间的持久连线视图解析（棋盘连线层唯一数据源）。
 *
 * 连线全部由"挂在目标身上的持续效果 + sourceHeroId 指回施法者"实时还原：
 * 效果存在即连线存在，断线、离场、到期都由效果自身的撤除逻辑负责，
 * 因此本地施法、联机快照与回放三处只需读棋盘，不必额外同步线本身。
 */

/** 连线种类：阳线金（友方增益）/ 阴线玄紫（敌方削弱）/ 血契赤红（强制锁敌） */
export type HeroLinkKind = 'yang' | 'yin' | 'rage';

export interface HeroLinkView {
    key: string;
    from: Position;
    to: Position;
    kind: HeroLinkKind;
    /** 连线长度（格距倍数，斜向为 √2） */
    length: number;
    /** 屏幕角度（CSS 顺时针 deg：0=右、90=下） */
    angleDeg: number;
}

function buildLink(
    casterCell: Position,
    targetCell: Position,
    casterId: string,
    targetId: string,
    kind: HeroLinkKind
): HeroLinkView {
    // 端点取"棋子实际所在格"，而不是英雄自带的 position 字段：
    // 位移类结算只要改过棋盘，线就必然跟着棋子走，不会留在旧格。
    const [fromRow, fromCol] = casterCell;
    const [toRow, toCol] = targetCell;
    return {
        key: `${casterId}-${kind}-${targetId}`,
        from: [fromRow, fromCol],
        to: [toRow, toCol],
        kind,
        length: Math.hypot(toRow - fromRow, toCol - fromCol),
        angleDeg: (Math.atan2(toRow - fromRow, toCol - fromCol) * 180) / Math.PI,
    };
}

function forEachOnBoardPair(
    board: (Hero | null)[][],
    visit: (caster: Hero, casterCell: Position, target: Hero, targetCell: Position) => void
): void {
    for (let row = 0; row < board.length; row++) {
        for (let col = 0; col < board[row].length; col++) {
            const caster = board[row][col];
            if (!caster || caster.state !== HeroState.ALIVE) continue;
            for (let targetRow = 0; targetRow < board.length; targetRow++) {
                for (let targetCol = 0; targetCol < board[targetRow].length; targetCol++) {
                    if (row === targetRow && col === targetCol) continue;
                    const target = board[targetRow][targetCol];
                    if (!target || target.state !== HeroState.ALIVE) continue;
                    visit(caster, [row, col], target, [targetRow, targetCol]);
                }
            }
        }
    }
}

/** 阴阳师的阴阳线：每个目标身上至多一金一紫两条 */
function resolveYinyangLinks(board: (Hero | null)[][], links: HeroLinkView[]): void {
    forEachOnBoardPair(board, (caster, casterCell, target, targetCell) => {
        if (caster.passiveId !== 'yinyang_passive') return;
        for (const effect of target.effects) {
            if (effect.sourceHeroId !== caster.id) continue;
            if (effect.name.startsWith('阳线')) {
                links.push(buildLink(casterCell, targetCell, caster.id, target.id, 'yang'));
            } else if (effect.name.startsWith('阴线')) {
                links.push(buildLink(casterCell, targetCell, caster.id, target.id, 'yin'));
            }
        }
    });
}

/** 血契的愤怒血线：绑缚者与每个被锁者之间一条，双方移动时线随之伸缩 */
function resolveRageLinks(board: (Hero | null)[][], links: HeroLinkView[]): void {
    forEachOnBoardPair(board, (binder, binderCell, target, targetCell) => {
        const bound = target.effects.some(effect =>
            effect.name === RAGE_EFFECT && effect.sourceHeroId === binder.id);
        if (bound) links.push(buildLink(binderCell, targetCell, binder.id, target.id, 'rage'));
    });
}

/** 棋盘上全部可见连线（供连线层一次性渲染）。
 *  同一对端点、同一类线可能由多条同名效果各还原出一份（如"阳线攻击/阳线免伤"），
 *  按 key 去重后每对只画一条，避免 DOM 重叠与 React 重复 key。 */
export function resolveHeroLinks(board: (Hero | null)[][]): HeroLinkView[] {
    const links: HeroLinkView[] = [];
    resolveYinyangLinks(board, links);
    resolveRageLinks(board, links);
    const seen = new Set<string>();
    return links.filter(link => {
        if (seen.has(link.key)) return false;
        seen.add(link.key);
        return true;
    });
}
