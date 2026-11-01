import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { martialSlashRotation } from '../../src/core/martial-fx';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { damoSkill2 } from '../../src/data/extended-skills';
import { addHero, makeGameState } from '../helpers/game-state';

describe('达摩/项羽专属物象', () => {
    it.each(['damo_skill1', 'xiangyu_skill1'])('%s 冲锋使用连续气流，没有平移拳头或肩甲贴片', id => {
        const { event } = buildSkillPreviewScene(id);
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain('charge-front-travel');
        expect(html).not.toMatch(/martial-ram|martial-solid|<image|foreignObject|damo-fist/);
        expect(html.match(/data-charge-contact=/g)).toHaveLength(1);
        event.damagePositions = [];
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />)).not.toContain('data-charge-contact');
    });
    it('达摩肩撞只到敌人原位，气劲继续到击退落点', () => {
        const { event } = buildSkillPreviewScene('damo_skill1');
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain('--charge-shoulder:100px');
        expect(html).toContain('--charge-run:300px');
        expect(html).not.toContain('charge-spear-turn');
    });
    it.each([[1, 1], [1, 3], [3, 1], [3, 3]] as const)('斜向冲锋实际终点 %s,%s', (r, c) => {
        const { event } = buildSkillPreviewScene('xiangyu_skill1');
        event.targetPos = [r, c]; event.angleDeg = 0;
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain(`rotate(${Math.atan2(r - 2, c - 2) * 180 / Math.PI})`);
        expect(html).not.toContain('NaN');
    });
    it.each(['damo_skill1','damo_skill2','xiangyu_skill1','xiangyu_skill2'])('%s 每次只有一份专属场景，非通用光圈', id => {
        const { event } = buildSkillPreviewScene(id);
        expect(previewCellVariants(event, ...event.fromPos)).toEqual(['caster']);
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />)).toBe('');
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain(`data-martial-skill="${id}"`); expect(html).not.toContain('fxp-ring');
    });
    it('只画实际出拳数量；没有四拳数据不补虚假拳影', () => {
        const { event } = buildSkillPreviewScene('damo_skill2');
        event.damo = { punches: 1, cells: [[2,3]] };
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />).match(/class="martial-contact martial-punch"/g)).toHaveLength(1);
        event.damo = undefined;
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />)).not.toContain('martial-punch');
    });
    it('只有撞墙才出现山壁裂纹', () => {
        const { event } = buildSkillPreviewScene('damo_skill1'); event.damo!.hitMountain = false;
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />)).not.toContain('martial-wall-crack');
        event.damo!.hitMountain = true;
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />)).toContain('martial-wall-crack');
    });
    it.each([0,90,180,-90])('刀气从真实覆盖格恢复 %i 度，侧翼主目标与致死不影响朝向', angle => {
        const { event } = buildSkillPreviewScene('xiangyu_skill2'); event.fromPos = [2,2]; event.targetPos = [2,2]; event.angleDeg = 0;
        const rad = angle*Math.PI/180;
        event.coveredPositions = [[-1,1],[0,1],[1,1],[-1,2],[0,2],[1,2]].map(([r,c]) =>
            [Math.round(2+r*Math.cos(rad)+c*Math.sin(rad)), Math.round(2+c*Math.cos(rad)-r*Math.sin(rad))]);
        expect(martialSlashRotation(event)).toBe(angle);
    });
    it('空斩没有伪造受击爆点', () => {
        const { event } = buildSkillPreviewScene('xiangyu_skill2'); event.damagePositions=[];
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />)).not.toContain('class="martial-contact');
    });
    it('致死一拳的位置保留在被击者原格，而非达摩脚下', () => {
        const state=makeGameState(), caster=addHero(state,'damo','player1',[2,2]);
        const target=addHero(state,'moran','player2',[2,3]); target.currentHp=1; target.passiveId=''; target.tianweiId='';
        expect(damoSkill2.execute(caster,[],state).success).toBe(true);
        expect(state.skillFxExtras?.damo?.cells).toEqual([[2,3]]);
    });
});
