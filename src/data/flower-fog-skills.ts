import { DamageCalculator } from '../core/damage-calculator';
import { requestSkillFx } from './extended-skills';
import { nextBattleLogId } from '../core/battle-log-id';
import { collectImpactPositions } from '../core/skill-fx';
import { syncPositionAnchoredEffects } from './extended-heroes';
import { getRageBinder } from '../core/taunt';
import { REVEALED, flowerArea, flowerCanStabCell, flowerChoiceCells, flowerFogAt, flowerFogCovers, hiddenByFlowerFog, finishFlowerAttack,
    flowerDecoyBodyId, lockFlowerBody, placeFlowerDecoy, plantFlowerFog, revealFlowerAttacker, swapFlowerDecoy } from '../core/flower-fog';
import { HeroState, type GameState, type Hero, type Position, type SkillExecuteResult } from '../types/game';

const reject = (message:string):SkillExecuteResult => ({success:false,log:[message]});
const clickedCell = (hero:Hero):Position|undefined => {
    const key=hero.counters['__extended_target'];return key===undefined?undefined:[Math.floor(key/6),key%6];
};
const same=(a:Position,b:Position)=>a[0]===b[0]&&a[1]===b[1];
export function executeFlowerDecoy(caster: Hero, _targets: Hero[], state: GameState): SkillExecuteResult {
        const cell=clickedCell(caster), body=lockFlowerBody(state,caster);
        if(!cell || !body?.position || !flowerArea(body.position,2).some(p=>same(p,cell)) || state.board[cell[0]]?.[cell[1]]!==null)return reject('请选择花影本体两格内的空格');
        const shadow=placeFlowerDecoy(state,caster,body,cell);
        state.pendingBoardAction={type:'flower-swap',heroId:caster.id,flowerShadowId:shadow.id};
        return {success:true,log:[`${caster.name}唤出花影，可选择换影或留在原位`],fxCoveredPositions:[cell]};
}
export function executeFlowerFog(caster: Hero, _targets: Hero[], state: GameState): SkillExecuteResult {
        const cell=clickedCell(caster);
        if(!cell || !caster.position || !flowerArea(caster.position).some(p=>same(p,cell)))return reject('请选择自身3×3内的花雾中心');
        const oldFogs=(state.boardEffects??[]).filter(e=>e.owner===caster.owner && flowerFogCovers(e,caster.position!));
        const ambushIds=state.board.flat().filter((h):h is Hero=>!!h && h.owner!==caster.owner && !!h.position && oldFogs.some(e=>flowerFogCovers(e,h.position!))).map(h=>h.id);
        plantFlowerFog(state,caster,cell);
        const binder=getRageBinder(caster,state);
        if(flowerArea(cell).some(([r,c])=>flowerCanStabCell(state,caster,[r,c])&&(!binder||binder.id===state.board[r][c]?.id))) {
            state.pendingBoardAction={type:'flower-stab',heroId:caster.id,flowerCenter:cell,flowerAmbushIds:ambushIds};
        }
        return {success:true,log:[`${caster.name}铺开花雾`],fxCoveredPositions:flowerArea(cell)};
}

