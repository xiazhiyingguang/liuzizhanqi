import { useGameStore } from '../store/game-store';

/**
 * 联机快照归一化与本地应用。
 * 从 useOnlineSync 中抽出为纯模块：联机回归测试需要直接驱动同一份逻辑，
 * 而不是在测试里复刻一份会漂移的实现。
 */

const isCloneHero = (hero: any) => {
    if (!hero) return false;
    if (hero?.counters?.['__isClone'] === 1) return true;
    if (typeof hero?.id === 'string' && (hero.id.startsWith('wukong-clone|') || hero.id.startsWith('mirror-clone|'))) {
        return true;
    }
    return false;
};

export function normalizeGameState(gameState: any) {
    if (!gameState) return gameState;
    const player1Heroes = Array.isArray(gameState.player1Heroes)
        ? gameState.player1Heroes.filter((h: any) => !isCloneHero(h))
        : [];
    const player2Heroes = Array.isArray(gameState.player2Heroes)
        ? gameState.player2Heroes.filter((h: any) => !isCloneHero(h))
        : [];
    const byId = new Map<string, any>();
    for (const hero of [...player1Heroes, ...player2Heroes]) {
        if (hero?.id) byId.set(hero.id, hero);
    }

    const board = Array.isArray(gameState.board)
        ? gameState.board.map((row: any[]) =>
            Array.isArray(row)
                ? row.map((cell: any) => {
                    if (!cell) return null;
                    // 真实死亡与暂时阵亡都不应再占据棋盘格：
                    // 暂时阵亡英雄在快照里仍带 position，若不清理会在对端"诈尸"成
                    // 0 血占位单位，还会挡住补员落位与移动路径。
                    if (cell?.state === 'dead' || cell?.state === 'temp_dead') return null;
                    const found = cell?.id ? byId.get(cell.id) : null;
                    if (found) {
                        if (!found.position && cell.position) found.position = cell.position;
                        return found;
                    }
                    if (cell?.id) byId.set(cell.id, cell);
                    return cell;
                })
                : row
        )
        : gameState.board;

    // 只有存活英雄才回填棋盘；暂时阵亡(0血)与真实死亡英雄一律不再回填，
    // 修复"对手出手后本方暂时阵亡英雄突然诈尸占位"的问题。
    for (const hero of byId.values()) {
        if (hero?.state !== 'alive') continue;
        if (!hero?.position || !Array.isArray(hero.position)) continue;
        const [r, c] = hero.position;
        if (board?.[r]?.[c] == null) {
            board[r][c] = hero;
        }
    }

    const ensureList = (list: any[], owner: 'player1' | 'player2') => {
        const existing = new Set(list.map(h => h?.id).filter(Boolean));
        for (const hero of byId.values()) {
            if (hero?.owner !== owner) continue;
            if (isCloneHero(hero)) continue;
            if (!existing.has(hero.id)) {
                list.push(hero);
                existing.add(hero.id);
            }
        }
    };

    ensureList(player1Heroes, 'player1');
    ensureList(player2Heroes, 'player2');

    const mapHero = (hero: any) => {
        if (!hero?.id) return hero ?? null;
        return byId.get(hero.id) || hero;
    };

    return {
        ...gameState,
        board,
        player1Heroes,
        player2Heroes,
        selectedHero: mapHero(gameState.selectedHero),
        activeHero: mapHero(gameState.activeHero)
    };
}

export function applyServerGameState(gameState: any) {
    if (!gameState) return;
    const normalized = normalizeGameState(gameState);
    const {
        localPlayerNumber: _lp,
        localPlayerName: _ln,
        isOnlineMode: _online,
        onlineRoomId: _room,
        ...rest
    } = normalized;
    useGameStore.setState(rest);
}
