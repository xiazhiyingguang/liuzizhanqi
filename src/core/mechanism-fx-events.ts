import type { BattleLogEntry } from '../types/game';
import type { SkillFxEvent } from './skill-fx';

const isFormShift = (id?: string) => id === 'jetzmi_king_shift' || id === 'jetzmi_lord_shift';

/** 同一次施法的冠合成一份；纯视觉判断不引入结算模块的初始化依赖。 */
export function sharesFormShiftCast(a: Pick<SkillFxEvent, 'skillId' | 'sourceHeroId' | 'logIds'>,
    b: Pick<SkillFxEvent, 'skillId' | 'sourceHeroId' | 'logIds'>): boolean {
    return !!a.sourceHeroId && a.sourceHeroId === b.sourceHeroId &&
        ((a.skillId === 'jetzmi_skill2' && isFormShift(b.skillId)) || (b.skillId === 'jetzmi_skill2' && isFormShift(a.skillId))) &&
        !!a.logIds?.some(id => b.logIds?.includes(id));
}

/** 主技的数字仍只匹配自身伤害日志，切形日志仅补充同手动画身份。 */
export function collectFormShiftLogIds(logs: BattleLogEntry[], sourceHeroId?: string): string[] {
    if (!sourceHeroId) return [];
    return logs.filter(log => {
        const request = log.details?.skillFxRequest as Pick<SkillFxEvent, 'skillId' | 'sourceHeroId'> | undefined;
        return isFormShift(request?.skillId) && request?.sourceHeroId === sourceHeroId;
    }).map(log => log.id);
}
