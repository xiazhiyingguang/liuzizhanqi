import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { hitMotionFrames, resolveHitFeedback } from '../../src/core/hit-feedback';
import { HitContactFx } from '../../src/components/Game/HitFeedbackFx';
import type { BattleLogEntry } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';
afterEach(() => vi.restoreAllMocks());
function damageLog(shield: number, damage: number, critical = false, tag?: string) {
    vi.spyOn(Math, 'random').mockReturnValue(.99);
    const state = makeGameState();
    const caster = addHero(state, 'bounty', 'player1', [2, 1]);
    const target = addHero(state, 'moran', 'player2', [2, 3]);
    target.shield = shield;
    DamageCalculator.applyDamage(target, { finalDamage: damage, isCrit: critical, vampireAmount: 0, shieldDamage: 0, hpDamage: 0, killed: false, logTag: tag }, caster, state);
    return { entry: state.battleLog.find(log => log.type === 'damage')!, target };
}
describe('真实受击反馈', () => {
    it.each([
        [0, 5, false, 'normal', 5, 0, false],
        [0, 15, false, 'heavy', 15, 0, false],
        [0, 5, true, 'critical', 5, 0, false],
        [10, 4, false, 'shield-hit', 0, 4, false],
        [8, 8, false, 'shield-break', 0, 8, true],
        [6, 11, false, 'shield-break', 5, 6, true],
    ] as const)('盾 %i 伤害 %i 暴击 %s 按实际扣盾扣血区分反馈', (shield, amount, critical, kind, hp, absorbed, broken) => {
        const { entry, target } = damageLog(shield, amount, critical);
        expect(entry.details).toMatchObject({ hpDamage: hp, shieldDamage: absorbed, shieldBroken: broken, hitFrom: [2, 1], targetMaxHp: target.maxHp });
        const hit = resolveHitFeedback(entry, 1234)!;
        expect(hit.kind).toBe(kind);
        expect(hit.at).toBe(1234);
        expect(hit.angle).toBe(0);
        expect(hit.targetHeroId).toBe(target.id);
        expect(target.currentHp).toBe(target.maxHp - hp);
        expect(target.shield).toBe(Math.max(0, shield - amount));
    });
    it.each(['burn', 'bleed'])('%s 跳伤只保留既有轻量反馈，不产生重击顿挫', tag => {
        const { entry } = damageLog(0, 15, false, tag);
        expect(resolveHitFeedback(entry, 0)).toBeNull();
    });
    it('零伤害没有命中闪光或破盾反馈', () => {
        const { entry } = damageLog(8, 0, true);
        expect(entry.details?.shieldBroken).toBe(false);
        expect(resolveHitFeedback(entry, 0)).toBeNull();
    });
    it('治疗、闪避提示和无效坐标不会产生受击反馈', () => {
        const base: BattleLogEntry = { id: 'a', type: 'damage', player: 'player1', message: '', timestamp: 0, details: { amount: 12, position: [2, 3] } };
        expect(resolveHitFeedback({ ...base, type: 'heal' }, 0)).toBeNull();
        expect(resolveHitFeedback({ ...base, type: 'passive' }, 0)).toBeNull();
        expect(resolveHitFeedback({ ...base, details: { amount: 12, position: [-1, 6] } }, 0)).toBeNull();
        expect(resolveHitFeedback({ ...base, details: { amount: NaN, position: [2, 3] } }, 0)).toBeNull();
    });
    it('致命一击仍使用受害者的真实落格记录，阵亡不会吞掉接触闪光', () => {
        const { entry, target } = damageLog(0, 999);
        expect(target.currentHp).toBe(0);
        expect(resolveHitFeedback(entry, 0)).toMatchObject({ row: 2, col: 3, kind: 'heavy' });
    });
    it('重击只给棋子一个短促保持姿势，结束时准确回到原位', () => {
        const { entry } = damageLog(0, 15, true);
        const hit = resolveHitFeedback(entry, 0)!;
        const frames = hitMotionFrames(hit, hit.amplitude);
        expect(frames[1].transform).toBe(frames[2].transform);
        expect(frames.at(-1)?.transform).toBe('none');
        expect(hit.motionMs).toBeLessThan(300);
    });
    it('破盾与暴击能同时标识，但不复制整块格子发光罩', () => {
        const { entry } = damageLog(6, 11, true);
        const hit = resolveHitFeedback(entry, Date.now())!;
        const html = renderToStaticMarkup(<HitContactFx hit={hit}/>);
        expect(html).toContain('data-hit-kind="shield-break"');
        expect(html).toContain('hit-contact-crit');
        expect(html).toContain('破盾');
        expect(html).not.toContain('cell-fx-impact');
    });
    it('兼容旧日志，缺少破盾字段时不会凭空推断破盾', () => {
        const entry: BattleLogEntry = { id: 'old', type: 'damage', player: 'player1', message: '', timestamp: 0, details: { amount: 5, position: [1, 1] } };
        expect(resolveHitFeedback(entry, 0, [1, 0])).toMatchObject({ kind: 'normal', angle: 0 });
    });
});
