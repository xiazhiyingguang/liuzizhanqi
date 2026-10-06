import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkillAreaFx, SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { getSkill } from '../../src/data/skills';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(()=>{useGameStore.getState().resetGame();vi.restoreAllMocks();});

describe('重绘技能的主效数量与真实落点',()=>{
    it('暗夜法阵同格起手和目标不复制魂灯，也不叠旧的整盘法阵',()=>{
        const {event,rows,cols}=buildSkillPreviewScene('soul_lamp_skill1');
        let html='';
        for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
            for(const variant of previewCellVariants(event,row,col))html+=renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} atPos={[row,col]} />);
        }
        expect((html.match(/data-crafted="soul-array"/g)??[])).toHaveLength(1);
        expect(html).not.toContain('fx-array-outer');
        expect(renderToStaticMarkup(<SkillAreaFx event={event} />)).toBe('');
    });

    it('戴尔交换两个其他角色时，两格特效随交换对象，生命交换照常结算',()=>{
        vi.spyOn(Math,'random').mockReturnValue(.99);
        const state=makeGameState();
        const dai=addHero(state,'dai','player1',[0,0]);
        const ally=addHero(state,'moran','player1',[2,2]);
        const enemy=addHero(state,'baize','player2',[4,3]);
        ally.currentHp=Math.round(ally.maxHp*.4);enemy.currentHp=enemy.maxHp;
        const ratio=ally.currentHp/ally.maxHp;
        useGameStore.setState({...state,isOnlineMode:false,isAiMode:false,selectedHero:dai,selectedSkill:getSkill('dai_skill2')!,skillFx:[],skillFxExtras:undefined,pendingSkillTargetPositions:[]});
        useGameStore.getState().executeSkill([2,2]);
        expect(useGameStore.getState().skillFx).toHaveLength(0);
        useGameStore.getState().executeSkill([4,3]);
        const fx=useGameStore.getState().skillFx.find(event=>event.skillId==='dai_skill2')!;
        expect(fx.fromPos).toEqual([2,2]);expect(fx.targetPos).toEqual([4,3]);
        expect(dai.position).toEqual([0,0]);expect(ally.position).toEqual([4,3]);expect(enemy.position).toEqual([2,2]);
        expect(ally.currentHp).toBe(ally.maxHp);expect(enemy.currentHp).toBe(Math.round(enemy.maxHp*ratio));
    });

    it.each([[0,-90],[1,90],[2,180],[3,0]])('风向 %i 的风廊流线沿选定轴，不沿点选对角线', (code,angle)=>{
        const state=makeGameState();
        const caster=addHero(state,'nanfeng','player1',[1,1]);
        addHero(state,'baize','player2',[5,5]);caster.counters['__nanfeng_skill2_dir']=code;
        useGameStore.setState({...state,isOnlineMode:false,isAiMode:false,selectedHero:caster,selectedSkill:getSkill('nanfeng_skill2')!,skillFx:[],skillFxExtras:undefined,pendingSkillTargetPositions:[]});
        useGameStore.getState().executeSkill([3,4]);
        const fx=useGameStore.getState().skillFx.find(event=>event.skillId==='nanfeng_skill2')!;
        expect(fx.angleDeg).toBe(angle);expect(fx.coveredPositions).toHaveLength(6);
        expect(fx.coveredPositions!.every(cell=>code<2?cell[1]===4:cell[0]===3)).toBe(true);
    });

    it('寒渊护冰只画在实际受益的友方格，不铺到附近的敌人和空格',()=>{
        const state=makeGameState();const caster=addHero(state,'chenyuan','player1',[2,2]);
        addHero(state,'moran','player1',[2,3]);addHero(state,'baize','player2',[2,1]);
        useGameStore.setState({...state,isOnlineMode:false,isAiMode:false,selectedHero:caster,selectedSkill:getSkill('chenyuan_skill2')!,skillFx:[],skillFxExtras:undefined});
        useGameStore.getState().executeSkill([2,3]);
        const fx=useGameStore.getState().skillFx.find(event=>event.skillId==='chenyuan_skill2')!;
        expect(fx.coveredPositions).toContainEqual([2,3]);
        expect(fx.coveredPositions).not.toContainEqual([2,1]);expect(fx.coveredPositions).not.toContainEqual([1,1]);
    });
});
