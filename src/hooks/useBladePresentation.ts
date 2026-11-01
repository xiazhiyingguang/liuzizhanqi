import { useEffect, useState } from 'react';
import type { SkillFxEvent } from '../core/skill-fx';
import { bladePresentation } from '../core/blade-choreography';

export function useBladePresentation(events: SkillFxEvent[]) {
    const [tick, setTick] = useState(0);
    const value = bladePresentation(events, Date.now());
    useEffect(() => {
        const next = bladePresentation(events, Date.now()).nextBoundary;
        if (next === undefined) return;
        const timer = setTimeout(() => setTick(n => n + 1), Math.max(1, next - Date.now() + 12));
        return () => clearTimeout(timer);
    }, [events, tick]);
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? { ...value, hiddenActors: new Set<string>(), hiddenSwords: new Set<string>() } : value;
}
