import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupExitButtonView } from '../../src/components/GameSetup/SetupExitButton';
import { useGameStore } from '../../src/store/game-store';

describe('点将与布阵返回入口', () => {
    afterEach(() => useGameStore.getState().resetGame());

    it('本地模式显示返回主界面按钮', () => {
        const heroSelect = renderToStaticMarkup(<SetupExitButtonView stage="点将" isOnlineMode={false} />);
        const deploy = renderToStaticMarkup(<SetupExitButtonView stage="布阵" isOnlineMode={false} />);

        expect(heroSelect).toContain('返回主界面');
        expect(heroSelect).toContain('setup-exit-点将');
        expect(deploy).toContain('返回主界面');
        expect(deploy).toContain('setup-exit-布阵');
    });

    it('联机模式使用退出文案', () => {
        expect(renderToStaticMarkup(<SetupExitButtonView stage="点将" isOnlineMode />)).toContain('退出点将');
        expect(renderToStaticMarkup(<SetupExitButtonView stage="布阵" isOnlineMode />)).toContain('退出布阵');
    });
});
