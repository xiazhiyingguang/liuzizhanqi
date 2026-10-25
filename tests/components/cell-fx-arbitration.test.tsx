import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';

function fxEvent(): SkillFxEvent {
    return {
        id: 1,
        bornAt: 0,
        owner: 'player1',
        profile: resolveSkillFx('libai_skill1'),
        fromPos: [2, 1],
        targetPos: [2, 2],
        angleDeg: 0,
        direction: 'E',
    };
}

describe('同格仲裁的回声标记', () => {
    it('回声变体带 is-fx-echo，主效不带', () => {
        const echo = renderToStaticMarkup(
            <SkillFxVisual event={fxEvent()} variant="impact" atPos={[2, 2]} emphasis="echo" />
        );
        expect(echo).toContain('skill-fx-impact');
        expect(echo).toContain('is-fx-echo');

        const main = renderToStaticMarkup(
            <SkillFxVisual event={fxEvent()} variant="impact" atPos={[2, 2]} emphasis="main" />
        );
        expect(main).toContain('skill-fx-impact');
        expect(main).not.toContain('is-fx-echo');
    });
});
