import { useGameStore } from '../store/game-store';
import { HeroState } from '../types/game';

interface E2EHeroSnapshot {
    id: string;
    name: string;
    owner: 'player1' | 'player2';
    position: [number, number] | null;
    state: HeroState;
    currentHp: number;
}

interface E2EGameSnapshot {
    phase: ReturnType<typeof useGameStore.getState>['phase'];
    currentPlayer: ReturnType<typeof useGameStore.getState>['currentPlayer'];
    selectingPlayer: ReturnType<typeof useGameStore.getState>['selectingPlayer'];
    roundNumber: number;
    localPlayerNumber?: number;
    onlineRoomId?: string;
    player1SelectedHeroIds: string[];
    player2SelectedHeroIds: string[];
    player1ReadyHeroSelect: boolean;
    player2ReadyHeroSelect: boolean;
    player1ReadyDeploy: boolean;
    player2ReadyDeploy: boolean;
    heroes: E2EHeroSnapshot[];
}

declare global {
    interface Window {
        __SIX_CHESS_E2E__?: {
            snapshot: () => E2EGameSnapshot;
            prepareFinalStrike: () => boolean;
        };
    }
}

function snapshot(): E2EGameSnapshot {
    const state = useGameStore.getState();
    return {
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        selectingPlayer: state.selectingPlayer,
        roundNumber: state.roundNumber,
        localPlayerNumber: state.localPlayerNumber,
        onlineRoomId: state.onlineRoomId,
        player1SelectedHeroIds: [...state.player1SelectedHeroIds],
        player2SelectedHeroIds: [...state.player2SelectedHeroIds],
        player1ReadyHeroSelect: state.player1ReadyHeroSelect,
        player2ReadyHeroSelect: state.player2ReadyHeroSelect,
        player1ReadyDeploy: state.player1ReadyDeploy,
        player2ReadyDeploy: state.player2ReadyDeploy,
        heroes: [...state.player1Heroes, ...state.player2Heroes].map(hero => ({
            id: hero.id,
            name: hero.name,
            owner: hero.owner,
            position: hero.position ? [...hero.position] as [number, number] : null,
            state: hero.state,
            currentHp: hero.currentHp,
        })),
    };
}

/**
 * 只在 VITE_E2E=true 的构建中暴露，用于把完整 UI 流程压缩到最后一击。
 * 点将、布阵、技能选择与结算仍由真实界面完成。
 */
function prepareFinalStrike(): boolean {
    const state = useGameStore.getState();
    if (state.phase !== 'battle') return false;

    const attacker = state.player1Heroes.find(hero => hero.name === '墨阑' && hero.position);
    const target = state.player2Heroes.find(hero => hero.position);
    if (!attacker?.position || !target?.position) return false;

    const [attackerRow, attackerCol] = attacker.position;
    const [targetRow, targetCol] = target.position;
    if (Math.abs(attackerRow - targetRow) + Math.abs(attackerCol - targetCol) !== 1) return false;

    const board = state.board.map(row => [...row]);
    state.player2Heroes.forEach(hero => {
        if (hero === target) return;
        hero.currentHp = 0;
        hero.state = HeroState.DEAD;
        if (hero.position && board[hero.position[0]][hero.position[1]] === hero) {
            board[hero.position[0]][hero.position[1]] = null;
        }
    });

    target.currentHp = 1;
    target.state = HeroState.ALIVE;
    attacker.hasActedThisTurn = false;
    attacker.hasMovedThisTurn = false;

    useGameStore.setState({
        board,
        player1Heroes: [...state.player1Heroes],
        player2Heroes: [...state.player2Heroes],
        // 替补席留人会让最后一击先触发补员而非结算，用例将卡在"正在补员"
        player1BenchHeroIds: [],
        player2BenchHeroIds: [],
        currentPlayer: 'player1',
        selectedHero: null,
        activeHero: null,
        selectedSkill: null,
        highlightedPositions: [],
        moveRange: [],
        skillRange: [],
    });
    return true;
}

export function installE2EBridge(): void {
    if (import.meta.env.VITE_E2E !== 'true' || typeof window === 'undefined') return;
    window.__SIX_CHESS_E2E__ = { snapshot, prepareFinalStrike };
}
