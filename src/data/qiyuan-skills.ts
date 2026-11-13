import { DamageCalculator } from '../core/damage-calculator';
import { nextBattleLogId } from '../core/battle-log-id';
import { QIYUAN_DELAY, qiyuanAllyOnBoard, qiyuanCross, qiyuanPlan, qiyuanTargets } from '../core/qiyuan';
import { HeroState, type GameState, type Hero, type Position, type QiyuanWish, type SkillExecuteResult } from '../types/game';
import { requestSkillFx } from './extended-skills';

function onBoard(state: GameState, hero?: Hero): hero is Hero & { position: Position } {
    return !!hero?.position && hero.state === HeroState.ALIVE && state.board[hero.position[0]]?.[hero.position[1]] === hero;
}

function resolveWish(state: GameState, plan: QiyuanWish, early: boolean): number[] {
    const heroes = [...state.player1Heroes, ...state.player2Heroes];
    const source = heroes.find(unit => unit.id === plan.sourceHeroId);
    const target = heroes.find(unit => unit.id === plan.targetHeroId);
    if (!onBoard(state, source)) return [];
    const targets = plan.kind === 'wish' ? (onBoard(state, target) ? [target] : [])
        : qiyuanCross(source.position).map(pos => qiyuanAllyOnBoard(state, source, pos)).filter((unit): unit is Hero => !!unit);
    const hp = early ? Math.floor(plan.heal / 2) : plan.heal;
    const before = new Set(state.battleLog.map(log => log.id));
    const healed = targets.map(unit => DamageCalculator.applyHeal(unit, hp, state, source));
    const logId = nextBattleLogId();
    state.battleLog.push({ id: logId, type: 'skill', player: source.owner, timestamp: Date.now(),
        message: `${source.name}${early ? '提前兑现' : '如期兑现'}「${plan.kind === 'wish' ? '许愿' : '守愿'}」${targets.length ? '' : '，目标已不在场'}` });
    // 提前兑现由主动施法包装层播放；到期独立同步日志锚点。
    const cells = targets.flatMap(unit => unit.position ? [unit.position] : []);
    if (!early && cells.length) requestSkillFx({
        skillId: plan.kind === 'wish' ? 'qiyuan_wish_arrive' : 'qiyuan_guard_arrive', owner: source.owner, sourceHeroId: source.id,
        fromPos: source.position, targetPos: plan.kind === 'wish' ? cells[0] : source.position,
        impactPositions: cells, softImpactPositions: cells, damagePositions: [],
        logIds: state.battleLog.filter(log => !before.has(log.id)).map(log => log.id),
    }, state);
    return healed;
}

export function settleQiyuanWishes(state: GameState): void {
    const all = state.qiyuanWishes;
    if (!all?.some(plan => plan.dueRound <= state.roundNumber)) return;
    state.qiyuanWishes = all.filter(plan => plan.dueRound > state.roundNumber);
    for (const plan of all) if (plan.dueRound <= state.roundNumber) resolveWish(state, plan, false);
}

function cast(kind: QiyuanWish['kind'], caster: Hero, state: GameState): SkillExecuteResult {
    const key = caster.counters['__extended_target'];
    const cell: Position | undefined = key === undefined ? undefined : [Math.floor(key / 6), key % 6];
    if (!cell || !onBoard(state, caster) || !qiyuanTargets(caster, kind, state).some(([r,c]) => r === cell[0] && c === cell[1])) {
        return { success: false, log: ['请选择有效的祈愿目标'] };
    }
    const existing = qiyuanPlan(state, caster, kind);
    if (existing) {
        const target = [...state.player1Heroes, ...state.player2Heroes].find(unit => unit.id === existing.targetHeroId);
        if (kind === 'wish' && !onBoard(state, target)) return { success: false, log: ['许愿目标当前不在场，不能提前兑现'] };
        delete caster.counters[QIYUAN_DELAY];
        state.qiyuanWishes = state.qiyuanWishes?.filter(plan => plan !== existing);
        state.skillFxExtras = { targetPos: kind === 'wish' ? target!.position! : caster.position,
            coveredPositions: kind === 'wish' ? [target!.position!] : qiyuanCross(caster.position),
            fxVariant: kind === 'wish' ? 'qiyuan_wish_arrive' : 'qiyuan_guard_arrive' };
        const healingDone = resolveWish(state, existing, true);
        return { success: true, log: [], healingDone };
    }
    const target = kind === 'wish' ? qiyuanAllyOnBoard(state, caster, cell) : caster;
    if (!target) return { success: false, log: ['请选择5×5内存活的友方'] };
    const delay = caster.counters[QIYUAN_DELAY] === 2 ? 2 : 1;
    delete caster.counters[QIYUAN_DELAY];
    const heal = (kind === 'wish' ? 12 : 5) * delay;
    state.qiyuanWishes = [...(state.qiyuanWishes ?? []),
        { kind, sourceHeroId: caster.id, targetHeroId: target.id, dueRound: state.roundNumber + delay, heal }];
    return { success: true, log: [`${caster.name}${kind === 'wish' ? `为${target.name}许愿` : '开始守愿'}：第${state.roundNumber + delay}轮结算，治疗${heal}点`],
        fxCoveredPositions: kind === 'wish' ? [cell] : qiyuanCross(caster.position) };
}

export function castQiyuanWish(caster: Hero, _targets: Hero[], state: GameState): SkillExecuteResult {
    return cast('wish', caster, state);
}

export function castQiyuanGuard(caster: Hero, _targets: Hero[], state: GameState): SkillExecuteResult {
    return cast('guard', caster, state);
}
