import type { LobbyPlayer, PlayerIdentity } from './socket-service';

const PROFILE_KEY = 'sixChessPlayerIdentityV1';
const RECENT_KEY = 'sixChessRecentPlayersV1';

export interface RecentPlayer extends PlayerIdentity {
    lastPlayedAt: number;
}

function randomToken() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(-12).toUpperCase();
}

export function getOrCreatePlayerIdentity(): PlayerIdentity {
    try {
        const saved = localStorage.getItem(PROFILE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved) as PlayerIdentity;
            if (parsed?.id && parsed?.label) return parsed;
        }
    } catch {
        // Ignore damaged local data and create a fresh identity.
    }

    const token = randomToken();
    const identity = {
        id: `player-${token}`,
        label: `棋友·${token.slice(-4)}`
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(identity));
    return identity;
}

export function getRecentPlayers(): RecentPlayer[] {
    try {
        const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as RecentPlayer[];
        return Array.isArray(saved)
            ? saved.filter(player => player?.id && player?.label).slice(0, 12)
            : [];
    } catch {
        return [];
    }
}

export function rememberRecentPlayer(player?: Partial<LobbyPlayer> | null): RecentPlayer[] {
    if (!player?.id || !player?.label) return getRecentPlayers();
    const next = [
        { id: player.id, label: player.label, lastPlayedAt: Date.now() },
        ...getRecentPlayers().filter(item => item.id !== player.id)
    ].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    return next;
}
