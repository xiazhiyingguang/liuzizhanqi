import { useGameStore } from '../store/game-store';
import { HeroState, Position } from '../types/game';
import { createHero } from '../data/heroes';
import { EffectManager } from '../core/effect-manager';
import { resolveSkillFx, computeFxAngleDeg, computeFxDirection, computeSkillAreaBounds } from '../core/skill-fx';
import { computeFxCoveredPositions } from '../core/skill-fx-coverage';
import { getSkill } from '../data/skills';

interface E2EHeroSnapshot {
    id: string;
    name: string;
    owner: 'player1' | 'player2';
    position: [number, number] | null;
    state: HeroState;
    currentHp: number;
}

interface E2EGameSnapshot {
    phase: ReturnType<typeof useGameStore.getState>['phase'];
    currentPlayer: ReturnType<typeof useGameStore.getState>['currentPlayer'];
    selectingPlayer: ReturnType<typeof useGameStore.getState>['selectingPlayer'];
    roundNumber: number;
    localPlayerNumber?: number;
    onlineRoomId?: string;
    player1SelectedHeroIds: string[];
    player2SelectedHeroIds: string[];
    player1ReadyHeroSelect: boolean;
    player2ReadyHeroSelect: boolean;
    player1ReadyDeploy: boolean;
    player2ReadyDeploy: boolean;
    heroes: E2EHeroSnapshot[];
}

declare global {
    interface Window {
        __SIX_CHESS_E2E__?: {
            snapshot: () => E2EGameSnapshot;
            prepareFinalStrike: () => boolean;
            /** 特效演示桥（视觉验收/特效开发用）：构建最小战斗舞台并触发指定特效 */
            fxDemo: (scenario: 'stage' | 'chain' | 'splash' | 'aoe' | 'death' | 'status' | 'tick' | 'areagrid' | 'areafire' | 'areastorm' | 'areashock' | 'fxstaff' | 'fxsword' | 'fxice' | 'fxred' | 'fxblade' | 'fxpearl' | 'fxwave' | 'fxfan' | 'fxclaw' | 'fxpounce' | 'fxdash' | 'fxwheel' | 'fxjinghua' | 'daistasis') => boolean;
        };
    }
}

function snapshot(): E2EGameSnapshot {
    const state = useGameStore.getState();
    return {
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        selectingPlayer: state.selectingPlayer,
        roundNumber: state.roundNumber,
        localPlayerNumber: state.localPlayerNumber,
        onlineRoomId: state.onlineRoomId,
        player1SelectedHeroIds: [...state.player1SelectedHeroIds],
        player2SelectedHeroIds: [...state.player2SelectedHeroIds],
        player1ReadyHeroSelect: state.player1ReadyHeroSelect,
        player2ReadyHeroSelect: state.player2ReadyHeroSelect,
        player1ReadyDeploy: state.player1ReadyDeploy,
        player2ReadyDeploy: state.player2ReadyDeploy,
        heroes: [...state.player1Heroes, ...state.player2Heroes].map(hero => ({
            id: hero.id,
            name: hero.name,
            owner: hero.owner,
            position: hero.position ? [...hero.position] as [number, number] : null,
            state: hero.state,
            currentHp: hero.currentHp,
        })),
    };
}

/**
 * 只在 VITE_E2E=true 的构建中暴露，用于把完整 UI 流程压缩到最后一击。
 * 点将、布阵、技能选择与结算仍由真实界面完成。
 */