/** 只结算选择本身，不推进回合；人机试算可用同一路径。 */
export function resolveFlowerChoice(state:GameState, hero:Hero, cell:Position): boolean {
    const p=state.pendingBoardAction, origin=hero.position;
    if(!p || p.heroId!==hero.id || !origin || !flowerChoiceCells(state,hero).some(x=>same(x,cell)))return false;
    const skip=same(origin,cell);
    const victim=p.type==='flower-stab'&&!skip?state.board[cell[0]][cell[1]]:null;
    const binder=p.type==='flower-stab'&&!skip?getRageBinder(hero,state):null;
    if(binder && binder.id!==victim?.id)return false;
    state.pendingBoardAction=undefined;
    if(skip)return true;
    if(p.type==='flower-swap') {
        const shadow=state.board[cell[0]][cell[1]], body=shadow&&[...state.player1Heroes,...state.player2Heroes].find(h=>h.id===flowerDecoyBodyId(shadow.id));
        if(body && shadow)swapFlowerDecoy(state,body,shadow);
        syncPositionAnchoredEffects(state);
    } else if(p.type==='flower-escape') {
        state.board[origin[0]][origin[1]]=null; hero.position=[...cell]; state.board[cell[0]][cell[1]]=hero;
        delete hero.counters[REVEALED]; syncPositionAnchoredEffects(state);
    } else if(victim) {
        const fromPos:Position=[...origin], logStart=state.battleLog.length;
        const amount=p.flowerAmbushIds?.includes(victim.id)?10:7;
        DamageCalculator.withActiveSkill(hero,()=>DamageCalculator.applyDamage(victim,DamageCalculator.calculate(hero,victim,amount,false,false),hero,state));
        const logs=state.battleLog.slice(logStart).filter(l=>l.details?.sourceHeroId===hero.id && l.type==='damage');
        const logId=nextBattleLogId();
        state.battleLog.push({id:logId,type:'skill',player:hero.owner,message:`${hero.name}从花雾中出剑`,timestamp:Date.now()});
        const impacts = collectImpactPositions(logs, cell);
        requestSkillFx({skillId:'flower_fog_stab',sourceHeroId:hero.id,owner:hero.owner,fromPos,targetPos:[...cell],
            impactPositions:impacts.impactPositions ?? [],damagePositions:impacts.damagePositions ?? [],coveredPositions:[cell],logIds:[...logs.map(l=>l.id),logId]},state);
    } else if(p.type==='flower-stab') {
        revealFlowerAttacker(state,hero);
        if(finishFlowerAttack(state,hero))syncPositionAnchoredEffects(state);
        const logId = nextBattleLogId();
        state.battleLog.push({id:logId,type:'skill',player:hero.owner,message:`${hero.name}向花雾盲刺，未命中目标`,timestamp:Date.now()});
        requestSkillFx({skillId:'flower_fog_stab',sourceHeroId:hero.id,owner:hero.owner,fromPos:[...origin],targetPos:[...cell],
            impactPositions:[],damagePositions:[],coveredPositions:[cell],logIds:[logId]},state);
    }
    return true;
}

export function chooseFlowerAnswer(state:GameState,hero:Hero):Position|null {
    const pending=state.pendingBoardAction;
    if(!pending || !hero.position)return null;
    const choices=flowerChoiceCells(state,hero).filter(p=>!same(p,hero.position!));
    if(pending.type==='flower-stab') {
        const binder=getRageBinder(hero,state);
        return choices.filter(([r,c])=>{const h=state.board[r][c];return h&&!hiddenByFlowerFog(h,state,hero.owner)&&(!binder||h.id===binder.id);})
            .sort(([r,c],[y,x])=>(state.board[r][c]?.currentHp??100)-(state.board[y][x]?.currentHp??100))[0] ?? hero.position;
    }
    return pending.type==='flower-escape' ? choices[0] ?? hero.position : hero.position;
}

export function triggerFlowerEscape(hero:Hero,state:GameState,center?:Position) {
    if(hero.state!==HeroState.ALIVE || !hero.position || hero.counters['__flower_tianwei_round']===state.roundNumber)return;
    hero.counters['__flower_tianwei_round']=state.roundNumber;
    const pos=center??hero.position;
    plantFlowerFog(state,hero,pos);
    DamageCalculator.addBattleLog(state,{type:'tianwei',player:hero.owner,message:`${hero.name}触发「花开无声」，花雾绽开`});
    // 非本人行动触发天威时只落雾，不抢走对手的控制权。
    if(state.currentPlayer===hero.owner && !state.pendingBoardAction && flowerArea(pos).some(([r,c])=>!state.board[r][c])) {
        state.pendingBoardAction={type:'flower-escape',heroId:hero.id,flowerCenter:pos};
    } else if(flowerFogAt(state,hero.position,hero.owner)) delete hero.counters[REVEALED];
}
