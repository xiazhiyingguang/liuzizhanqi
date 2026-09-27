import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../../src/data/heroes';
import { getHeroAbilityRatings } from '../../src/data/hero-ratings';
import { huanongyingSkill1 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import {
    chooseComputerDeployment,
    chooseComputerMove,
    chooseComputerSkillPlan,
    chooseComputerTeam,
    resetCachedComputerTeam,
    scoreComputerPosition,
} from '../../src/core/computer-ai';
import { addHero, makeGameState } from '../helpers/game-state';

describe('computer AI', () => {
    it('针对玩家阵容选择六名有效且职责完整的英雄（四人首发加两人替补）', () => {
        const team = chooseComputerTeam(['moran', 'huifeng', 'mirror', 'nightowl']);
        const ratings = team.map(id => getHeroAbilityRatings(getHeroInfo(id).name)!);

        expect(team).toHaveLength(6);
        expect(new Set(team).size).toBe(6);
        expect(team.every(id => AVAILABLE_HERO_IDS.includes(id))).toBe(true);
        expect(Math.max(...ratings.map(item => item.输出))).toBeGreaterThanOrEqual(8);
        expect(Math.max(...ratings.map(item => item.生存))).toBeGreaterThanOrEqual(8);
        expect(Math.max(...ratings.map(item => item.支援))).toBeGreaterThanOrEqual(8);
    });

    it('多次选将应产生多样的阵容而不是固定一套', () => {
        const seenCores = new Set<string>();
        for (let round = 0; round < 60; round++) {
            const team = chooseComputerTeam(['moran', 'huifeng', 'mirror', 'nightowl']);
            // 前四人即首发核心
            seenCores.add([...team.slice(0, 4)].sort().join(','));
            resetCachedComputerTeam();
        }
        expect(seenCores.size).toBeGreaterThanOrEqual(3);
    });

    it('把电脑四名英雄部署到右半区的四个不同位置', () => {
        const state = makeGameState();
        addHero(state, 'moran', 'player1', [2, 0]);
        addHero(state, 'huifeng', 'player1', [3, 1]);
        const team = ['changli', 'liuli', 'baize', 'nightowl'];
        const deployment = chooseComputerDeployment(team, state.player1Heroes);

        expect(deployment).toHaveLength(4);
        expect(new Set(deployment.map(item => item.position.join(','))).size).toBe(4);
        expect(deployment.every(item => item.position[1] >= 3 && item.position[1] < 6)).toBe(true);
        expect(new Set(deployment.map(item => item.heroId))).toEqual(new Set(team));
    });

    it('发现并选择可以直接击杀低生命敌人的技能目标', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'moran', 'player2', [2, 3]);
        const target = addHero(state, 'baize', 'player1', [2, 2]);
        target.currentHp = 4;

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.targetPositions).toContainEqual([2, 2]);
        expect(plan?.score).toBeGreaterThan(50);
    });

    it('带厚盾的低血量目标不会被当作可斩杀目标（有效血量计算护盾）', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'moran', 'player2', [2, 3]);
        // 残血但带厚盾：1 血 + 30 盾，墨阑技能2 基础 15 伤（暴击约 22）也无法击穿
        const shielded = addHero(state, 'baize', 'player1', [2, 2]);
        shielded.currentHp = 1;
        shielded.shield = 30;
        // 无盾残血：3 血，墨阑 8 伤必杀。刻意不用长离——她的被动能挡下这发致命伤，
        // AI 判断"打了也没死"是正确结论，会让本用例的前提失效
        const killable = addHero(state, 'huifeng', 'player1', [2, 4]);
        killable.currentHp = 3;

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.targetPositions[0]).toEqual([2, 4]);
    });

    it('残血英雄的走位会避开敌方伤害技能的射程', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const hero = addHero(state, 'huifeng', 'player2', [3, 3]);
        hero.currentHp = 6;
        // 莫问技能1/2 都是一格范围（3x3，含对角），12 伤可以秒杀 6 血回锋
        addHero(state, 'mowen', 'player1', [2, 2]);

        const inRange = scoreComputerPosition(state, hero, [3, 3]);
        const outOfRange = scoreComputerPosition(state, hero, [5, 3]);

        expect(outOfRange).toBeGreaterThan(inRange);
    });

    it('冷却中的技能不会被选入技能计划', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'mowen', 'player2', [2, 3]);
        addHero(state, 'baize', 'player1', [2, 2]);
        caster.counters['mowen_skill1_cd'] = 2;

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.skillId).not.toBe('mowen_skill1');
    });

    it('技能射程外时 AI 会放置冰晶封锁敌方走位', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'hanjiangxue', 'player2', [2, 5]);
        addHero(state, 'baize', 'player1', [2, 1]);

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.skillId).toBe('hanjiangxue_skill2');
    });

    it('没有攻击距离时会向敌人推进而不是原地结束', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'moran', 'player2', [2, 5]);
        addHero(state, 'baize', 'player1', [2, 0]);

        const move = chooseComputerMove(state, caster);

        expect(move).not.toBeNull();
        expect(move?.[1]).toBeLessThan(5);
    });
});

