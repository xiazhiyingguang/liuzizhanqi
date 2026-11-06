import { DamageCalculator } from '../core/damage-calculator';
import { getRageBinder } from '../core/taunt';
import { zhizhiValue } from '../core/hero-zhizhi';
import { CANGLAN_SKILL1, CANGLAN_SKILL2, TIDE_EDGE, CONDENSED_WATER, canglanCells, canglanEnemy,
    gainCanglanLayer, commitCanglanCast, lockCanglanCast } from '../core/canglan';
import { HeroState, type Hero, type Position, type SkillExecuteResult, type GameState } from '../types/game';

function castCanglan(caster: Hero, state: GameState, id: string, clicked?: Position): SkillExecuteResult {
    const origin = caster.position;
    if (!origin || caster.state !== HeroState.ALIVE) return { success: false, log: ['顾行舟不在场上'] };
    const transformed = lockCanglanCast(caster);
    const cells = canglanCells(origin, id, transformed, clicked);
    const enemies = cells.map(cell => canglanEnemy(caster, state, cell)).filter((hero): hero is Hero => !!hero);
    if (!enemies.length) return { success: false, log: ['当前施法范围内没有合法敌人'] };
    const binder = getRageBinder(caster, state);
    if (binder && !enemies.some(enemy => enemy.id === binder.id)) return { success: false, log: [`本次攻击必须覆盖${binder.name}`] };

    const first = id === CANGLAN_SKILL1;
    const tier = zhizhiValue(caster, 2, 20, 25);
    const damageBonus = transformed ? (caster.counters[TIDE_EDGE] ?? 0) * tier : 0;
    const drain = transformed ? (caster.counters[CONDENSED_WATER] ?? 0) * tier : 0;
    // 先快照并消耗，后触发击杀：这一手的天威补层不会被清除，也不会反哺同一次群攻。
    if (transformed) { caster.counters[TIDE_EDGE] = 0; caster.counters[CONDENSED_WATER] = 0; }
    commitCanglanCast(caster, transformed);
    const base = first ? (transformed ? 10 : 8) : (transformed ? 6 : 4);
    const amount = base * (100 + damageBonus) / 100;
    const damageDealt: number[] = [];
    let hpLost = 0;
    DamageCalculator.asOneAttack(() => {
        for (const enemy of enemies) {
            if (enemy.state !== HeroState.ALIVE) continue;
            const hit = DamageCalculator.calculate(caster, enemy, amount, false, false);
            DamageCalculator.applyDamage(enemy, hit, caster, state, !first || transformed);
            damageDealt.push(hit.finalDamage);
            hpLost += hit.appliedHpDamage ?? 0;
        }
    });
    const restored = caster.state === HeroState.ALIVE && drain > 0
        ? DamageCalculator.applyHeal(caster, Math.floor(hpLost * drain / 100), state, caster) : 0;
    if (!transformed) gainCanglanLayer(caster, first ? TIDE_EDGE : CONDENSED_WATER);
    state.skillFxExtras = {
        fromPos: [...origin], targetPos: first ? [...clicked!] : [...origin], coveredPositions: cells,
        fxVariant: transformed ? `${id}_phantom` : undefined,
    };
    return { success: true, damageDealt, healingDone: restored ? [restored] : [], fxCoveredPositions: cells,
        log: [`${caster.name}施展${transformed ? '幻化·' : ''}${first ? '截潮' : '回澜'}，覆盖${cells.length}格`] };
}

export function executeCanglanSlash(caster: Hero, _targets: Hero[], state: GameState): SkillExecuteResult {
    const n = caster.counters['__extended_target'];
    return castCanglan(caster, state, CANGLAN_SKILL1, n === undefined ? undefined : [Math.floor(n / 6), n % 6]);
}
export function executeCanglanSweep(caster: Hero, _targets: Hero[], state: GameState): SkillExecuteResult {
    return castCanglan(caster, state, CANGLAN_SKILL2);
}
