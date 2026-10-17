import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../../src/data/heroes';
import { getHeroAbilityRatings } from '../../src/data/hero-ratings';
import { huanongyingSkill1 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import {
    chooseComputerDeployment,
    chooseComputerHero,
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

describe('站位规避敌方群攻（扎堆罚）', () => {
    /**
     * 候选格固定 [2,1]、敌方群攻手固定 [3,3]，只改"自己人挤不挤在这一格旁边"，
     * 其余条件（离敌距离、覆盖面、威胁）两态完全一致，测出来的差就是扎堆的代价。
     */
    function crowdDelta(moverId: string, aoeEnemyId: string) {
        const build = (allies: [number, number][]) => {
            const state = makeGameState({ currentPlayer: 'player2' });
            const mover = addHero(state, moverId, 'player2', [0, 0]);
            const templates = ['huifeng', 'guying', 'nightowl'];
            allies.forEach((cell, index) => addHero(state, templates[index], 'player2', cell));
            addHero(state, aoeEnemyId, 'player1', [3, 3]);
            return scoreComputerPosition(state, mover, [2, 1]);
        };
        // 挤：三名队友全在候选格一格里；散：只留一名在近处
        return build([[1, 1], [1, 2], [2, 2]]) - build([[1, 1], [5, 0], [5, 5]]);
    }

    it('同一格，队友挤在身边明显比散开更差（对面有 3×3 群攻手）', () => {
        expect(crowdDelta('moran', 'yunying')).toBeLessThan(-1);
    });

    it('对面不会群攻时不罚扎堆——不能把正常的紧凑阵型一并抹平', () => {
        // 莉莉丝只有单体恐惧之箭：扎堆与散开同分
        expect(crowdDelta('moran', 'lilith')).toBe(0);
    });

    it('支援型照样吃扎堆罚：有群攻手在场时，他贴人堆的意愿要比没有时更低', () => {
        // 奶妈贴队友本身是正当收益（照应分），所以不能要求他一定选散开；
        // 但这一档收益必须在对面有范围技时被扣掉一截，否则他会把全队吸成一坨。
        const withAoe = crowdDelta('baize', 'yunying');
        const withoutAoe = crowdDelta('baize', 'lilith');
        expect(withAoe).toBeLessThan(withoutAoe);
        // 照应分带边际递减：三个队友挤在一格旁的收益，不该是单人的三倍
        expect(withoutAoe).toBeLessThan(15);
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

/**
 * 代价型技能（亡灵体系）的 AI 适配。
 *
 * 病灶：heroBoardValue 把"暂时阵亡"记成 16 分而存活单位约 180 分，
 * 于是缚魂灯两个技能在单步模拟里稳定 -125 / -262，被出手闸门（score > 0）永远拦死，
 * 100 局里一次都没放出暗夜法阵——AI 把它当纯步兵用。
 * 口径：暂死的代价是"缺席一回合"，不是"少一个人"，但也不能无脑送人下场。
 */
describe('亡灵体系代价型技能的 AI 适配', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('缚魂灯孤身一人时不展开法阵：没人兑现共鸣、也没人把她唤回', () => {
        const state = makeGameState();
        const lamp = addHero(state, 'soul_lamp', 'player2', [2, 2]);
        addHero(state, 'nightowl', 'player1', [4, 4]);

        const plan = chooseComputerSkillPlan(state, lamp, 'soul_lamp_skill1');
        expect(plan === null || plan.score <= 0).toBe(true);
    });

    it('队里有共鸣手与唤回手段时，暗夜法阵转为正解', () => {
        const state = makeGameState();
        const lamp = addHero(state, 'soul_lamp', 'player2', [2, 2]);
        addHero(state, 'skeletonking', 'player2', [2, 1]);
        addHero(state, 'jetzmi', 'player2', [1, 2]);
        addHero(state, 'nightowl', 'player1', [3, 3]);

        const plan = chooseComputerSkillPlan(state, lamp, 'soul_lamp_skill1');
        expect(plan).not.toBeNull();
        expect(plan!.score).toBeGreaterThan(0);
    });

    it('法阵里站着的队友越多，同一张阵越值钱', () => {
        const spread = (withAlly: boolean) => {
            const state = makeGameState();
            const lamp = addHero(state, 'soul_lamp', 'player2', [2, 2]);
            addHero(state, 'skeletonking', 'player2', [2, 1]);
            if (withAlly) addHero(state, 'jetzmi', 'player2', [1, 2]);
            addHero(state, 'nightowl', 'player1', [5, 5]);
            return chooseComputerSkillPlan(state, lamp, 'soul_lamp_skill1')?.score ?? 0;
        };
        expect(spread(true)).toBeGreaterThan(spread(false));
    });

    it('缚魂轮转不该拿满血队友换命：无排程、无满血收益时为负', () => {
        const state = makeGameState();
        const lamp = addHero(state, 'soul_lamp', 'player2', [2, 2]);
        const healthy = addHero(state, 'skeletonking', 'player2', [2, 1]);
        addHero(state, 'nightowl', 'player1', [4, 4]);
        expect(healthy.currentHp).toBe(healthy.maxHp);

        const plan = chooseComputerSkillPlan(state, lamp, 'soul_lamp_skill2');
        expect(plan === null || plan.score <= 0).toBe(true);
    });

    it('姿态型技能随战局走：越会被围攻，"开姿态"那一手相对越值', () => {
        // 墨阑 S1(10伤+为道：减伤30%、挨满两次再动一次) vs S2(15伤)——只看当回合数字的话永远选 S2
        const scoresOf = (heroId: string, at: [number, number], foeAt: [number, number][]) => {
            const state = makeGameState();
            const hero = addHero(state, heroId, 'player2', at);
            foeAt.forEach(([row, col], index) =>
                addHero(state, index === 0 ? 'nightowl' : 'feixue', 'player1', [row, col]));
            return {
                first: chooseComputerSkillPlan(state, hero, `${heroId}_skill1`)?.score ?? 0,
                second: chooseComputerSkillPlan(state, hero, `${heroId}_skill2`)?.score ?? 0,
            };
        };

        const duel = scoresOf('moran', [2, 2], [[2, 3]]);
        const surrounded = scoresOf('moran', [2, 2], [[2, 3], [3, 2]]);
        // 多一个能构到她的敌人，姿态那手相对高伤那手的优势必须拉开
        expect(surrounded.first - surrounded.second).toBeGreaterThan(duel.first - duel.second);

        // 震霄金银错：有人贴进束缚圈且确实会挨打时，开姿态的分要高于空场
        const alone = scoresOf('zhenxiao', [2, 2], [[2, 3]]);
        const crowded = scoresOf('zhenxiao', [2, 2], [[2, 3], [3, 2]]);
        expect(crowded.second).toBeGreaterThan(alone.second);
    });

    it('布场型技能按场里能咬到几个人定价：风铃沙丘在有人贴身时必须有正分', () => {
        const duneScore = (foeCells: [number, number][]) => {
            const state = makeGameState();
            const hunter = addHero(state, 'fengling', 'player2', [2, 2]);
            addHero(state, 'baize', 'player2', [0, 0]);
            foeCells.forEach((pos, index) =>
                addHero(state, index === 0 ? 'yunying' : 'guying', 'player1', pos));
            return chooseComputerSkillPlan(state, hunter, 'fengling_skill2')?.score ?? 0;
        };
        // 沙丘是"她自己在场里才吃得到增幅"的布场：场上有人可打时它必须是正分，
        // 否则会被 score>0 的出手闸门永远压死（60 局体检里它采纳 1.30 次/局、施法 0.00）。
        expect(duneScore([[2, 3], [3, 2], [1, 2]])).toBeGreaterThan(0);
        expect(duneScore([[2, 3], [3, 2], [1, 2]]))
            .toBeGreaterThan(duneScore([[2, 3]]));
    });

    it('绯雪连枝要先手：铺路那手排在还没动手的队友之前，否则增益压一回合', () => {
        const state = makeGameState();
        const feixue = addHero(state, 'feixue', 'player2', [2, 1]);
        addHero(state, 'yunying', 'player2', [2, 2]);
        addHero(state, 'moran', 'player1', [2, 3]);

        // 这块板上绯雪的方案分其实略低于队友（43 vs 44，实测），
        // 只有把"队友本回合还没动手、能吃到这条连枝"算进排序，电脑才会先动她。
        // 队友能收人头时不受影响：斩杀的 KILL_SCORE_BONUS(205) 远大于先手加权上限(54)。
        expect(chooseComputerHero(state, 'player2')?.id).toBe(feixue.id);
    });

    it('印月替身要能被电脑规划出来：模拟里也得替它选好登场候补', () => {
        const planFor = (stacks: number, hpRatio: number, bench: string[]) => {
            const state = makeGameState();
            const jinghua = addHero(state, 'jinghua', 'player1', [2, 2]);
            addHero(state, 'baize', 'player1', [2, 1]);
            addHero(state, 'nightowl', 'player2', [5, 5]);
            state.player1BenchHeroIds = bench;
            jinghua.counters['镜影'] = stacks;
            jinghua.currentHp = Math.round(jinghua.maxHp * hpRatio);
            return chooseComputerSkillPlan(state, jinghua, 'jinghua_skill2');
        };

        // 旧实现：AI 的模拟里没有"技能栏选候补"这一步，execute 当场以
        // "请先在技能栏选择一名候补友方"失败 → 这个技能连分数都拿不到，电脑从不用它
        expect(planFor(3, 1, ['liuli', 'moran'])).not.toBeNull();
        expect(planFor(0, 0.4, ['liuli'])).not.toBeNull();   // 残血：该把人换进来
        expect(planFor(0, 1, ['liuli'])).toBeNull();         // 满血又没镜影：不该退场
        expect(planFor(3, 1, [])).toBeNull();               // 候补席没人：换无可换
    });

    it('游隼疾掠只在真能穿到人时才算方案：空线与1格短冲一律不生成', () => {
        // 直线上没有敌人：冲刺距离再远也不给方案（旧实现按距离发分，AI 专门挑空线空冲）
        const empty = makeGameState();
        const lone = addHero(empty, 'youjun', 'player2', [2, 0]);
        addHero(empty, 'moran', 'player1', [5, 5]);      // 不在她任何一条直线上
        const emptyPlan = chooseComputerSkillPlan(empty, lone, 'youjun_skill1');
        expect(emptyPlan === null || emptyPlan.score <= 0).toBe(true);

        // 直线上站着敌人：必须给出穿过她的落点（落点在敌人身后的空格）
        const lined = makeGameState();
        const falcon = addHero(lined, 'youjun', 'player2', [2, 0]);
        addHero(lined, 'moran', 'player1', [2, 2]);
        const linedPlan = chooseComputerSkillPlan(lined, falcon, 'youjun_skill1');
        expect(linedPlan).not.toBeNull();
        expect(linedPlan!.score).toBeGreaterThan(0);
        // 方案落点与她之间必须真的隔着那个敌人
        expect(linedPlan!.targetPositions[0]).toEqual([2, 3]);
    });
});
