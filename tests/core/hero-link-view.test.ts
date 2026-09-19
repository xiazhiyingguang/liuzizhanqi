import { describe, expect, it } from 'vitest';
import { createHero } from '../../src/data/heroes';
import { resolveHeroLinks } from '../../src/core/hero-link-view';
import { emptyBoard } from '../helpers/game-state';

function place(heroId: string, owner: 'player1' | 'player2', position: [number, number]) {
    const hero = createHero(heroId, owner, position);
    return hero;
}

describe('resolveHeroLinks（阴阳线部分）', () => {
    it('无阴阳师时返回空列表', () => {
        const board = emptyBoard();
        board[2][2] = place('moran', 'player1', [2, 2]);
        expect(resolveHeroLinks(board)).toEqual([]);
    });

    it('阳线与阴线各自生成一条连接（金/紫）', () => {
        const board = emptyBoard();
        const yinyang = place('yinyang', 'player1', [2, 2]);
        const ally = place('moran', 'player1', [2, 3]);
        const enemy = place('baize', 'player2', [3, 2]);
        ally.effects.push({
            id: 'e-yang', type: 'buff', name: '阳线攻击', duration: -1,
            value: 0.2, sourceHeroId: yinyang.id, description: '',
        });
        enemy.effects.push({
            id: 'e-yin', type: 'debuff', name: '阴线攻击降低', duration: -1,
            value: 0.2, sourceHeroId: yinyang.id, description: '',
        });
        board[2][2] = yinyang;
        board[2][3] = ally;
        board[3][2] = enemy;

        const links = resolveHeroLinks(board);
        expect(links).toHaveLength(2);
        const yang = links.find(link => link.kind === 'yang');
        const yin = links.find(link => link.kind === 'yin');
        expect(yang?.from).toEqual([2, 2]);
        expect(yang?.to).toEqual([2, 3]);
        expect(yang?.angleDeg).toBe(0);
        expect(yin?.to).toEqual([3, 2]);
        expect(yin?.angleDeg).toBe(90);
    });

    it('连接几何覆盖斜向：角度与长度按格距倍数计算', () => {
        const board = emptyBoard();
        const yinyang = place('yinyang', 'player1', [1, 1]);
        const enemy = place('baize', 'player2', [2, 2]);
        enemy.effects.push({
            id: 'e-yin', type: 'debuff', name: '阴线防御降低', duration: -1,
            value: 0.2, sourceHeroId: yinyang.id, description: '',
        });
        board[1][1] = yinyang;
        board[2][2] = enemy;

        const links = resolveHeroLinks(board);
        expect(links).toHaveLength(1);
        expect(links[0].kind).toBe('yin');
        expect(links[0].length).toBeCloseTo(Math.SQRT2, 5);
        expect(links[0].angleDeg).toBe(45);
    });

    it('来源不是该阴阳师的效果不产生连线，离场阴阳师不参与', () => {
        const board = emptyBoard();
        const yinyang = place('yinyang', 'player1', [0, 0]);
        const ally = place('moran', 'player1', [0, 1]);
        ally.effects.push({
            id: 'e-yang', type: 'buff', name: '阳线攻击', duration: -1,
            value: 0.2, sourceHeroId: 'other-yinyang', description: '',
        });
        board[0][0] = yinyang;
        board[0][1] = ally;
        expect(resolveHeroLinks(board)).toEqual([]);

        // 阴阳师已离场（不在棋盘上）后连线消失：效果虽挂在 ally 身上，但找不到施法者
        const board2 = emptyBoard();
        board2[0][1] = ally;
        expect(resolveHeroLinks(board2)).toEqual([]);
    });

    it('端点锚在棋子所在格：position 滞后于棋盘时，线依然跟着棋子走', () => {
        const board = emptyBoard();
        const yinyang = place('yinyang', 'player1', [2, 2]);
        const ally = place('moran', 'player1', [2, 3]);
        ally.effects.push({
            id: 'e-yang', type: 'buff', name: '阳线攻击', duration: -1,
            value: 0.2, sourceHeroId: yinyang.id, description: '',
        });
        // 强行移位后棋子落在 (0,5)，但英雄身上的 position 仍停在旧格
        board[2][2] = yinyang;
        board[0][5] = ally;
        ally.position = [2, 3];

        const links = resolveHeroLinks(board);
        expect(links).toHaveLength(1);
        expect(links[0].to, '线的另一端必须跟着棋子').toEqual([0, 5]);
        expect(links[0].length).toBeCloseTo(Math.hypot(2, 3), 5);
    });
});
