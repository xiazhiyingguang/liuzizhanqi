import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { soundManager } from '../../src/core/sound-manager';
import { getSkill } from '../../src/data/skills';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(() => { vi.restoreAllMocks(); useGameStore.getState().resetGame(); });

describe('技能成功后统一派发音效', () => {
    it('非法召唤只出现提示，不在校验之前播放技能声音', () => {
        useGameStore.getState().resetGame();
        const state = makeGameState();
        const caster = addHero(state, 'wukong', 'player1', [2, 1]);
        addHero(state, 'moran', 'player2', [2, 3]);
        useGameStore.setState({ ...state, phase: 'battle', selectedHero: caster, selectedSkill: getSkill('wukong_skill1'), skillFx: [] });
        const play = vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined);
        useGameStore.getState().executeSkill([2, 3]);
        expect(play).not.toHaveBeenCalled();
        expect(useGameStore.getState().skillFx).toHaveLength(0);
    });
    it('手动派发和被动派发共用事件，移出队列会清理预约声音', () => {
        useGameStore.getState().resetGame();
        const play = vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined);
        const retain = vi.spyOn(soundManager, 'retainSkillFx');
        const push = useGameStore.getState().pushSkillFx;
        push({ skillId: 'lingxi_regen', profile: { kind: 'regen-orb', recovery: 'tide', durationMs: 1250 },
            owner: 'player1', fromPos: [2, 1], targetPos: [2, 3], angleDeg: 0, direction: 'E' });
        const fx = useGameStore.getState().skillFx[0];
        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith(fx);
        useGameStore.getState().dismissSkillFx(fx.id);
        expect(retain).toHaveBeenLastCalledWith(new Set());
    });
});
