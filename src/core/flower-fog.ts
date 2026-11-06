import { BOARD_SIZE, HeroState, type BoardEffect, type GameState, type Hero, type Player, type Position, type Skill } from '../types/game';

export const FLOWER_PASSIVE = 'flower_fog_passive';
export const FLOWER_SKILL1 = 'flower_fog_skill1';
export const FLOWER_SKILL2 = 'flower_fog_skill2';
export const FLOWER_TIANWEI = 'flower_fog_tianwei';
export const FLOWER_SHADOW_PREFIX = 'flower-decoy|';
export const REVEALED = '__flower_fog_revealed';
const LOCK = '__flower_body_slot';
const EXPIRE = '__flower_expires';
const HAS_SHADOW = '__flower_shadow_active';
type FogState = Pick<GameState, 'boardEffects'>;
type Teams = Pick<GameState, 'player1Heroes' | 'player2Heroes'>;
export type FlowerChoice = 'flower-swap' | 'flower-stab' | 'flower-escape';
export function isFlowerChoice(type?: string): type is FlowerChoice { return type === 'flower-swap' || type === 'flower-stab' || type === 'flower-escape'; }
export function isFlowerDecoy(hero: Hero) { return hero.id.startsWith(FLOWER_SHADOW_PREFIX); }
export function flowerDecoyBodyId(id: string) { return id.startsWith(FLOWER_SHADOW_PREFIX) ? id.split('|')[2] : undefined; }
export function flowerFogCovers(effect: BoardEffect, [r,c]: Position) {
    return effect.type === 'flower-fog' && Math.max(Math.abs(effect.position[0]-r),Math.abs(effect.position[1]-c)) <= 1;
}
export function flowerFogAt(state: FogState, pos: Position, owner?: Player) {
    return state.boardEffects?.find(e => (!owner || e.owner === owner) && flowerFogCovers(e, pos));
}
export function hiddenByFlowerFog(hero: Hero, state: FogState, viewer: Player) {
    return hero.owner !== viewer && hero.state === HeroState.ALIVE && !hero.counters[REVEALED] &&
        !!hero.position && !!flowerFogAt(state, hero.position, hero.owner);
}
export function flowerViewer(state: { currentPlayer: Player; isOnlineMode?: boolean; localPlayerNumber?: number; isAiMode?: boolean }): Player {
    return state.isOnlineMode ? state.localPlayerNumber === 2 ? 'player2' : 'player1' : state.isAiMode ? 'player1' : state.currentPlayer;
}
export function flowerArea([r,c]: Position, radius = 1): Position[] {
    const out: Position[] = [];
    for (let y=Math.max(0,r-radius);y<=Math.min(BOARD_SIZE-1,r+radius);y++) {
        for (let x=Math.max(0,c-radius);x<=Math.min(BOARD_SIZE-1,c+radius);x++) out.push([y,x]);
    }
    return out;
}
export function plantFlowerFog(state: GameState, hero: Hero, center: Position) {
    const fog: BoardEffect = { id:`flower-fog:${hero.id}`, type:'flower-fog', owner:hero.owner, sourceHeroId:hero.id, position:[...center], duration:2 };
    state.boardEffects = [...(state.boardEffects ?? []).filter(e=>e.id!==fog.id), fog];
    return fog;
}
export function flowerTeam(state: Teams, owner: Player) { return owner === 'player1' ? state.player1Heroes : state.player2Heroes; }
export function flowerBody(state: Teams, caster: Hero): Hero | undefined {
    return flowerTeam(state,caster.owner)[caster.counters[LOCK] ?? -1];
}
export function lockFlowerBody(state: Teams, caster: Hero) {
    const locked = flowerBody(state,caster);
    if (locked?.state === HeroState.ALIVE && locked.position) return locked;
    const team = flowerTeam(state,caster.owner), candidates = team.filter(h=>h.state===HeroState.ALIVE && h.position);
    if (!candidates.length) return undefined;
    const body = candidates[Math.floor(Math.random()*candidates.length)];
    caster.counters[LOCK] = team.indexOf(body);
    return body;
}
export function flowerPlacementCells(state: Pick<GameState,'board'|'player1Heroes'|'player2Heroes'>, caster: Hero): Position[] {
    const locked = flowerBody(state,caster);
    const bodies = locked ? [locked] : flowerTeam(state,caster.owner);
    const cells = new Map<string,Position>();
    for (const b of bodies) if (b.state===HeroState.ALIVE && b.position) {
        for (const p of flowerArea(b.position,2)) if (!state.board[p[0]][p[1]]) cells.set(p.join(','),p);
    }
    return [...cells.values()];
}
export function removeFlowerDecoy(state: GameState, shadow: Hero) {
    if(shadow.state===HeroState.ALIVE) {
        const body=flowerTeam(state,shadow.owner).find(h=>h.id===flowerDecoyBodyId(shadow.id));
        if(body)body.counters[HAS_SHADOW]=Math.max(0,(body.counters[HAS_SHADOW]??0)-1);
    }
    if(shadow.position && state.board[shadow.position[0]]?.[shadow.position[1]]?.id===shadow.id) state.board[shadow.position[0]][shadow.position[1]]=null;
    shadow.position=null; shadow.state=HeroState.DEAD;
}
export function placeFlowerDecoy(state: GameState, caster: Hero, body: Hero, pos: Position) {
    for (const unit of state.board.flat()) if(unit?.id.startsWith(`${FLOWER_SHADOW_PREFIX}${caster.id}|`)) removeFlowerDecoy(state,unit);
    const shadow: Hero = { ...body, id:`${FLOWER_SHADOW_PREFIX}${caster.id}|${body.id}`, position:[...pos],
        maxHp:10, currentHp:10, shield:0, defense:0, moveRange:0, baseAttack:0, weaponId:null,
        skill1Id:'', skill2Id:'', passiveId:'', tianweiId:undefined, effects:[], killCount:0,
        hasActedThisTurn:true, hasMovedThisTurn:true, counters:{__isSummon:1,[EXPIRE]:state.roundNumber+2} };
    state.board[pos[0]][pos[1]]=shadow; body.counters[HAS_SHADOW]=(body.counters[HAS_SHADOW]??0)+1;
    delete caster.counters[LOCK]; return shadow;
}
export function expireFlowerDecoys(state: GameState) {
    for(const unit of state.board.flat()) if(unit && isFlowerDecoy(unit) && (unit.counters[EXPIRE]??0)<=state.roundNumber) removeFlowerDecoy(state,unit);
}
export function swapFlowerDecoy(state: GameState, body: Hero, shadow: Hero): boolean {
    if (!body.position || !shadow.position || body.state!==HeroState.ALIVE || shadow.state!==HeroState.ALIVE || flowerDecoyBodyId(shadow.id)!==body.id) return false;
    const a=body.position,b=shadow.position;
    if(state.board[a[0]][a[1]]!==body || state.board[b[0]][b[1]]!==shadow)return false;
    body.position=b; shadow.position=a; state.board[b[0]][b[1]]=body; state.board[a[0]][a[1]]=shadow;
    // 花影照出同样的显形状态，换影本身不附带任何逐格攻击。
    if(body.counters[REVEALED]) shadow.counters[REVEALED]=1;
    return true;
}
export function revealFlowerAttacker(state: FogState, attacker: Hero) {
    if (!attacker.position || !flowerFogAt(state, attacker.position, attacker.owner)) return;
    attacker.counters[REVEALED] = 1;
}
export function finishFlowerAttack(state: GameState, attacker: Hero): boolean {
    if(!attacker.counters[HAS_SHADOW])return false;
    const shadows=state.board.flat().filter((h):h is Hero=>!!h && flowerDecoyBodyId(h.id)===attacker.id);
    if(!shadows.length || attacker.state!==HeroState.ALIVE)return false;
    const shadow=shadows[0];
    return Math.random()<.5 && swapFlowerDecoy(state,attacker,shadow);
}
export function startFlowerAction(state: Pick<GameState,'board'>, hero: Hero) {
    delete hero.counters[REVEALED];
    if(!hero.counters[HAS_SHADOW])return;
    for(const unit of state.board.flat()) if(unit && flowerDecoyBodyId(unit.id)===hero.id)delete unit.counters[REVEALED];
}
export function isFlowerBlindCell(skill: Skill, caster: Hero, state: GameState, cell: Position) {
    return skill.type==='damage' && skill.targetType==='enemy' && skill.rangeType==='single' && skill.targetCount===1 &&
        state.board[cell[0]]?.[cell[1]]?.owner!==caster.owner &&
        !!flowerFogAt(state,cell,caster.owner==='player1'?'player2':'player1');
}
export function flowerCanStabCell(state: Pick<GameState,'board'|'boardEffects'>,hero:Hero,cell:Position) {
    const unit=state.board[cell[0]][cell[1]];
    return unit?.owner!==hero.owner && (unit?.state===HeroState.ALIVE || !!flowerFogAt(state,cell,hero.owner==='player1'?'player2':'player1'));
}
export function flowerChoiceCells(state: Pick<GameState,'board'|'pendingBoardAction'|'boardEffects'>, hero: Hero): Position[] {
    const p=state.pendingBoardAction;
    if(!p || !hero.position || !isFlowerChoice(p.type))return [];
    if(p.type==='flower-swap') {
        const shadow=state.board.flat().find(h=>h?.id===p.flowerShadowId);
        return shadow?.position ? [hero.position,shadow.position] : [hero.position];
    }
    const area=p.flowerCenter ? flowerArea(p.flowerCenter) : [];
    const legal=area.filter(([r,c])=>p.type==='flower-escape' ? !state.board[r][c]
        : flowerCanStabCell(state,hero,[r,c]));
    return [hero.position,...legal];
}
