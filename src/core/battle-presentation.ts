import type { BattleLogEntry, Player } from '../types/game';
import { BATTLE_GLOSSARY, type BattleGlossaryEntry } from './battle-glossary';

export interface HeroNameReference {
    name: string;
    owner: Player;
}

export interface BattleLogToken {
    text: string;
    owner?: Player;
}

export interface BattleLogContentToken extends BattleLogToken {
    glossary?: BattleGlossaryEntry;
}

export function tokenizeBattleLogMessage(
    message: string,
    heroes: HeroNameReference[]
): BattleLogToken[] {
    const ownerByName = new Map<string, Player>();
    for (const hero of heroes) {
        const name = hero.name.trim();
        if (name && !ownerByName.has(name)) ownerByName.set(name, hero.owner);
    }

    const names = [...ownerByName.keys()].sort((a, b) => b.length - a.length);
    if (names.length === 0) return [{ text: message }];

    const escapedNames = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const matcher = new RegExp(`(${escapedNames.join('|')})`, 'g');

    return message
        .split(matcher)
        .filter(Boolean)
        .map(text => ({ text, owner: ownerByName.get(text) }));
}

/**
 * 同时识别英雄名与战斗术语。每个位置总是优先匹配更长的完整词，
 * 因此“白泽之力”不会被拆成英雄“白泽”，而“凋零之主”也不会被拆成术语“凋零”。
 */
export function tokenizeBattleLogContent(
    message: string,
    heroes: HeroNameReference[]
): BattleLogContentToken[] {
    const ownerByName = new Map<string, Player>();
    for (const hero of heroes) {
        const name = hero.name.trim();
        if (name && !ownerByName.has(name)) ownerByName.set(name, hero.owner);
    }

    const heroCandidates: BattleLogContentToken[] = [...ownerByName.entries()]
        .map(([text, owner]) => ({ text, owner }));
    const glossaryCandidates: BattleLogContentToken[] = BATTLE_GLOSSARY
        .map(glossary => ({ text: glossary.term, glossary }));
    const candidates: BattleLogContentToken[] = [...heroCandidates, ...glossaryCandidates]
        .sort((left, right) => {
            const lengthDifference = right.text.length - left.text.length;
            if (lengthDifference !== 0) return lengthDifference;
            return left.owner ? -1 : right.owner ? 1 : 0;
        });

    const tokens: BattleLogContentToken[] = [];
    let cursor = 0;
    let plainText = '';

    const flushPlainText = () => {
        if (!plainText) return;
        tokens.push({ text: plainText });
        plainText = '';
    };

    while (cursor < message.length) {
        const match = candidates.find(candidate => message.startsWith(candidate.text, cursor));
        if (!match) {
            plainText += message[cursor];
            cursor++;
            continue;
        }

        flushPlainText();
        tokens.push(match);
        cursor += match.text.length;
    }

    flushPlainText();
    return tokens;
}

export interface BattleOutcomePresentation {
    result: 'victory' | 'defeat';
    mark: '胜' | '败';
    title: string;
    description: string;
}

export function getBattleOutcomePresentation(
    winner: Player | undefined,
    isOnlineMode: boolean,
    localPlayerNumber: number | undefined,
    isAiMode = false
): BattleOutcomePresentation {
    if (isAiMode) {
        return winner === 'player1'
            ? { result: 'victory', mark: '胜', title: '胜利', description: '你击败了宗师电脑' }
            : { result: 'defeat', mark: '败', title: '失败', description: '宗师电脑赢得本局，再整旗鼓' };
    }
    if (isOnlineMode && (localPlayerNumber === 1 || localPlayerNumber === 2)) {
        const localPlayer: Player = localPlayerNumber === 1 ? 'player1' : 'player2';
        const isWinner = winner === localPlayer;
        return isWinner
            ? { result: 'victory', mark: '胜', title: '胜利', description: '你赢得了本局对战' }
            : { result: 'defeat', mark: '败', title: '失败', description: '胜负已定，再整旗鼓' };
    }

    return {
        result: 'victory',
        mark: '胜',
        title: winner === 'player2' ? '玩家二 获胜' : '玩家一 获胜',
        description: '本局对战已经结束'
    };
}

export function getTurnOperatorLabel(
    currentPlayer: Player,
    isOnlineMode: boolean,
    localPlayerNumber: number | undefined,
    isAiMode = false,
    aiPlayer: Player = 'player2'
): string {
    if (isAiMode) return currentPlayer === aiPlayer ? '宗师电脑' : '玩家一（你）';
    const playerLabel = currentPlayer === 'player1' ? '玩家一' : '玩家二';
    if (!isOnlineMode || (localPlayerNumber !== 1 && localPlayerNumber !== 2)) return playerLabel;
    const localPlayer: Player = localPlayerNumber === 1 ? 'player1' : 'player2';
    return `${playerLabel}（${currentPlayer === localPlayer ? '你' : '对手'}）`;
}

export type KillAnnouncementTier = 1 | 2 | 3 | 4;

export interface KillAnnouncement {
    id: string;
    killerHeroId: string;
    killerName: string;
    victimName: string;
    player: Player;
    tier: KillAnnouncementTier;
    title: string;
    eyebrow: string;
}

const KILL_TIER_COPY: Record<KillAnnouncementTier, Pick<KillAnnouncement, 'title' | 'eyebrow'>> = {
    1: { title: '首破', eyebrow: 'FIRST BLOOD' },
    2: { title: '二连击破', eyebrow: 'DOUBLE KILL' },
    3: { title: '三连决胜', eyebrow: 'TRIPLE KILL' },
    4: { title: '四连超凡', eyebrow: 'QUADRA KILL' }
};

export function getKillAnnouncementTier(killCount: number): KillAnnouncementTier {
    if (!Number.isFinite(killCount)) return 1;
    return Math.min(4, Math.max(1, Math.floor(killCount))) as KillAnnouncementTier;
}

export function getLatestKillAnnouncement(battleLog: BattleLogEntry[]): KillAnnouncement | null {
    for (let index = battleLog.length - 1; index >= 0; index--) {
        const entry = battleLog[index];
        if (entry.type !== 'kill') continue;

        const details = entry.details;
        if (
            details?.kind !== 'hero-kill' ||
            typeof details.killerHeroId !== 'string' ||
            typeof details.killerName !== 'string' ||
            typeof details.victimName !== 'string' ||
            typeof details.killCount !== 'number'
        ) {
            continue;
        }

        const tier = getKillAnnouncementTier(details.killCount);
        return {
            id: entry.id,
            killerHeroId: details.killerHeroId,
            killerName: details.killerName,
            victimName: details.victimName,
            player: entry.player,
            tier,
            ...KILL_TIER_COPY[tier]
        };
    }

    return null;
}
