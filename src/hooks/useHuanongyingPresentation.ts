import { useEffect, useState } from 'react';
import type { SkillFxEvent } from '../core/skill-fx';
import { hnyPresentation } from '../core/huanongying-fx';
export function useHuanongyingPresentation(events: SkillFxEvent[]) {
    const [tick, setTick] = useState(0);
    const presentation = hnyPresentation(events, Date.now());
    useEffect(() => {
        const next = hnyPresentation(events, Date.now()).nextBoundary;
        if (next === undefined) return;
        const timer = setTimeout(() => setTick(n => n + 1), Math.max(1, next - Date.now() + 16));
        return () => clearTimeout(timer);
    }, [events, tick]);
    return presentation;
}
