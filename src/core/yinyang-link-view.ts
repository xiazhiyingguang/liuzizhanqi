import { HeroState, type Hero, type Position } from '../types/game';

/**
 * 阴阳师的阴阳线持久连接视图解析。
 *
 * 阳线/阴线是挂在目标身上的持续效果（名以「阳线」「阴线」开头、
 * sourceHeroId 指回阴阳师），连接的存断完全由效果本身决定——
 * 距离超出两格断线、阴阳师离场消散都会同步移除效果，
 * 因此这里只读棋盘即可还原当前所有可见连线。
 */

export interface YinyangLinkView {
    key: string;
    from: Position;
    to: Position;
    /** yang=金色阳线（友方增益），yin=玄紫阴线（敌方削弱） */
    kind: 'yang' | 'yin';
    /** 连线长度（格距倍数，斜向为 √2） */
    length: number;
    /** 屏幕角度（CSS 顺时针 deg：0=右、90=下） */
    angleDeg: number;
}

function isAliveOnBoard(hero: Hero, row: number, col: number): boolean {
    if (hero.state !== HeroState.ALIVE || !hero.position) return false;
    const [r, c] = hero.position;
    return r === row && c === col;
}

/** 解析棋盘上全部可见的阴阳线连接（每个阴阳师与每个目标最多一金一紫两条） */
export function resolveYinyangLinks(board: (Hero | null)[][]): YinyangLinkView[] {
    const links: YinyangLinkView[] = [];
    for (let row = 0; row < board.length; row++) {
        for (let col = 0; col < board[row].length; col++) {
            const caster = board[row][col];
            if (!caster || !isAliveOnBoard(caster, row, col)) continue;
            if (caster.passiveId !== 'yinyang_passive') continue;

            for (let targetRow = 0; targetRow < board.length; targetRow++) {
                for (let targetCol = 0; targetCol < board[targetRow].length; targetCol++) {
                    if (targetRow === row && targetCol === col) continue;
                    const target = board[targetRow][targetCol];
                    if (!target || !isAliveOnBoard(target, targetRow, targetCol)) continue;

                    const hasYang = target.effects.some(effect =>
                        effect.name.startsWith('阳线') && effect.sourceHeroId === caster.id
                    );
                    const hasYin = target.effects.some(effect =>
                        effect.name.startsWith('阴线') && effect.sourceHeroId === caster.id
                    );
                    if (!hasYang && !hasYin) continue;

                    const length = Math.hypot(targetRow - row, targetCol - col);
                    const angleDeg = (Math.atan2(targetRow - row, targetCol - col) * 180) / Math.PI;
                    const base = {
                        from: [row, col] as Position,
                        to: [targetRow, targetCol] as Position,
                        length,
                        angleDeg,
                    };
                    if (hasYang) {
                        links.push({
                            ...base,
                            key: `${caster.id}-yang-${target.id}`,
                            kind: 'yang',
                        });
                    }
                    if (hasYin) {
                        links.push({
                            ...base,
                            key: `${caster.id}-yin-${target.id}`,
                            kind: 'yin',
                        });
                    }
                }
            }
        }
    }
    return links;
}