describe('走位按技能真实形状评估', () => {
    it('范围技优先站"形状真罩得住两个"的格子，而不是"曼哈顿距离凑近但打不到"的格子', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const yunying = addHero(state, 'yunying', 'player2', [5, 5]);
        // 云缨技能一是自身为中心的 3x3：[2,4] 两个都罩得住；
        // [1,5] 只罩得住 [3,5]，[1,3] 虽在曼哈顿距离 2 内、却落在 3x3 之外——旧口径会把它算成打得到
        const first = addHero(state, 'moran', 'player1', [1, 3]);
        const second = addHero(state, 'huifeng', 'player1', [3, 5]);
        // 两格受到的威胁近似，让敌方先行动把恐惧因素压到最低，只比覆盖面
        first.hasActedThisTurn = true;
        second.hasActedThisTurn = true;

        expect(scoreComputerPosition(state, yunying, [2, 4]))
            .toBeGreaterThan(scoreComputerPosition(state, yunying, [1, 5]));
    });

    it('长射程英雄站在射程端点交击，不贴脸（敌方已行动过，排除恐惧因素的干扰）', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const lilith = addHero(state, 'lilith', 'player2', [3, 3]);
        const enemy = addHero(state, 'moran', 'player1', [3, 0]);
        enemy.hasActedThisTurn = true;

        // 恐惧之箭射程 3：贴着敌人站（[3,1]）白白挨打，[3,3] 才是射程端点
        expect(scoreComputerPosition(state, lilith, [3, 3]))
            .toBeGreaterThan(scoreComputerPosition(state, lilith, [3, 1]));
    });

    it('全场技不会因为"形状铺满棋盘"就把理想交击距离读成十格而拒绝前进', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const changli = addHero(state, 'changli', 'player2', [5, 5]);
        addHero(state, 'moran', 'player1', [2, 0]);

        // 暗夜燎原覆盖全场，但接敌梯度仍应把她推向战场（[2,5] 比 [5,5] 更接近）
        expect(scoreComputerPosition(state, changli, [2, 5]))
            .toBeGreaterThan(scoreComputerPosition(state, changli, [5, 5]));
    });
});

describe('两段式新角色的 AI 适配', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('花弄影选方向：优先"本体命中+影子重演也咬人"的朝向', () => {
        const state = makeGameState();
        const hny = addHero(state, 'huanongying', 'player2', [3, 3]);
        addHero(state, 'nightowl', 'player1', [2, 3]);  // 上方扇形正面
        addHero(state, 'baize', 'player1', [1, 3]);     // 只有影子的重演扇形才够到
        addHero(state, 'moran', 'player1', [3, 2]);     // 左方扇形也正面咬一个，但影子落空区

        const plan = chooseComputerSkillPlan(state, hny, 'huanongying_skill1');
        expect(plan).not.toBeNull();
        // 两个方向即时伤害相同，靠"重演+影子进场板"拉开差距：必须选上
        expect(plan!.targetPositions[0]).toEqual([2, 3]);
    });

    it('花弄影弄影：无影时不出方案；影子就位时方案直指影格', () => {
        const state = makeGameState();
        const hny = addHero(state, 'huanongying', 'player2', [3, 3]);
        expect(chooseComputerSkillPlan(state, hny, 'huanongying_skill2')).toBeNull();

        hny.counters['__hny_dir'] = 0;
        huanongyingSkill1.execute!(hny, [], state);     // 空放摆影到 [2,3]
        addHero(state, 'nightowl', 'player1', [1, 3]);  // 换进去贴脸可斩

        const plan = chooseComputerSkillPlan(state, hny, 'huanongying_skill2');
        expect(plan).not.toBeNull();
        expect(plan!.targetPositions[0]).toEqual([2, 3]);
        expect(plan!.score).toBeGreaterThan(0);
    });

    it('惊鸿蓄力按投资判定：外环够得着才值得站定，空场蓄力不给出正分', () => {
        const far = makeGameState();
        const idle = addHero(far, 'jinghong', 'player2', [2, 2]);
        idle.counters['惊鸿'] = 2;
        addHero(far, 'nightowl', 'player1', [5, 5]);
        const idlePlan = chooseComputerSkillPlan(far, idle, 'jinghong_skill2');
        expect(idlePlan === null || idlePlan.score <= 0).toBe(true);

        const near = makeGameState();
        const eager = addHero(near, 'jinghong', 'player2', [2, 2]);
        eager.counters['惊鸿'] = 2;
        addHero(near, 'nightowl', 'player1', [3, 3]);
        const eagerPlan = chooseComputerSkillPlan(near, eager, 'jinghong_skill2');
        expect(eagerPlan).not.toBeNull();
        expect(eagerPlan!.score).toBeGreaterThan(0);
    });

    it('镜花退坐月座时，AI 队友把踏座接人当成移动首选', () => {
        const state = makeGameState();
        const jinghua = addHero(state, 'jinghua', 'player2', [0, 0]);
        state.board[0][0] = null;
        jinghua.position = null;
        jinghua.state = HeroState.TEMP_DEAD;
        jinghua.currentHp = 0;
        jinghua.counters['__jinghua_offboard'] = 1;
        jinghua.counters['__jinghua_return_hp'] = 30;
        state.boardEffects = [{
            id: 'seat-ai-test',
            type: 'moon-seat',
            position: [0, 0],
            owner: 'player2',
            sourceHeroId: jinghua.id,
            duration: 3,
        }];
        const ally = addHero(state, 'baize', 'player2', [3, 3]);

        // 月座在正常寻路够不到的角落，只有交换落点候选能把 AI 引过去
        expect(chooseComputerMove(state, ally)).toEqual([0, 0]);
    });
});
