import type { GameState, Hero, Position } from '../types/game';
import { nextBattleLogId } from './battle-log-id';
import { requestSkillFx } from '../data/extended-skills';

const MECHANISM_MESSAGES = {
    changli_rebirth: '长夜轮回复生',
    jetzmi_king_shift: '切换为终焉国王形态',
    jetzmi_lord_shift: '切换为亡灵城主形态',
    xuanxiao_conversion: '化险为夷',
    zhenxiao_counter: '金银错回击',
    zhenxiao_laststand: '龙势护身，抵住致命伤害',
    moran_extra_action: '为道触发再动',
} as const;


/** 坐标在结算瞬间快照；描述挂到权威日志，远端与回放可复用同一事件。 */
export function requestMechanismFx(
    hero: Hero,
    skillId: keyof typeof MECHANISM_MESSAGES,
    gameState: GameState,
    options: { fromPos?: Position; targetPos?: Position; damagePositions?: Position[]; softImpactPositions?: Position[]; logId?: string } = {},
): void {
    const from = options.fromPos ?? hero.position;
    const target = options.targetPos ?? hero.position;
    if (!from || !target) return;
    let logId = options.logId;
    if (!logId) {
        logId = nextBattleLogId();
        gameState.battleLog.push({ id: logId, type: 'passive', player: hero.owner,
            message: `${hero.name}${MECHANISM_MESSAGES[skillId]}`, timestamp: Date.now() });
    }
    requestSkillFx({ skillId, owner: hero.owner, sourceHeroId: hero.id,
        fromPos: [...from], targetPos: [...target],
        impactPositions: [[...target]], coveredPositions: [],
        damagePositions: options.damagePositions?.map(pos => [...pos]) ?? [], logIds: [logId],
        softImpactPositions: options.softImpactPositions?.map(pos => [...pos]),
    }, gameState);
}