function prepareFinalStrike(): boolean {
    const state = useGameStore.getState();
    if (state.phase !== 'battle') return false;

    const attacker = state.player1Heroes.find(hero => hero.name === '墨阑' && hero.position);
    const target = state.player2Heroes.find(hero => hero.position);
    if (!attacker?.position || !target?.position) return false;

    const [attackerRow, attackerCol] = attacker.position;
    const [targetRow, targetCol] = target.position;
    if (Math.abs(attackerRow - targetRow) + Math.abs(attackerCol - targetCol) !== 1) return false;

    const board = state.board.map(row => [...row]);
    state.player2Heroes.forEach(hero => {
        if (hero === target) return;
        hero.currentHp = 0;
        hero.state = HeroState.DEAD;
        if (hero.position && board[hero.position[0]][hero.position[1]] === hero) {
            board[hero.position[0]][hero.position[1]] = null;
        }
    });

    target.currentHp = 1;
    target.state = HeroState.ALIVE;
    attacker.hasActedThisTurn = false;
    attacker.hasMovedThisTurn = false;

    useGameStore.setState({
        board,
        player1Heroes: [...state.player1Heroes],
        player2Heroes: [...state.player2Heroes],
        // 替补席留人会让最后一击先触发补员而非结算，用例将卡在"正在补员"
        player1BenchHeroIds: [],
        player2BenchHeroIds: [],
        currentPlayer: 'player1',
        selectedHero: null,
        activeHero: null,
        selectedSkill: null,
        highlightedPositions: [],
        moveRange: [],
        skillRange: [],
    });
    return true;
}

/**
 * 特效演示舞台：一局固定阵容的最小战斗。
 * 玩家1：震霄[2,1] 长离[1,2] 夜枭[4,1]；玩家2：墨阑[2,3] 回锋[2,4] 琉璃[3,4] 白泽[1,4]
 */
function ensureFxDemoStage(): boolean {
    const state = useGameStore.getState();
    if (state.phase === 'battle' && state.player1Heroes.length >= 3 && state.player2Heroes.length >= 4) {
        return true;
    }

    const board = state.board.map(row => [...row]);
    const p1: Array<[string, Position]> = [
        ['zhenxiao', [2, 1]],
        ['changli', [1, 2]],
        ['nightowl', [4, 1]],
    ];
    const p2: Array<[string, Position]> = [
        ['moran', [2, 3]],
        ['huifeng', [2, 4]],
        ['liuli', [3, 4]],
        ['baize', [1, 4]],
    ];
    const player1Heroes = p1.map(([heroId, pos]) => createHero(heroId, 'player1', pos));
    const player2Heroes = p2.map(([heroId, pos]) => createHero(heroId, 'player2', pos));
    for (const hero of [...player1Heroes, ...player2Heroes]) {
        if (hero.position) board[hero.position[0]][hero.position[1]] = hero;
    }

    useGameStore.setState({
        board,
        player1Heroes,
        player2Heroes,
        phase: 'battle',
        currentPlayer: 'player1',
        roundNumber: 2,
        actionsThisTurn: 0,
        selectedHero: null,
        activeHero: null,
        selectedSkill: null,
        highlightedPositions: [],
        moveRange: [],
        skillRange: [],
    });
    return true;
}

/** 按"施法者模板ID + 技能序号"推送一次技能特效事件（含可选多格扩展） */
function pushDemoSkillFx(
    heroTemplateId: string,
    skillId: string,
    from: Position,
    to: Position,
    extras?: {
        splashPositions?: Position[];
        chainLinks?: Position[];
        impactPositions?: Position[];
        softImpactPositions?: Position[];
        coveredPositions?: Position[];
    }
): void {
    const state = useGameStore.getState();
    const caster = [...state.player1Heroes, ...state.player2Heroes].find(
        hero => hero.id.startsWith(`${heroTemplateId}-`)
    );
    const owner = caster?.owner ?? 'player1';
    const angleDeg = computeFxAngleDeg(from, to);
    const profile = resolveSkillFx(skillId);
    const skill = getSkill(skillId);
    // 区域格与整体特效包围盒都走与线上同一条推导，验收时看到的就是实际表现
    const coveredPositions = computeFxCoveredPositions(skill, from, to, profile);
    state.pushSkillFx({
        profile,
        owner,
        fromPos: from,
        targetPos: to,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        coveredPositions,
        // 与线上派发同规则：档案声明 fxArea:'none' 的技能不铺整盘区域特效
        areaBounds: skill && profile.fxArea !== 'none'
            ? computeSkillAreaBounds(skill, coveredPositions) ?? undefined
            : undefined,
        ...extras,
    });
}

