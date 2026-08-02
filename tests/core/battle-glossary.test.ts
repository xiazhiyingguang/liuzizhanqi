import { describe, expect, it } from 'vitest';
import { tokenizeBattleGlossaryText } from '../../src/core/battle-glossary';

describe('battle glossary', () => {
    it('识别战报中的规则词、状态词和英雄机制词', () => {
        const tokens = tokenizeBattleGlossaryText('触发天威并获得额外行动，下一次攻击无视防御');

        expect(tokens.filter(token => token.glossary).map(token => token.text)).toEqual([
            '天威',
            '额外行动',
            '无视防御'
        ]);
    });

    it('优先匹配完整长词，避免拆开真实死亡和暴击率', () => {
        const tokens = tokenizeBattleGlossaryText('目标真实死亡，攻击者获得暴击率提升');
        const glossaryTokens = tokens.filter(token => token.glossary);

        expect(glossaryTokens.map(token => token.text)).toEqual(['真实死亡', '暴击率']);
        expect(glossaryTokens[0].glossary?.title).toBe('真实死亡');
    });

    it('保留未命中的普通战报文字', () => {
        expect(tokenizeBattleGlossaryText('造成12点伤害')).toEqual([{ text: '造成12点伤害' }]);
    });

    it('覆盖扩展英雄的链接、资源与观测机制', () => {
        const tokens = tokenizeBattleGlossaryText(
            '建立阳线并获得和声，观测坍缩后积累财气与恐惧情绪能量'
        );

        expect(tokens.filter(token => token.glossary).map(token => token.text)).toEqual([
            '阳线',
            '和声',
            '观测坍缩',
            '财气',
            '恐惧情绪能量'
        ]);
    });
});
