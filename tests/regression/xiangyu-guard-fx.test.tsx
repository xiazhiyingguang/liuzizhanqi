import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { addHero, makeGameState } from '../helpers/game-state';
import { tryTriggerXiangyuLastStand } from '../../src/core/xiangyu';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { drainPendingSkillFxRequests, runWithoutSkillFx } from '../../src/data/extended-skills';
import { HeroStatusFx } from '../../src/components/Game/HeroStatusFx';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { stanceAnchor } from '../../src/core/tianwei-stance-fx';
import { EffectManager } from '../../src/core/effect-manager';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, commitOnlineTriggeredFx } from '../../src/services/online-state';

beforeEach(()=>{useGameStore.getState().resetGame();drainPendingSkillFxRequests();vi.spyOn(Math,'random').mockReturnValue(.99);});
afterEach(()=>{useGameStore.getState().resetGame();drainPendingSkillFxRequests();vi.restoreAllMocks();});
function scene(){const state=makeGameState(),hero=addHero(state,'xiangyu','player1',[2,2]),enemy=addHero(state,'moran','player2',[2,3]);hero.defense=0;return {state,hero,enemy};}
describe('霸王镇守三段表现',()=>{
    it.each([false,true])('实际发动显示护盾增量，致知三=%s',talent=>{
        const {state,hero}=scene();if(talent)grantZhizhi(hero,3);hero.currentHp=10;
        expect(tryTriggerXiangyuLastStand(hero,state)).toBe(true);
        const [fx]=drainPendingSkillFxRequests();expect(fx.skillId).toBe('xiangyu_tianwei');expect(fx.guardAmount).toBe(talent?15:10);
        expect(fx.logIds).toEqual([state.battleLog.at(-1)!.id]);expect(fx.damagePositions).toEqual([]);
        expect(renderToStaticMarkup(<HeroStatusFx hero={hero}/>)).toContain('xyg-wait');
        expect(tryTriggerXiangyuLastStand(hero,state)).toBe(false);expect(drainPendingSkillFxRequests()).toEqual([]);
    });
    it('未跌破30%、致死均不假播护体',()=>{
        const {state,hero}=scene();hero.currentHp=hero.maxHp*.3;
        expect(tryTriggerXiangyuLastStand(hero,state)).toBe(false);hero.currentHp=0;
        expect(tryTriggerXiangyuLastStand(hero,state)).toBe(false);expect(drainPendingSkillFxRequests()).toEqual([]);
    });
    it('真实主动伤害化盾，显示实际转化值并撤下标记',()=>{
        const {state,hero,enemy}=scene();hero.currentHp=10;tryTriggerXiangyuLastStand(hero,state);drainPendingSkillFxRequests();
        const hp=hero.currentHp,shield=hero.shield;
        DamageCalculator.applyDamage(hero,DamageCalculator.calculate(enemy,hero,8,false,false,{fixedDamage:true}),enemy,state);
        const fx=drainPendingSkillFxRequests().find(e=>e.skillId==='xiangyu_guard_convert')!;
        expect(fx.guardAmount).toBe(8);expect(hero.currentHp).toBe(hp);expect(hero.shield).toBe(shield+8);
        expect(renderToStaticMarkup(<HeroStatusFx hero={hero}/>)).not.toContain('xyg-wait');
        const event=buildSkillPreviewScene('xiangyu_guard_convert').event;event.sourceHeroId=hero.id;
        expect(stanceAnchor(event,state.board)).toEqual([2,2]);
        const start=buildSkillPreviewScene('xiangyu_tianwei').event;start.sourceHeroId=hero.id;
        expect(stanceAnchor(start,state.board)).toBeUndefined();
    });
    it('效果伤害不播化盾、不移除待触发标记',()=>{
        const {state,hero,enemy}=scene();hero.currentHp=10;tryTriggerXiangyuLastStand(hero,state);drainPendingSkillFxRequests();
        DamageCalculator.applyDamage(hero,DamageCalculator.calculate(enemy,hero,1,false,false,{fixedDamage:true,logTag:'burn'}),enemy,state);
        expect(drainPendingSkillFxRequests().some(r=>r.skillId==='xiangyu_guard_convert')).toBe(false);
        expect(renderToStaticMarkup(<HeroStatusFx hero={hero}/>)).toContain('xyg-wait');
    });
    it('到期/解除后静态标记消失',()=>{
        const {state,hero}=scene();hero.currentHp=10;tryTriggerXiangyuLastStand(hero,state);
        EffectManager.removeEffectByName(hero,'霸王镇守');
        expect(renderToStaticMarkup(<HeroStatusFx hero={hero}/>)).not.toContain('xyg-wait');
    });
    it('AI试算无视觉请求和额外随机数',()=>{
        const run=(silent:boolean)=>{const {state,hero}=scene();hero.currentHp=10;vi.mocked(Math.random).mockClear();
            if(silent)runWithoutSkillFx(()=>tryTriggerXiangyuLastStand(hero,state));else tryTriggerXiangyuLastStand(hero,state);
            const random=vi.mocked(Math.random).mock.calls.length;const fx=drainPendingSkillFxRequests();if(silent)expect(fx).toEqual([]);
            return {random,hp:hero.currentHp,shield:hero.shield,effects:hero.effects.map(e=>[e.name,e.duration])};};
        expect(run(false)).toEqual(run(true));
    });
    it.each(['xiangyu_tianwei','xiangyu_guard_convert'])('%s 图鉴与战斗共用一份甲影，数字来自事件',id=>{
        const event=buildSkillPreviewScene(id).event;event.guardAmount=17;
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="target"/>)).toBe('');
        const html=renderToStaticMarkup(<SkillFxVisual event={event} variant="caster"/>);
        expect(html).toContain('盾 +17');expect(html).toContain(id==='xiangyu_tianwei'?'霸王镇守':'化伤为盾');
    });
    it('联机JSON快照保留实际转化值和角色，不重跑机制',()=>{
        const {state,hero,enemy}=scene();hero.currentHp=10;tryTriggerXiangyuLastStand(hero,state);
        DamageCalculator.applyDamage(hero,DamageCalculator.calculate(enemy,hero,8,false,false,{fixedDamage:true}),enemy,state);
        useGameStore.setState({...state,isOnlineMode:false,isAiMode:false});
        const snap=JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();applyServerGameState(snap);commitOnlineTriggeredFx(new Set());
        const event=useGameStore.getState().skillFx.find(e=>e.skillId==='xiangyu_guard_convert')!;
        expect(event.guardAmount).toBe(8);expect(event.sourceHeroId).toBe(hero.id);expect(useGameStore.getState().player1Heroes[0].shield).toBe(18);
    });
});
