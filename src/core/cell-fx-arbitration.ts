/**
 * 同格技能特效仲裁 —— 纯逻辑，不碰 DOM，也不改战斗结算。
 *
 * 一格同一时刻只允许一份全尺寸命中主效：
 *   1. 最新落格的命中事件拿舞台，同格其它命中事件退成角落回声；
 *   2. 第三件起连回声都不给，只在格边留一道来源色短线；
 *   3. 区域底光同格只留最新一份；命中主效在场时，其它事件的底光全部让位。
 * 起手光环、溅射、链电这些占地很小的零件不参与争抢。
 */

export type CellFxVariant = 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';

export interface CellFxEntry {
    eventId: number;
    variant: CellFxVariant;
}

/** show=照常渲染；echo=缩进格角的回声；hidden=完全让位 */
export type CellFxRole = 'show' | 'echo' | 'hidden';

export interface CellFxPlan {
    /** 拿到全尺寸舞台的事件；null 表示本格没有命中型主效 */
    mainEventId: number | null;
    roles: Map<string, CellFxRole>;
    /** 只剩格边短线的来源事件（从新到旧） */
    notchEventIds: number[];
    /** 命中主效在场：常驻场地、印记与状态环需要压暗让位 */
    hot: boolean;
}

type HeavyVariant = 'target' | 'impact';

const HEAVY_RANK: Record<HeavyVariant, number> = { target: 2, impact: 1 };

export function cellFxKey(eventId: number, variant: CellFxVariant): string {
    return `${eventId}:${variant}`;
}

function isHeavyVariant(variant: CellFxVariant): variant is HeavyVariant {
    return variant === 'target' || variant === 'impact';
}

export function planCellFx(entries: CellFxEntry[]): CellFxPlan {
    const roles = new Map<string, CellFxRole>();
    if (entries.length === 0) {
        return { mainEventId: null, roles, notchEventIds: [], hot: false };
    }

    const byEvent = new Map<number, CellFxEntry[]>();
    for (const entry of entries) {
        const list = byEvent.get(entry.eventId);
        if (list) list.push(entry);
        else byEvent.set(entry.eventId, [entry]);
    }

    // 每件事在本格最多挑一份命中主效：target 优先于 impact（正常数据里一格只会有一份）
    const heavyByEvent = new Map<number, HeavyVariant>();
    for (const [eventId, list] of byEvent) {
        let heavy: HeavyVariant | null = null;
        for (const entry of list) {
            if (!isHeavyVariant(entry.variant)) continue;
            if (!heavy || HEAVY_RANK[entry.variant] > HEAVY_RANK[heavy]) heavy = entry.variant;
        }
        if (heavy) heavyByEvent.set(eventId, heavy);
    }

    const heavyEventIds = [...heavyByEvent.keys()].sort((a, b) => b - a);
    const mainEventId = heavyEventIds[0] ?? null;
    const echoEventId = heavyEventIds[1] ?? null;
    const notchEventIds = heavyEventIds.slice(2);

    if (mainEventId !== null) {
        for (const [eventId, list] of byEvent) {
            for (const entry of list) {
                const key = cellFxKey(entry.eventId, entry.variant);
                if (eventId === mainEventId) {
                    roles.set(key, 'show');
                } else if (eventId === echoEventId) {
                    // 回声事件只保留落在本格的那一份命中主效，起手与底光一起让位
                    roles.set(key, entry.variant === heavyByEvent.get(eventId) ? 'echo' : 'hidden');
                } else if (heavyByEvent.has(eventId)) {
                    // 第三件起的命中事件只留格边短线，所有画面零件都让位
                    roles.set(key, 'hidden');
                } else {
                    // 没有命中型的底光事件：主效在场时底光让位；起手/溅射/链电仍可保留
                    roles.set(key, entry.variant === 'area' ? 'hidden' : 'show');
                }
            }
        }
        return { mainEventId, roles, notchEventIds, hot: true };
    }

    // 没有命中型事件：底光同格只留最新一份，小件全留
    let newestAreaEventId: number | null = null;
    for (const entry of entries) {
        if (entry.variant !== 'area') continue;
        if (newestAreaEventId === null || entry.eventId > newestAreaEventId) {
            newestAreaEventId = entry.eventId;
        }
    }
    for (const entry of entries) {
        roles.set(
            cellFxKey(entry.eventId, entry.variant),
            entry.variant === 'area' && entry.eventId !== newestAreaEventId ? 'hidden' : 'show',
        );
    }
    return { mainEventId: null, roles, notchEventIds: [], hot: false };
}
