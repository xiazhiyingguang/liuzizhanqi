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
/**
 * 术语表按首字建一次索引：原来每个字符位置都要拿全部术语 + 场上英雄名逐个
 * startsWith（200 条日志 × 约 30 字 × 100 多个词 ≈ 每次渲染 6×10⁵ 次），手机上
 * 每次状态提交都要重跑，是"施法那一帧上千毫秒"的主要来源之一。
 */
const GLOSSARY_BY_FIRST_CHAR: Map<string, BattleLogContentToken[]> = (() => {
    const index = new Map<string, BattleLogContentToken[]>();
    const sorted = [...BATTLE_GLOSSARY].sort((left, right) => right.term.length - left.term.length);
    for (const glossary of sorted) {
        const key = glossary.term[0];
        const bucket = index.get(key);
        if (bucket) bucket.push({ text: glossary.term, glossary });
        else index.set(key, [{ text: glossary.term, glossary }]);
    }
    return index;
})();

/** 只在"首字相同"的候选里挑最长匹配；同长度时英雄名优先于术语（保持原有优先级） */
function longestCandidateAt(
    message: string,
    cursor: number,
    heroBucket: BattleLogContentToken[] | undefined,
    glossaryBucket: BattleLogContentToken[] | undefined
): BattleLogContentToken | null {
    let best: BattleLogContentToken | null = null;
    for (const bucket of [heroBucket, glossaryBucket]) {
        if (!bucket) continue;
        for (const candidate of bucket) {
            if (candidate.text.length <= (best?.text.length ?? 0)) continue;
            if (message.startsWith(candidate.text, cursor)) {
                best = candidate;
                break;
            }
        }
    }
    return best;
}

export function tokenizeBattleLogContent(
    message: string,
    heroes: HeroNameReference[]
): BattleLogContentToken[] {
    const ownerByName = new Map<string, Player>();
    for (const hero of heroes) {
        const name = hero.name.trim();
        if (name && !ownerByName.has(name)) ownerByName.set(name, hero.owner);
    }

    const heroByFirstChar = new Map<string, BattleLogContentToken[]>();
    for (const [text, owner] of ownerByName) {
        const key = text[0];
        const bucket = heroByFirstChar.get(key);
        if (bucket) bucket.push({ text, owner });
        else heroByFirstChar.set(key, [{ text, owner }]);
    }
    for (const bucket of heroByFirstChar.values()) {
        bucket.sort((left, right) => right.text.length - left.text.length);
    }

    const tokens: BattleLogContentToken[] = [];
    let cursor = 0;
    let plainText = '';

    const flushPlainText = () => {
        if (!plainText) return;
        tokens.push({ text: plainText });
        plainText = '';
    };

    while (cursor < message.length) {
        const match = longestCandidateAt(message, cursor,
            heroByFirstChar.get(message[cursor]), GLOSSARY_BY_FIRST_CHAR.get(message[cursor]));
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

export type KillAnnouncementTier = 1 | 2 | 3 | 4 | 5 | 6;

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
    4: { title: '四连超凡', eyebrow: 'QUADRA KILL' },
    // 每方 6 名英雄（4 上阵 + 2 替补），所以 6 杀在规则上就是"把对面整队清空"
    5: { title: '五连无双', eyebrow: 'PENTA KILL' },
    6: { title: '六连灭队', eyebrow: 'HEXAKILL' }
};

/** 全部连杀档位，横幅上的战功菱形数与最高档都取自这里，加档位只改这一处 */
export const KILL_ANNOUNCEMENT_TIERS: KillAnnouncementTier[] = [1, 2, 3, 4, 5, 6];

export function getKillAnnouncementTier(killCount: number): KillAnnouncementTier {
    if (!Number.isFinite(killCount)) return 1;
    const top = KILL_ANNOUNCEMENT_TIERS[KILL_ANNOUNCEMENT_TIERS.length - 1];
    return Math.min(top, Math.max(1, Math.floor(killCount))) as KillAnnouncementTier;
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
