import { useEffect, useState } from 'react';
import type { SkillFxEvent } from '../core/skill-fx';
import { swallowPresentation } from '../core/swallow-fx';

export function useSwallowPresentation(events: SkillFxEvent[]) {
    const [tick, setTick] = useState(0);
    const presentation = swallowPresentation(events, Date.now());
    useEffect(() => {
        const next = swallowPresentation(events, Date.now()).nextBoundary;
        if (next === undefined) return;
        const timer = setTimeout(() => setTick(n => n + 1), Math.max(1, next - Date.now() + 16));
        return () => clearTimeout(timer);
    }, [events, tick]);
    return presentation;
}
