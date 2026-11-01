import { useEffect, useState } from 'react';
import type { SkillFxEvent } from '../core/skill-fx';
import { arrivalPresentation } from '../core/tianwei-arrival-fx';

export function useTianweiArrival(events: SkillFxEvent[]) {
    const [tick, setTick] = useState(0);
    const result = arrivalPresentation(events, Date.now());
    useEffect(() => {
        const next = arrivalPresentation(events, Date.now()).nextBoundary;
        if (next === undefined) return;
        const timer = setTimeout(() => setTick(n => n + 1), Math.max(1, next - Date.now()));
        return () => clearTimeout(timer);
    }, [events, tick]);
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        return { ...result, hiddenClones: new Set<string>(), pendingFrozen: new Set<string>() };
    return result;
}
