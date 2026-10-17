import { useEffect, useState } from 'react';
import type { SkillFxEvent } from '../core/skill-fx';
import { aoyuanPresentation } from '../core/aoyuan-presentation';

export function useAoyuanPresentation(events: SkillFxEvent[]) {
    const [tick, setTick] = useState(0);
    const presentation = aoyuanPresentation(events, Date.now());
    useEffect(() => {
        const next = aoyuanPresentation(events, Date.now()).nextBoundary;
        if (next === undefined) return;
        const timer = setTimeout(() => setTick(value => value + 1), Math.max(1, next - Date.now() + 16));
        return () => clearTimeout(timer);
    }, [events, tick]);
    return presentation;
}
