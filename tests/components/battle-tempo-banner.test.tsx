import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TurnActionBanner from '../../src/components/Game/TurnActionBanner';
import { fierceAnnouncement } from '../../src/core/battle-tempo';

/**
 * 激战横幅的渲染验收（node 环境下 renderToStaticMarkup，只跑首帧、不跑 effect）。
 *
 * 守的是最容易改坏的一条：入场横幅是"事件"而不是"状态"，
 * 刷新页面或切屏回来时不能把已经过去的第 20 回合重播一遍。
 */
function render(extra: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
        <TurnActionBanner
            currentPlayer="player1"
            hero={null}
            isOnlineMode={false}
            latestKillAnnouncement={null}
            {...extra}
        />
    );
}

describe('激战入场横幅', () => {
    it('挂载时带着第 20 回合的播报也不重播入场', () => {
        const markup = render({ battlePhase: fierceAnnouncement(20) });

        expect(markup).toContain('battle-turn-banner');
        expect(markup).not.toContain('phase-announcement');
        expect(markup).toContain('等待选择本次行动英雄');
    });

    it('未进入激战时展示条保持原样', () => {
        expect(render({ battlePhase: fierceAnnouncement(19) })).not.toContain('phase-announcement');
        expect(render()).not.toContain('phase-announcement');
    });
});
