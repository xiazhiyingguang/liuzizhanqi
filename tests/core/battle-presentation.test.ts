import { describe, expect, it } from 'vitest';
import {
    getBattleOutcomePresentation,
    getKillAnnouncementTier,
    getLatestKillAnnouncement,
    getTurnOperatorLabel,
    tokenizeBattleLogContent,
    tokenizeBattleLogMessage
} from '../../src/core/battle-presentation';

describe('battle presentation', () => {
    it('联机双方根据本地玩家身份分别看到胜利和失败', () => {
        expect(getBattleOutcomePresentation('player1', true, 1)).toMatchObject({
            result: 'victory',
            mark: '胜',
            title: '胜利'
        });
        expect(getBattleOutcomePresentation('player1', true, 2)).toMatchObject({
            result: 'defeat',
            mark: '败',
            title: '失败'
        });
    });

    it('人机模式根据玩家一的胜负显示不同结局', () => {
        expect(getBattleOutcomePresentation('player1', false, undefined, true)).toMatchObject({
            result: 'victory',
            title: '胜利'
        });
        expect(getBattleOutcomePresentation('player2', false, undefined, true)).toMatchObject({
            result: 'defeat',
            title: '失败'
        });
    });

    it('把战报中的英雄名称拆成可高亮片段', () => {
        const tokens = tokenizeBattleLogMessage('墨阑对暗影猎手·夜枭造成12点伤害', [
            { name: '墨阑', owner: 'player1' },
            { name: '暗影猎手·夜枭', owner: 'player2' }
        ]);

        expect(tokens.filter(token => token.owner)).toEqual([
            { text: '墨阑', owner: 'player1' },
            { text: '暗影猎手·夜枭', owner: 'player2' }
        ]);
    });

    it('按完整长度区分以英雄名开头的术语和以术语开头的英雄名', () => {
        const tokens = tokenizeBattleLogContent('白泽获得白泽之力，凋零之主施加凋零', [
            { name: '白泽', owner: 'player1' },
            { name: '凋零之主', owner: 'player2' }
        ]);

        expect(tokens.filter(token => token.owner).map(token => token.text)).toEqual([
            '白泽',
            '凋零之主'
        ]);
        expect(tokens.filter(token => token.glossary).map(token => token.text)).toEqual([
            '白泽之力',
            '凋零'
        ]);
    });

    it('联机行动提示能区分自己和对手', () => {
        expect(getTurnOperatorLabel('player1', true, 1)).toBe('玩家一（你）');
        expect(getTurnOperatorLabel('player2', true, 1)).toBe('玩家二（对手）');
        expect(getTurnOperatorLabel('player2', false, undefined)).toBe('玩家二');
        expect(getTurnOperatorLabel('player2', false, undefined, true)).toBe('宗师电脑');
        expect(getTurnOperatorLabel('player1', false, undefined, true)).toBe('玩家一（你）');
    });

    it('按英雄累计击杀数生成一到四杀播报，并将更高击杀数封顶为四杀', () => {
        expect(getKillAnnouncementTier(1)).toBe(1);
        expect(getKillAnnouncementTier(2)).toBe(2);
        expect(getKillAnnouncementTier(3)).toBe(3);
        expect(getKillAnnouncementTier(4)).toBe(4);
        expect(getKillAnnouncementTier(8)).toBe(4);

        const announcement = getLatestKillAnnouncement([{
            id: 'kill-3',
            timestamp: 100,
            type: 'kill',
            player: 'player1',
            message: '墨阑击杀了白泽',
            details: {
                kind: 'hero-kill',
                killerHeroId: 'moran-p1',
                killerName: '墨阑',
                victimHeroId: 'baize-p2',
                victimName: '白泽',
                killCount: 3
            }
        }]);

        expect(announcement).toMatchObject({
            id: 'kill-3',
            killerHeroId: 'moran-p1',
            killerName: '墨阑',
            victimName: '白泽',
            player: 'player1',
            tier: 3,
            title: '三连决胜'
        });
    });
});
