import { PassiveSkill, TianweiSkill } from '../types/game';

export const passiveRegistry: Record<string, PassiveSkill> = {};
export const tianweiRegistry: Record<string, TianweiSkill> = {};

export function registerPassive(skill: PassiveSkill) {
    passiveRegistry[skill.id] = skill;
}

export function getPassive(id: string): PassiveSkill | undefined {
    return passiveRegistry[id];
}

export function registerTianwei(skill: TianweiSkill) {
    tianweiRegistry[skill.id] = skill;
}

export function getTianwei(id: string): TianweiSkill | undefined {
    return tianweiRegistry[id];
}
