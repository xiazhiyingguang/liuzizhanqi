import { describe, expect, it } from 'vitest';
import { ALL_HERO_STATUS_FX_KINDS, statusFxKindByCounter, statusFxKindByEffectName } from '../../src/core/hero-status-fx';
import { BATTLE_GLOSSARY } from '../../src/core/battle-glossary';
import { resolveCounterGlyphId, resolveEffectGlyphId, resolveTermGlyphId } from '../../src/core/hero-status-icons';

describe('状态字形反查', () => {
    it('棋盘特效表里的每个 kind 都能由效果名或计数器反查回来', () => {
        // 图标层靠这两条反查取字形，反查漏一个 kind 就会让那个状态在卡片上退化成通用标记
        expect(ALL_HERO_STATUS_FX_KINDS.length).toBeGreaterThan(30);
        expect(statusFxKindByEffectName('冰冻')).toBe('frozen');
        expect(statusFxKindByEffectName('链式闪电')).toBe('chainmark');
        expect(statusFxKindByEffectName('不存在的状态')).toBeNull();
        expect(statusFxKindByCounter('破镜之刃')).toBe('mirror-blade');
        expect(statusFxKindByCounter('不存在的计数器')).toBeNull();
    });

    it('已登记的状态名解析出专属字形，而不是通用标记', () => {
        const names = ['冰冻', '寒天', '眩晕', '麻痹', '潜行', '灼烧', '流血', '羽化', '恐惧', '凋零', '金银错', '猎杀令'];
        const glyphs = names.map(name => resolveEffectGlyphId(name, 'debuff'));
        expect(glyphs).toEqual(['ice', 'frost', 'stun', 'lock', 'veil', 'flame', 'drop', 'wind', 'fear', 'wither', 'mirror', 'sight']);
        expect(glyphs).not.toContain('mark');
    });

    it('同族变体走前缀规则收口，不必逐个登记', () => {
        expect(resolveEffectGlyphId('阳线攻击', 'buff')).toBe('sun');
        expect(resolveEffectGlyphId('阳线免伤', 'buff')).toBe('sun');
        expect(resolveEffectGlyphId('阴线攻击降低', 'debuff')).toBe('wither');
        expect(resolveEffectGlyphId('缚魂吸血·永驻', 'buff')).toBe('fang');
        // 悬赏的四色效果在棋盘表里有独立 kind，优先级高于「悬赏·」前缀
        expect(resolveEffectGlyphId('悬赏·天威再临', 'buff')).toBe('seal');
    });

    it('完全没登记的名字按效果类型兜底，保证不留空图标', () => {
        expect(resolveEffectGlyphId('某个新状态', 'buff')).toBe('surge');
        expect(resolveEffectGlyphId('某个新状态', 'debuff')).toBe('decline');
        expect(resolveEffectGlyphId('某个新状态', 'mark')).toBe('mark');
        expect(resolveEffectGlyphId('某个新状态', 'shield')).toBe('shield');
        expect(resolveEffectGlyphId('某个新状态', 'stun')).toBe('stun');
        expect(resolveEffectGlyphId('某个新状态', 'control')).toBe('lock');
    });

    it('玩家向计数器各有字形', () => {
        expect(resolveCounterGlyphId('破锋')).toBe('blade');
        expect(resolveCounterGlyphId('猎砂')).toBe('claw');
        expect(resolveCounterGlyphId('财气')).toBe('coin');
        expect(resolveCounterGlyphId('月相')).toBe('moon');
        expect(resolveCounterGlyphId('醉意')).toBe('cup');
        expect(resolveCounterGlyphId('潮汐')).toBe('tide');
    });
});

describe('战报术语字形', () => {
    it('战斗规则类词条有专属字形', () => {
        expect(resolveTermGlyphId('天威')).toBe('seal');
        expect(resolveTermGlyphId('护盾')).toBe('shield');
        expect(resolveTermGlyphId('暴击')).toBe('spark');
        expect(resolveTermGlyphId('复活')).toBe('bloom');
        expect(resolveTermGlyphId('真实死亡')).toBe('bone');
        expect(resolveTermGlyphId('暂时阵亡')).toBe('hourglass');
        expect(resolveTermGlyphId('额外行动')).toBe('surge');
        expect(resolveTermGlyphId('闪避')).toBe('veil');
        expect(resolveTermGlyphId('吸血')).toBe('fang');
    });

    it('战斗状态与英雄机制复用状态解析链，术语与状态卡同一枚字形', () => {
        expect(resolveTermGlyphId('冰冻')).toBe(resolveEffectGlyphId('冰冻', 'debuff'));
        expect(resolveTermGlyphId('眩晕')).toBe('stun');
        expect(resolveTermGlyphId('阳线')).toBe('sun');
        expect(resolveTermGlyphId('阴线')).toBe('wither');
        expect(resolveTermGlyphId('破锋')).toBe('blade');
        expect(resolveTermGlyphId('光棱')).toBe('prism');
        expect(resolveTermGlyphId('猎砂')).toBe('claw');
        expect(resolveTermGlyphId('月相盈亏')).toBe('moon');
        expect(resolveTermGlyphId('水泽')).toBe('tide');
        expect(resolveTermGlyphId('愤怒')).toBe('lock');
    });

    it('整张术语表都能解析，只有"标记"这一条刻意用通用字形', () => {
        const fellBack = BATTLE_GLOSSARY
            .filter(entry => resolveTermGlyphId(entry.term) === 'mark')
            .map(entry => entry.term);
        expect(fellBack).toEqual(['标记']);
    });
});