function runFxDemo(
    scenario:
        | 'stage' | 'chain' | 'splash' | 'aoe' | 'death' | 'status' | 'tick'
        | 'areagrid' | 'areafire' | 'areastorm' | 'areashock'
        | 'fxstaff' | 'fxsword' | 'fxice' | 'fxred' | 'fxblade'
        | 'fxpearl' | 'fxwave' | 'fxfan' | 'fxclaw' | 'fxpounce'
        | 'fxdash' | 'fxwheel' | 'fxjinghua' | 'daistasis'
): boolean {
    if (!ensureFxDemoStage()) return false;
    const state = useGameStore.getState();
    const heroOf = (templateId: string) =>
        [...state.player1Heroes, ...state.player2Heroes].find(
            hero => hero.id.startsWith(`${templateId}-`)
        );

    switch (scenario) {
        case 'chain':
            // 链式闪电：主目标格 storm-bolt + 两条链路段
            pushDemoSkillFx('zhenxiao', 'zhenxiao_skill1', [2, 1], [2, 3], {
                chainLinks: [[2, 4], [3, 4]],
            });
            return true;
        case 'splash':
            // 溅射：目标格 pierce 爆闪 + 两个溅射余波格
            pushDemoSkillFx('changli', 'changli_skill2', [1, 2], [1, 4], {
                splashPositions: [[2, 4], [2, 3]],
            });
            return true;
        case 'aoe': {
            // 攻击型 AOE 逐命中格：区域底光自动按技能几何推导，打到的每格各爆一份
            // 骸骨君王·亡骨斩 = arc-slash，属"每格各出一份本体主效"的原型
            pushDemoSkillFx('nightowl', 'skeletonking_skill1', [4, 1], [4, 2], {
                impactPositions: [[4, 2], [5, 2], [4, 3]],
            });
            // 震霄·金银错 = cage-bind，属"主格出本体、他格出印记"的原型；
            // 其中 [1, 4] 故意标成柔光受益格，同屏验收第三种多格表现
            pushDemoSkillFx('zhenxiao', 'zhenxiao_skill2', [2, 1], [2, 3], {
                impactPositions: [[2, 3], [2, 4], [1, 4]],
                softImpactPositions: [[1, 4]],
            });
            return true;
        }
        case 'areagrid':
            // AOE 整体特效三连：缚域成形 / 领域地波 / 巨刃横扫（各占一角）
            pushDemoSkillFx('zhenxiao', 'zhenxiao_skill2', [2, 1], [1, 3]);
            pushDemoSkillFx('nightowl', 'hanjiangxue_skill1', [4, 0], [4, 1]);
            pushDemoSkillFx('changli', 'huifeng_skill1', [3, 2], [4, 4]);
            return true;
        case 'areafire':
            // 全场火海：暗夜燎原（全场伤害技 → 整盘火海横扫）
            pushDemoSkillFx('changli', 'changli_skill1', [5, 0], [0, 5]);
            return true;
        case 'areastorm':
            // 全场雷暴：天神震怒（三道落雷错落劈下）
            pushDemoSkillFx('zhenxiao', 'hero_x_skill1', [2, 1], [2, 3]);
            return true;
        case 'areashock':
            // 守护法阵 + 区域冲击波
            pushDemoSkillFx('baize', 'skeletonking_skill2', [4, 1], [4, 2]);
            pushDemoSkillFx('nightowl', 'wither_lord_skill2', [1, 4], [1, 4]);
            return true;
        case 'fxstaff':
            // 悟空·金箍棒重做：伸展砸落 + 冲击双环 + 地裂 + 金星
            pushDemoSkillFx('zhenxiao', 'wukong_skill2', [2, 1], [2, 3]);
            return true;
        case 'fxsword':
            // 孤影·寒星剑气：冷焰巨剑光斜劈
            pushDemoSkillFx('changli', 'guying_skill2', [1, 2], [2, 3]);
            return true;
        case 'fxice':
            // 寒江雪·冰刺天降：主格冰锥贯地 + 3×3 区域冰刺雨
            pushDemoSkillFx('nightowl', 'hanjiangxue_skill1', [4, 1], [4, 2]);
            return true;
        case 'fxred':
            // 回锋·三段赤红斜斩（3×3 连刃斩）
            pushDemoSkillFx('nightowl', 'huifeng_skill1', [4, 1], [4, 2]);
            return true;
        case 'fxpearl':
            // 叙白·黑白凝珠：三珠汇入环绕 + 震霄身上挂 2 颗常驻黑白球（消耗后颗数减少）
            pushDemoSkillFx('zhenxiao', 'xubai_skill2', [2, 1], [2, 1]);
            {
                const keeper = heroOf('zhenxiao');
                if (keeper) {
                    EffectManager.addCounter(keeper, '黑白球', 2);
                    useGameStore.setState({
                        player1Heroes: [...useGameStore.getState().player1Heroes],
                    });
                }
            }
            return true;
        case 'fxwave':
            // 泠汐·海浪涟漪：潮面漫染 + 四道浪环逐圈荡开 + 浪尖白沫
            pushDemoSkillFx('changli', 'lingxi_skill1', [1, 2], [2, 2]);
            return true;
        case 'fxfan':
            // 泠汐·涌潮折扇：施法者格折扇向右展开 + 命中格浪头拍击
            pushDemoSkillFx('changli', 'lingxi_skill2', [1, 2], [1, 4]);
            return true;
        case 'fxblade':
            // 镜·破镜飞刃：三枚镜刃合击（模拟破镜之刃触发的日志标记路径）
            pushDemoSkillFx('liuli', 'mirror_blade', [2, 1], [1, 4]);
            return true;
        case 'fxclaw':
            // 风铃·爪牙撕裂：起手格残影拖尾 + 命中格三道爪痕扇形撕开
            pushDemoSkillFx('fengling', 'fengling_skill1', [2, 1], [2, 3]);
            return true;
        case 'fxpounce':
            // 风铃天威·掠沙闪袭：残影跨多格冲到远处敌人身边再咬一口
            pushDemoSkillFx('fengling', 'fengling_pounce', [1, 1], [4, 4]);
            return true;
        case 'fxdash':
            // 醉枕刀·醉掷寒锋：真实冲刺序列自报（这里演示一条绕路），
            // 疾影逐格沿路径跟踪点亮，踩到的格补贯斩特写，末格拾刀压轴
            pushDemoSkillFx('zhenxiao', 'zuizhendao_skill1', [2, 1], [2, 4], {
                coveredPositions: [[2, 2], [3, 2], [3, 3], [2, 3], [2, 4]],
                impactPositions: [[2, 2], [3, 3], [2, 3], [2, 4]],
            });
            return true;
        case 'fxwheel':
            // 醉枕刀·醉影换位：起手格涡环换位而出，落位格太刀绕身旋斩一周
            pushDemoSkillFx('zhenxiao', 'zuizhendao_skill2', [4, 1], [1, 2], {
                impactPositions: [[2, 3]],
            });
            return true;
        case 'fxjinghua': {
            // 镜花·水月的两枚棋盘常驻标记：水月（换影跳板）与月座（归场席位）
            if (!ensureFxDemoStage()) return false;
            const stage = useGameStore.getState();
            useGameStore.setState({
                boardEffects: [
                    ...(stage.boardEffects ?? []).filter(effect =>
                        effect.type !== 'water-moon' && effect.type !== 'moon-seat'),
                    {
                        id: 'demo-water-moon',
                        type: 'water-moon',
                        position: [2, 2] as Position,
                        owner: 'player1' as const,
                        sourceHeroId: 'demo-jinghua',
                        duration: 99,
                    },
                    {
                        id: 'demo-moon-seat',
                        type: 'moon-seat',
                        position: [4, 2] as Position,
                        owner: 'player2' as const,
                        sourceHeroId: 'demo-jinghua-2',
                        duration: 99,
                    },
                ],
            });
            return true;
        }
        case 'death':
            // 阵亡水墨消散 + 击杀震屏：由 kill 日志驱动
            state.addLog({
                type: 'kill',
                player: 'player1',
                message: '特效演示：击杀',
                details: { kind: 'fx-demo', victimPosition: [3, 2] },
            });
            return true;
        case 'status': {
            // 四种属性状态光环同屏：灼烧/流血/麻痹/链电标记
            const burn = heroOf('moran');
            const bleed = heroOf('huifeng');
            const paralysis = heroOf('liuli');
            const chain = heroOf('baize');
            if (burn) {
                EffectManager.addEffect(burn, {
                    type: 'debuff', name: '灼烧', duration: 2, value: 2,
                    sourceHeroId: heroOf('changli')?.id ?? 'demo', description: '演示',
                });
            }
            if (bleed) {
                EffectManager.addEffect(bleed, {
                    type: 'debuff', name: '流血', duration: 2, value: 2,
                    sourceHeroId: heroOf('nightowl')?.id ?? 'demo', description: '演示',
                });
            }
            if (paralysis) {
                EffectManager.addEffect(paralysis, {
                    type: 'debuff', name: '麻痹', duration: 1,
                    sourceHeroId: 'demo', description: '演示',
                });
            }
            if (chain) {
                EffectManager.addEffect(chain, {
                    type: 'mark', name: '链式闪电', duration: 3,
                    sourceHeroId: heroOf('zhenxiao')?.id ?? 'demo', description: '演示',
                });
            }
            useGameStore.setState({
                player1Heroes: [...useGameStore.getState().player1Heroes],
                player2Heroes: [...useGameStore.getState().player2Heroes],
            });
            return true;
        }
        case 'tick':
            // 灼烧跳伤/流血掉血的格子爆点 + 来源色飘字（由 damage 日志 fxTag 驱动）
            state.addLog({
                type: 'damage',
                player: 'player1',
                message: '特效演示：灼烧跳伤',
                details: { kind: 'damage', amount: 2, fxTag: 'burn', position: [2, 3] },
            });
            state.addLog({
                type: 'damage',
                player: 'player1',
                message: '特效演示：流血掉血',
                details: { kind: 'damage', amount: 2, fxTag: 'bleed', position: [2, 4] },
            });
            return true;
        case 'daistasis': {
            // 戴尔「时空停滞」残影与两段式唤回的可点态（点残影→点空格）
            if (!ensureFxDemoStage()) return false;
            const stage = useGameStore.getState();
            const board = stage.board.map(row => [...row]);
            const fallen = stage.player1Heroes.find(hero => hero.id.startsWith('changli-'));
            if (!fallen?.position) return false;

            const [deathRow, deathCol] = fallen.position;
            board[deathRow][deathCol] = null;
            fallen.currentHp = 0;
            fallen.state = HeroState.DEAD;
            fallen.counters['__dai_stasis_until'] = stage.roundNumber + 1;
            fallen.counters['__dai_hp_before_lethal'] = 10;

            const existingDai = stage.player1Heroes.find(
                hero => hero.passiveId === 'dai_passive' && hero.state === HeroState.ALIVE
            );
            const dai = existingDai ?? createHero('dai', 'player1', [3, 1]);
            board[3][1] = dai;
            dai.position = [3, 1];

            useGameStore.setState({
                board,
                player1Heroes: existingDai ? [...stage.player1Heroes] : [...stage.player1Heroes, dai],
                currentPlayer: 'player1',
                selectedHero: dai,
                activeHero: dai,
                selectedSkill: getSkill('dai_skill1') ?? null,
                daiReviveHeroId: undefined,
                highlightedPositions: [],
                moveRange: [],
                skillRange: [],
            });
            return true;
        }
        default:
            return false;
    }
}

export function installE2EBridge(): void {
    if (import.meta.env.VITE_E2E !== 'true' || typeof window === 'undefined') return;
    window.__SIX_CHESS_E2E__ = {
        snapshot,
        prepareFinalStrike,
        fxDemo: runFxDemo,
    };
}
