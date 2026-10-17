import { describe, expect, it } from 'vitest';
import { chooseComputerMove, chooseComputerSkillPlan, chooseJinghuaSwapTarget, planJointMoveForHero, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { setStance } from '../../src/core/mountain-stance';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 支援型技能的 AI 取舍：这类技能当回合不产生任何伤害数字，单步盘面读不到收益，
 * 早先被 score>0 的出手闸门长期压死（玄霄 S1:S2 = 4.0:0.2、琉璃全场不放援护，
 * 于是禅定永远为 0、技能二永远"没有禅定可消耗"）。
 */
function battleSetup() {
    setComputerAiDifficulty('master');
    const state = makeGameState();
    state.currentPlayer = 'player1';
    state.phase = 'battle';
    return state;
}

describe('支援型技能的 AI 取舍', () => {
    it('玄霄：友方本回合已行动且贴身时，用技能二给一次再动，而不是空过', () => {
        const state = battleSetup();
        const xuanxiao = addHero(state, 'xuanxiao', 'player1', [3, 2]);
        const carry = addHero(state, 'yunying', 'player1', [3, 1]);
        carry.hasActedThisTurn = true;
        // 敌人放到够不着的角落：排除"直接打伤害"这种更诱人的选项
        addHero(state, 'nightowl', 'player2', [0, 0]);

        const plan = chooseComputerSkillPlan(state, xuanxiao);
        expect(plan?.skillId).toBe('xuanxiao_skill2');
        expect((plan?.score ?? 0)).toBeGreaterThan(0);
    });

    it('玄霄：没有可再动的友方时不放技能二（不许空转结束行动）', () => {
        const state = battleSetup();
        const xuanxiao = addHero(state, 'xuanxiao', 'player1', [3, 2]);
        addHero(state, 'nightowl', 'player2', [0, 0]);

        const plan = chooseComputerSkillPlan(state, xuanxiao);
        expect(plan?.skillId).not.toBe('xuanxiao_skill2');
    });

    it('琉璃：友方贴身且确实会被打到时，先挂援护攒禅定', () => {
        const state = battleSetup();
        const liuli = addHero(state, 'liuli', 'player1', [3, 3]);
        addHero(state, 'yunying', 'player1', [3, 2]);
        // 对手就压在友方旁边，下一拍大概率要打她：这份承伤正是援护的价值
        addHero(state, 'zuizhendao', 'player2', [2, 2]);

        const plan = chooseComputerSkillPlan(state, liuli);
        expect(plan?.skillId).toBe('liuli_skill1');
        expect((plan?.score ?? 0)).toBeGreaterThan(0);
    });

    it('琉璃：身上有禅定且血亏时，技能二的回血要能被选中', () => {
        const state = battleSetup();
        const liuli = addHero(state, 'liuli', 'player1', [3, 3]);
        addHero(state, 'yunying', 'player1', [2, 3]);
        addHero(state, 'nightowl', 'player2', [0, 0]);
        liuli.counters['禅定'] = 3;
        liuli.currentHp = Math.floor(liuli.maxHp * 0.4);

        const plan = chooseComputerSkillPlan(state, liuli);
        expect(plan?.skillId).toBe('liuli_skill2');
    });

    it('玄霄：给还能出手的高输出队友上增益，这一手要值一次行动的分', () => {
        const state = battleSetup();
        const xuanxiao = addHero(state, 'xuanxiao', 'player1', [3, 2]);
        addHero(state, 'changli', 'player1', [3, 1]);
        addHero(state, 'nightowl', 'player2', [0, 0]);   // 远在角落：排除"直接打伤害"的干扰

        const plan = chooseComputerSkillPlan(state, xuanxiao, 'xuanxiao_skill1');
        // 旧口径只有一行 +7 的 buff 计数，实测整局 0.12 次/局；现在按受助者输出折算
        expect((plan?.score ?? 0)).toBeGreaterThan(20);
    });
});

describe('两步方向技与换身技的 AI 判据', () => {
    it('泠汐：方向格上没人、敌人只在两格外的 2×3 里时，技能二仍要能规划出来', () => {
        const state = battleSetup();
        const lingxi = addHero(state, 'lingxi', 'player1', [3, 1]);
        addHero(state, 'nightowl', 'player2', [3, 3]);

        // 旧版 canUseSkill 只看得见脚下四个方向格，这一手连候选都进不去（实测 0.79 次/局）
        const plan = chooseComputerSkillPlan(state, lingxi, 'lingxi_skill2');
        expect(plan?.skillId).toBe('lingxi_skill2');
        expect((plan?.score ?? 0)).toBeGreaterThan(0);
    });

    it('镜花：自己被围住时不产出"水月换身"方案（旧版选完就 endHeroAction，白送一次行动）', () => {
        const state = battleSetup();
        const jinghua = addHero(state, 'jinghua', 'player1', [2, 2]);
        addHero(state, 'yunying', 'player1', [0, 0]);
        addHero(state, 'nightowl', 'player2', [2, 1]);

        expect(chooseJinghuaSwapTarget(state, jinghua)).toBeNull();
        expect(chooseComputerSkillPlan(state, jinghua, 'jinghua_skill1')).toBeNull();
    });

    it('镜花：自己安全、队友被两名敌人贴身时，换身指向那名队友', () => {
        const state = battleSetup();
        const jinghua = addHero(state, 'jinghua', 'player1', [0, 0]);
        addHero(state, 'yunying', 'player1', [3, 3]);
        addHero(state, 'nightowl', 'player2', [3, 2]);
        addHero(state, 'zuizhendao', 'player2', [4, 3]);

        expect(chooseJinghuaSwapTarget(state, jinghua)).toEqual([3, 3]);
        const plan = chooseComputerSkillPlan(state, jinghua, 'jinghua_skill1');
        expect(plan?.targetPositions[0]).toEqual([3, 3]);
    });

    it('镜花：没有队友深陷敌阵时不换（贴着一名敌人不值得动一次行动）', () => {
        const state = battleSetup();
        const jinghua = addHero(state, 'jinghua', 'player1', [0, 0]);
        addHero(state, 'yunying', 'player1', [3, 3]);
        addHero(state, 'nightowl', 'player2', [3, 2]);   // 只有一名敌人贴着队友

        expect(chooseJinghuaSwapTarget(state, jinghua)).toBeNull();
    });
});

describe('岱宗：摆开镇守就钉在原地', () => {
    it('姿态在线时不再规划移动，也不参与联合换位（移动会散姿态、断岳势记账）', () => {
        const state = battleSetup();
        const daizong = addHero(state, 'daizong', 'player1', [2, 0]);
        addHero(state, 'yunying', 'player1', [2, 2]);
        addHero(state, 'yunying', 'player2', [2, 4]);
        // 先确认"没摆姿态时他确实想挪"，否则这条断言等于什么都没测
        expect(chooseComputerMove(state, daizong)).not.toBeNull();

        setStance(daizong, 1);                       // 面朝右：护住第 1~3 列
        expect(chooseComputerMove(state, daizong)).toBeNull();
        expect(planJointMoveForHero(state, daizong)).toBeNull();
    });

    it('池子够肥却没人可砸时放行这一步：移动和岳倾都会散姿态，不亏', () => {
        const state = battleSetup();
        const daizong = addHero(state, 'daizong', 'player1', [2, 0]);
        addHero(state, 'yunying', 'player2', [2, 4]);   // 隔着四列，3×3 砸不到
        setStance(daizong, 1);

        daizong.counters['岳势'] = 4;                    // 池子还薄：继续钉着攒
        expect(chooseComputerMove(state, daizong)).toBeNull();
        daizong.counters['岳势'] = 30;                   // 肥到该出货了
        expect(chooseComputerMove(state, daizong)).not.toBeNull();
    });
});
