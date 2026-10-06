import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpectralSkillFx } from '../../src/components/Game/SpectralSkillFx';
import { SkillAreaFx } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

describe('幽花与汲取特效的实际落点', () => {
    it('播撒包含选定的四格空地，伤害仍仅指向区域内敌人', () => {
        vi.spyOn(Math, 'random').mockReturnValue(.99);
        const state = makeGameState();
        const caster = addHero(state, 'wither_lord', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        const outside = addHero(state, 'moran', 'player2', [4, 4]);
        useGameStore.setState({ ...state, selectedHero: caster, currentPlayer: 'player1', isOnlineMode: false, isAiMode: false });
        useGameStore.getState().selectSkill('wither_lord_skill1');
        useGameStore.getState().executeSkill([2, 2]);
        useGameStore.getState().executeSkill([3, 3]);
        const event = useGameStore.getState().skillFx.find(fx => fx.profile.spectral === 'wither-bloom')!;
        expect(event.coveredPositions).toHaveLength(4);
        expect(event.coveredPositions).toEqual(expect.arrayContaining([[2, 2], [2, 3], [3, 2], [3, 3]]));
        expect(event.damagePositions).toEqual([[2, 3]]);
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(outside.currentHp).toBe(outside.maxHp);
    });
    it('亡灵汲取凝魂于自身，不把任意点中的敌人画成受益者', () => {
        const { event } = buildSkillPreviewScene('jetzmi_skill2');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="caster" />)).toContain('data-spectral="soul-gather"');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="target" />)).toBe('');
    });
    it('引爆只在主受害格出一个主效，多目标伤害不复制幽花', () => {
        const { event } = buildSkillPreviewScene('wither_lord_skill2');
        expect(event.damagePositions).toHaveLength(3);
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="target" />)).toContain('wither-scatter');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="impact" atPos={[1, 2]} />)).toBe('');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="impact" atPos={[3, 4]} />)).toBe('');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="impact" atPos={[5, 5]} />)).toBe('');
        expect(renderToStaticMarkup(<SkillAreaFx event={event} />)).toBe('');
    });
    it('播撒保留四格作用范围，但区域和空地不复制幽花', () => {
        const { event } = buildSkillPreviewScene('wither_lord_skill1');
        expect(event.coveredPositions).toHaveLength(4);
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="area" atPos={event.targetPos} />)).toBe('');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="area" atPos={[3, 4]} />)).toBe('');
    });
    it.each(['jetzmi_skill2', 'wither_lord_skill1', 'wither_lord_skill2'])('%s 整张棋盘只有一个主效画布', skillId => {
        const { event, rows, cols } = buildSkillPreviewScene(skillId);
        let count = 0;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
            for (const variant of previewCellVariants(event, row, col)) {
                const html = renderToStaticMarkup(<SpectralSkillFx event={event} variant={variant} atPos={[row, col]} />);
                count += (html.match(/data-spectral=/g) ?? []).length;
            }
        }
        expect(count).toBe(1);
    });
    it('引爆点中空格时只在第一个真实受害者处出现主效', () => {
        const { event } = buildSkillPreviewScene('wither_lord_skill2');
        event.targetPos = [5, 5];
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="target" />)).toBe('');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="impact" atPos={event.damagePositions![0]} />)).toContain('wither-scatter');
        expect(renderToStaticMarkup(<SpectralSkillFx event={event} variant="impact" atPos={event.damagePositions![1]} />)).toBe('');
    });
});
