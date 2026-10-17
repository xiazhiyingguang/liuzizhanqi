import { useGameStore } from '../store/game-store';
import { HeroState, Position } from '../types/game';
import { createHero } from '../data/heroes';
import { EffectManager } from '../core/effect-manager';
import { DamageCalculator } from '../core/damage-calculator';
import { GameEngine } from '../core/game-engine';
import { resolveSkillFx, computeFxAngleDeg, computeFxDirection, computeSkillAreaBounds } from '../core/skill-fx';
import { computeFxCoveredPositions } from '../core/skill-fx-coverage';
import { setRenderQualityPreference, type QualityPreference } from '../core/render-quality';
import { getSkill } from '../data/skills';
import { yunxiuSkill1, yunxiuSkill2 } from '../data/extended-skills';
import { buildSkillPreviewScene } from '../core/skill-fx-preview';
import { audioManager } from '../audio/audio-manager';
import { soundManager } from '../core/sound-manager';
import { planSkillSoundCues, type SkillSoundCue } from '../core/skill-sound-cues';
import { applyZhizhiForMode } from '../core/hero-zhizhi';
import { attachDragon, gainScales } from '../core/dragon-orbit';
import { placeCloud, placeRod, tickCloudsAtRoundStart } from '../core/thunder-cloud';

interface E2EHeroSnapshot {
    id: string;
    name: string;
    owner: 'player1' | 'player2';
    position: [number, number] | null;
    state: HeroState;
    currentHp: number;
    weaponId?: string | null;
}

interface E2EGameSnapshot {
    phase: ReturnType<typeof useGameStore.getState>['phase'];
    currentPlayer: ReturnType<typeof useGameStore.getState>['currentPlayer'];
    selectingPlayer: ReturnType<typeof useGameStore.getState>['selectingPlayer'];
    roundNumber: number;
    gameMode?: 'standard' | 'classic';
    localPlayerNumber?: number;
    onlineRoomId?: string;
    player1SelectedHeroIds: string[];
    player2SelectedHeroIds: string[];
    player1ReadyHeroSelect: boolean;
    player2ReadyHeroSelect: boolean;
    player1ReadyWeaponSelect: boolean;
    player2ReadyWeaponSelect: boolean;
    player1ReadyDeploy: boolean;
    player2ReadyDeploy: boolean;
    heroes: E2EHeroSnapshot[];
}

declare global {
    interface Window {
        __SIX_CHESS_E2E__?: {
            prepareSkillAudio: (skillIds: string[]) => Promise<string>;
            setBattleSoundMuted: (muted: boolean) => void;
            skillAudioSnapshot: () => Array<{ id: number; skillId?: string; bornAt: number; cues: SkillSoundCue[] }>;
            hitFeedbackDemo: (kind: string) => Promise<boolean>;
            skillFxDemo: (skillId: string, empowered?: boolean) => boolean;
            mechanismTriggerDemo: (skillId: string) => boolean;
            prepareTimingDemo: (lethal?: boolean) => void;
            castTimingDemo: () => void;
            prepareWangshuDemo: (mode?: 'standard' | 'classic') => void;
            wangshuDemoStep: (action: 'attack' | 'heal' | 'kill' | 'self') => void;
            wangshuDemoSnapshot: () => unknown;
            prepareAoyuanSequenceDemo: (skill: 'summon' | 'dash') => void;
            castAoyuanSequenceDemo: () => unknown;
            prepareYunxiuCloudDemo: (mode?: 'center' | 'edge' | 'empty' | 'dense') => void;
            castYunxiuCloudDemo: () => unknown;
            tickYunxiuCloudDemo: () => unknown;
            /** 直接切画质档位（A/B 帧耗时用）：走玩家同一个开关，不靠点按钮 */
            setQualityMode: (mode: QualityPreference) => string;
            mirrorBladeDemo: (count?: number) => boolean;
            snapshot: () => E2EGameSnapshot;
            prepareFinalStrike: () => boolean;
            /** 特效演示桥（视觉验收/特效开发用）：构建最小战斗舞台并触发指定特效 */
            fxDemo: (scenario: 'stage' | 'chain' | 'splash' | 'aoe' | 'death' | 'death-pseudo' | 'status' | 'tick' | 'areagrid' | 'areafire' | 'areastorm' | 'areashock' | 'fxstaff' | 'fxsword' | 'fxice' | 'fxred' | 'fxblade' | 'fxpearl' | 'fxwave' | 'fxfan' | 'fxclaw' | 'fxpounce' | 'fxdragon' | 'fxdash' | 'fxwheel' | 'fxjinghua' | 'fxmarsh' | 'fxbinding' | 'fxzhiguang' | 'fxbeam' | 'fxyunying' | 'fxyunying2' | 'fxlibai' | 'daistasis' | 'fxheal' | 'fxhealwave' | 'fxregen' | 'fxrevive' | 'fxward' | 'fxreap' | 'fxreckon' | 'fxyoulong'
              | 'fxyunxiu') => boolean;
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
        gameMode: state.gameMode,
        localPlayerNumber: state.localPlayerNumber,
        onlineRoomId: state.onlineRoomId,
        player1SelectedHeroIds: [...state.player1SelectedHeroIds],
        player2SelectedHeroIds: [...state.player2SelectedHeroIds],
        player1ReadyHeroSelect: state.player1ReadyHeroSelect,
        player2ReadyHeroSelect: state.player2ReadyHeroSelect,
        player1ReadyWeaponSelect: state.player1ReadyWeaponSelect ?? false,
        player2ReadyWeaponSelect: state.player2ReadyWeaponSelect ?? false,
        player1ReadyDeploy: state.player1ReadyDeploy,
        player2ReadyDeploy: state.player2ReadyDeploy,
        heroes: [...state.player1Heroes, ...state.player2Heroes].map(hero => ({
            id: hero.id,
            name: hero.name,
            owner: hero.owner,
            position: hero.position ? [...hero.position] as [number, number] : null,
            state: hero.state,
            currentHp: hero.currentHp,
            weaponId: hero.weaponId ?? null,
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
function runMirrorBladeDemo(count = 4): boolean {
    if (!Number.isInteger(count) || count < 1 || count > 24 || !ensureFxDemoStage()) return false;
    const state = useGameStore.getState();
    const mirror = createHero('mirror', 'player1', [2, 1]);
    const first = createHero('moran', 'player2', [2, 3]);
    first.currentHp = 4;
    const second = createHero('baize', 'player2', [1, 3]);
    second.currentHp = second.maxHp = 300;
    const board = state.board.map(row => row.map(() => null as typeof mirror | null));
    const player1Heroes = [mirror, ...state.player1Heroes.filter(hero => hero.position?.join(',') !== '2,1')];
    const player2Heroes = [first, second];
    for (const hero of [...player1Heroes, ...player2Heroes]) {
        if (hero.position) board[hero.position[0]][hero.position[1]] = hero;
    }
    const demo = { ...state, board, player1Heroes, player2Heroes, battleLog: [], skillFx: [] };
    // 分两帧：先让棋盘挂载记录初始日志，再走真实引擎的日志标记路径。
    useGameStore.setState(demo);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        EffectManager.setCounter(mirror, '破镜之刃', count);
        DamageCalculator.triggerMirrorBrokenBlade(mirror, demo);
        useGameStore.setState({ board: board.map(row => [...row]), battleLog: [...demo.battleLog] });
    }));
    return true;
}

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
    // 与线上包装层同规则：调用方自报的真实作用格优先于几何推导，
    // areaBounds 也必须跟着这份格子算，否则演示看到的包围盒和实战不是一回事
    const coveredPositions = extras?.coveredPositions?.length
        ? extras.coveredPositions
        : computeFxCoveredPositions(skill, from, to, profile);
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

async function hitFeedbackDemo(kind: string): Promise<boolean> {
    if (!ensureFxDemoStage()) return false;
    const board: (ReturnType<typeof createHero> | null)[][] = Array.from({ length: 6 }, () => Array(6).fill(null));
    const caster = createHero('bounty', 'player1', [2, 1]);
    const target = createHero('moran', 'player2', [2, 3]);
    const other = createHero('huifeng', 'player2', [5, 5]);
    target.shield = kind === 'shield-hit' ? 20 : kind.startsWith('shield-break') || kind === 'critical-break' ? 8 : 0;
    if (kind === 'lethal') target.currentHp = 5;
    for (const hero of [caster, target, other]) board[hero.position![0]][hero.position![1]] = hero;
    useGameStore.setState({ board, player1Heroes: [caster], player2Heroes: [target, other], phase: 'battle',
        selectedHero: null, activeHero: null, selectedSkill: null, skillFx: [], battleLog: [], skillFxExtras: undefined,
        pendingSkillTargetPositions: [], currentPlayer: 'player1' });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const demo = useGameStore.getState();
    const amount = kind === 'zero' ? 0 : kind === 'normal' || kind === 'multihit' ? 5
        : kind === 'shield-break-exact' ? 8 : kind === 'burn' ? 3 : 15;
    for (let i = 0; i < (kind === 'multihit' ? 3 : 1); i++) {
        DamageCalculator.applyDamage(target, { finalDamage: amount, isCrit: kind === 'critical' || kind === 'delayed' || kind === 'critical-break',
            vampireAmount: 0, shieldDamage: 0, hpDamage: 0, killed: false, logTag: kind === 'burn' ? 'burn' : undefined }, caster, demo);
    }
    const logs = demo.battleLog.filter(entry => entry.type === 'damage');
    if (kind === 'delayed') demo.pushSkillFx({ profile: resolveSkillFx('feynman_skill1'), skillId: 'feynman_skill1',
        logIds: logs.map(entry => entry.id), owner: 'player1', fromPos: [2, 1], targetPos: [2, 3], angleDeg: 0, direction: 'E', damagePositions: [[2, 3]] });
    useGameStore.setState({ board: demo.board.map(row => [...row]), battleLog: [...demo.battleLog] });
    return true;
}

function prepareTimingDemo(lethal = false): void {
    ensureFxDemoStage();
    const board: (ReturnType<typeof createHero> | null)[][] = Array.from({ length: 6 }, () => Array(6).fill(null));
    const caster = createHero('bounty', 'player1', [2, 1]);
    const target = createHero('moran', 'player2', [2, 3]);
    const other = createHero('huifeng', 'player2', [5, 5]);
    target.currentHp = lethal ? 1 : target.maxHp;
    for (const hero of [caster, target, other]) board[hero.position![0]][hero.position![1]] = hero;
    useGameStore.setState({ board, player1Heroes: [caster], player2Heroes: [target, other],
        phase: 'battle', currentPlayer: 'player1', selectedHero: caster, selectedSkill: getSkill('bounty_skill2')!,
        activeHero: null, skillFx: [], battleLog: [], skillFxExtras: undefined, actionsRequiredThisTurn: 8 });
}

function yunxiuCloudSnapshot() {
    const state = useGameStore.getState();
    return { clouds: state.boardEffects?.filter(effect => effect.type === 'thunder-cloud'),
        events: state.skillFx.filter(event => event.skillId?.startsWith('yunxiu')).map(event => ({
            id: event.id, skillId: event.skillId, targetPos: event.targetPos, impactPositions: event.impactPositions,
            bornAt: event.bornAt, logIds: event.logIds, hitMs: event.profile.impactMs,
        })), enemies: state.player2Heroes.map(hero => ({ hp: hero.currentHp, position: hero.position })) };
}

function prepareYunxiuCloudDemo(mode: 'center' | 'edge' | 'empty' | 'dense' = 'center'): void {
    ensureFxDemoStage();
    const edge = mode === 'edge';
    const caster = createHero('yunxiu', 'player1', edge ? [0, 2] : [2, 0]);
    const positions: Position[] = edge ? [[0, 0], [0, 1], [1, 1]] : mode === 'empty' ? [[5, 5]] : [[1, 2], [2, 3], [3, 3]];
    const enemies = positions.map(position => {
        const enemy = createHero('baize', 'player2', position);
        enemy.currentHp = enemy.maxHp = 200; enemy.defense = 0; enemy.passiveId = ''; return enemy;
    });
    const board = Array.from({ length: 6 }, () => Array(6).fill(null));
    for (const hero of [caster, ...enemies]) board[hero.position![0]][hero.position![1]] = hero;
    useGameStore.setState({ board, player1Heroes: [caster], player2Heroes: enemies, boardEffects: [],
        phase: 'battle', gameMode: 'standard', currentPlayer: 'player1', selectedHero: caster, activeHero: caster,
        selectedSkill: getSkill('yunxiu_skill1')!, skillFx: [], battleLog: [], skillFxExtras: undefined,
        actionsThisTurn: 0, actionsRequiredThisTurn: 8, roundNumber: 1, pendingBoardAction: undefined,
        pendingExtraActionHeroIds: {}, performingExtraAction: false });
    if (mode === 'dense') {
        const state = useGameStore.getState();
        for (const cell of [[1, 1], [2, 2], [3, 1]] as Position[]) placeCloud(state, caster, cell);
        for (const cell of [[1, 4], [3, 4], [4, 3]] as Position[]) placeCloud(state, enemies[0], cell);
        useGameStore.setState({ boardEffects: [...(state.boardEffects ?? [])] });
    }
}

function prepareAoyuanSequenceDemo(skill: 'summon' | 'dash'): void {
    ensureFxDemoStage();
    const caster = createHero('aoyuan', 'player1', skill === 'summon' ? [2, 2] : [2, 1]);
    if (skill === 'dash') attachDragon(caster, [1, 1]);
    const target = createHero('baize', 'player2', skill === 'summon' ? [1, 3] : [2, 2]);
    const other = createHero('moran', 'player2', [1, 4]);
    for (const hero of [target, other]) { hero.maxHp = hero.currentHp = 200; hero.defense = 0; hero.passiveId = ''; }
    const board = Array.from({ length: 6 }, () => Array(6).fill(null));
    for (const hero of [caster, target, other]) board[hero.position![0]][hero.position![1]] = hero;
    useGameStore.setState({ board, player1Heroes: [caster], player2Heroes: [target, other],
        phase: 'battle', gameMode: 'standard', currentPlayer: 'player1', selectedHero: caster, activeHero: caster,
        selectedSkill: getSkill(skill === 'summon' ? 'aoyuan_skill1' : 'aoyuan_skill2')!,
        skillFx: [], battleLog: [], skillFxExtras: undefined, actionsThisTurn: 0, actionsRequiredThisTurn: 8,
        roundNumber: 1, pendingBoardAction: undefined, pendingExtraActionHeroIds: {}, performingExtraAction: false });
}

function prepareWangshuDemo(mode: 'standard' | 'classic' = 'standard'): void {
    ensureFxDemoStage();
    const caster = applyZhizhiForMode(createHero('wangshu', 'player1', [2, 2]), mode);
    const ally = createHero('moran', 'player1', [3, 3]); ally.maxHp = 100; ally.currentHp = 20; ally.passiveId = '';
    const high = createHero('liuli', 'player1', [5, 5]); high.maxHp = 100; high.currentHp = 100; high.passiveId = '';
    const enemy = createHero('baize', 'player2', [0, 4]); enemy.maxHp = 100; enemy.currentHp = 80; enemy.passiveId = '';
    const other = createHero('moran', 'player2', [5, 0]);
    const board = Array.from({ length: 6 }, () => Array(6).fill(null));
    for (const hero of [caster, ally, high, enemy, other]) board[hero.position![0]][hero.position![1]] = hero;
    useGameStore.setState({ board, player1Heroes: [caster, ally, high], player2Heroes: [enemy, other],
        phase: 'battle', gameMode: mode, currentPlayer: 'player1', selectedHero: caster, activeHero: null,
        selectedSkill: null, skillFx: [], battleLog: [], skillFxExtras: undefined,
        actionsThisTurn: 0, actionsRequiredThisTurn: 8, roundNumber: 1, pendingBoardAction: undefined,
        pendingExtraActionHeroIds: {}, performingExtraAction: false });
}

function wangshuDemoStep(action: 'attack' | 'heal' | 'kill' | 'self'): void {
    const state = useGameStore.getState(), caster = state.player1Heroes.find(hero => hero.passiveId === 'wangshu_passive')!;
    caster.hasActedThisTurn = false;
    const healing = action === 'heal' || action === 'self';
    const target = action === 'self' ? caster : healing ? state.player1Heroes[1] : state.player2Heroes[0];
    if (action === 'kill') { target.currentHp = 10; caster.counters['望'] = 200; }
    if (action === 'self') caster.currentHp = 10;
    useGameStore.setState({ currentPlayer: 'player1', selectedHero: caster, activeHero: caster,
        selectedSkill: getSkill(healing ? caster.skill2Id : caster.skill1Id)!, pendingBoardAction: undefined });
    useGameStore.getState().executeSkill(target.position!);
}

function runSkillFxDemo(skillId: string, empowered = false): boolean {
    if (!ensureFxDemoStage()) return false;
    const { event } = buildSkillPreviewScene(skillId);
    const board: (ReturnType<typeof createHero> | null)[][] = Array.from({ length: 6 }, () => Array(6).fill(null));
    // 被动/天威追加段这类 id（jiangtaigong_hook、zhiyuan_pursue）不是技能表里的键：
    // 退一步用首段当模板，才能给它们摆出同一个施法者
    const templateId = event.profile.mechanism || !getSkill(skillId)
        ? skillId.split('_')[0]
        : skillId.replace(/_(skill\d+|awaken|revive|heal|followup|regen|entrance|restore|tianwei)$/, '');
    const caster = createHero(templateId === 'painting' ? 't_painting' : templateId, 'player1', event.fromPos);
    if (!caster) return false;
    if (event.profile.mechanism === 'king-shift') caster.counters['jetzmi_form'] = 1;
    if (event.profile.mechanism === 'lord-shift') caster.counters['jetzmi_form'] = 0;
    if (event.profile.mechanism === 'rebirth') EffectManager.addEffect(caster, {
        name: '长离复生增伤', type: 'buff', duration: -1, sourceHeroId: caster.id, description: '',
    });
    const support = !!event.profile.recovery || getSkill(skillId)?.type === 'heal' || getSkill(skillId)?.targetType === 'ally' ||
        ['feixue-bond', 'yang-link', 'coin-blessing', 'chord-aura', 'heal-wave'].includes(event.profile.kind);
    const targets = [event.targetPos, ...(event.impactPositions ?? [])];
    board[event.fromPos[0]][event.fromPos[1]] = caster;
    const buddies = [];
    for (const pos of targets) {
        if (board[pos[0]][pos[1]]) continue;
        if (getSkill(skillId)?.targetType === 'empty' || getSkill(skillId)?.type === 'summon') continue;
        const target = createHero('moran', support ? 'player1' : 'player2', pos);
        board[pos[0]][pos[1]] = target;
        buddies.push(target);
    }
    useGameStore.setState({ board, player1Heroes: [caster, ...buddies.filter(hero => hero.owner === 'player1')],
        player2Heroes: buddies.filter(hero => hero.owner === 'player2'), skillFx: [], battleLog: [] });
    useGameStore.getState().pushSkillFx({ ...event, sourceHeroId: caster.id, empowered });
    return true;
}

/** 机制验收走真实结算，浏览器与单元测试都不靠伪造触发来保证接线正确。 */
function runMechanismTriggerDemo(skillId: string): boolean {
    const profile = resolveSkillFx(skillId);
    if (!profile.mechanism || !ensureFxDemoStage()) return false;
    const hero = createHero(skillId.split('_')[0], 'player1', [2, 2]);
    const enemy = createHero('moran', 'player2', [2, 3]);
    const board = Array.from({ length: 6 }, () => Array(6).fill(null));
    board[2][2] = hero; board[2][3] = enemy;
    useGameStore.setState({ board, player1Heroes: [hero], player2Heroes: [enemy],
        selectedHero: null, activeHero: null, selectedSkill: null, skillFx: [], battleLog: [],
        skillFxExtras: undefined, performingExtraAction: false, pendingExtraActionHeroIds: {} });
    const state = useGameStore.getState();
    const apply = (amount: number) => DamageCalculator.applyDamage(hero, DamageCalculator.calculate(enemy, hero, amount, false), enemy, state);
    const buff = (name: string) => EffectManager.addEffect(hero, { name, type: 'buff', duration: -1, sourceHeroId: hero.id, description: '' });
    switch (profile.mechanism) {
        case 'rebirth': hero.currentHp = 1; apply(1000); break;
        case 'king-shift': hero.counters['jetzmi_form'] = 0; GameEngine.switchJetzmiFormInPlace(hero, state); break;
        case 'lord-shift': hero.counters['jetzmi_form'] = 1; GameEngine.switchJetzmiFormInPlace(hero, state); break;
        case 'conversion': hero.currentHp = 10; hero.counters['xuanxiao_danger_armed'] = 1; apply(8); break;
        case 'counter': buff('金银错'); apply(8); break;
        case 'laststand': buff('龙势'); hero.currentHp = 8; apply(1000); break;
        case 'extra-action': buff('为道'); hero.counters['为道受击'] = 1; apply(2); break;
        case 'zhaoshen': apply(5); break;   // 唯一敌人被盖金痕 → 真实结算里直接触发昭神
    }
    useGameStore.setState({ board: board.map(row => [...row]), player1Heroes: [hero], player2Heroes: [enemy], battleLog: [...state.battleLog] });
    return true;
}

function runFxDemo(
    scenario:
        | 'stage' | 'chain' | 'splash' | 'aoe' | 'death' | 'death-pseudo' | 'status' | 'tick'
        | 'areagrid' | 'areafire' | 'areastorm' | 'areashock'
        | 'fxstaff' | 'fxsword' | 'fxice' | 'fxred' | 'fxblade'
        | 'fxpearl' | 'fxwave' | 'fxfan' | 'fxclaw' | 'fxpounce' | 'fxdragon'
        | 'fxdash' | 'fxwheel' | 'fxjinghua' | 'fxmarsh' | 'fxbinding' | 'fxzhiguang' | 'fxbeam' | 'fxyunying' | 'fxyunying2' | 'fxlibai' | 'daistasis'
        | 'fxheal' | 'fxhealwave' | 'fxregen' | 'fxrevive' | 'fxward' | 'fxreap' | 'fxreckon'
        | 'fxyoulong' | 'fxyunxiu'
): boolean {
    if (!ensureFxDemoStage()) return false;
    const state = useGameStore.getState();
    const heroOf = (templateId: string) =>
        [...state.player1Heroes, ...state.player2Heroes].find(
            hero => hero.id.startsWith(`${templateId}-`)
        );

    switch (scenario) {
        case 'fxyoulong': {
            // 常驻游龙：唤龙之后那尾龙停在机制算出的方位上，随本体移动、随盘旋转向
            if (!runSkillFxDemo('aoyuan_skill1')) return false;
            const caster = [...useGameStore.getState().player1Heroes]
                .find(hero => hero.id.startsWith('aoyuan-'));
            if (!caster?.position) return false;
            attachDragon(caster, [caster.position[0] - 1, caster.position[1]]);
            gainScales(caster, 3);
            useGameStore.setState({ player1Heroes: [...useGameStore.getState().player1Heroes] });
            return true;
        }
        case 'fxyunxiu': {
            // 雷云与引雷针的常驻外观：走真实结算，棋盘上留下的就是玩家实战里看到的两件东西
            if (!runSkillFxDemo('yunxiu_skill1')) return false;
            const state = useGameStore.getState();
            const caster = [...state.player1Heroes].find(hero => hero.id.startsWith('yunxiu-'));
            const enemy = [...state.player2Heroes].find(hero => hero.position);
            if (!caster?.position || !enemy?.position) return false;
            const [row, col] = caster.position;
            // 南北各布一团云，再往敌人脚下落一枚针
            caster.counters['__extended_target'] = (row - 1) * 6 + col;
            yunxiuSkill1.execute!(caster, [], state);
            caster.counters['__extended_target'] = (row + 1) * 6 + col;
            yunxiuSkill1.execute!(caster, [], state);
            yunxiuSkill2.execute!(caster, [enemy], state);
            useGameStore.setState({
                board: state.board.map(boardRow => [...boardRow]),
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                boardEffects: [...(state.boardEffects ?? [])],
                battleLog: [...state.battleLog],
            });
            return true;
        }
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
        case 'fxheal':
            // 单体净化回春：八道净化光丝自四周向内收拢汇入白泽脚下 + 柔光柱 + 生环
            pushDemoSkillFx('baize', 'baize_skill1', [1, 4], [2, 4]);
            return true;
        case 'fxhealwave': {
            // 群体恢复：波心在吟游诗人自己脚下（[2,1]），三道同心波荡向区缘，
            // 被抬到血的三格各自升起一根细光柱，只扫过的格柱身收矮
            const healed: Position[] = [[2, 2], [2, 3], [1, 2]];
            pushDemoSkillFx('zhenxiao', 'bard_skill2', [2, 1], [2, 2], {
                impactPositions: healed,
                softImpactPositions: healed,
            });
            return true;
        }
        case 'fxregen':
            // 持续/延迟回血：三颗回血珠绕体缓转，三跳各冒一颗上飘的绿点
            // （叙白黑白球的自动回血段与泠汐海螺回响的延迟段共用这套原型）
            pushDemoSkillFx('zhenxiao', 'xubai_regen', [4, 1], [4, 1]);
            return true;
        case 'fxrevive':
            // 复活仪式：压暗 → 光带自地面往上拉 → 轮廓由虚到实 → 金色涟漪
            pushDemoSkillFx('baize', 'baize_skill2', [1, 4], [4, 1]);
            return true;
        case 'fxward':
            // 护盾援护：六边形罩面在队友格上展开、流光沿棱走一圈，琉璃那手 3×3 走守护法阵底效
            pushDemoSkillFx('liuli', 'liuli_skill1', [3, 4], [2, 4]);
            return true;
        case 'fxdragon':
            // 震霄·龙势触发：金墨圈 + 头像矢量墨龙俯冲护体；同时挂常驻状态同屏验收
            pushDemoSkillFx('zhenxiao', 'zhenxiao_laststand', [2, 1], [2, 3]);
            {
                const zx = heroOf('zhenxiao');
                if (zx && !EffectManager.hasEffect(zx, '龙势')) {
                    EffectManager.addEffect(zx, {
                        type: 'buff', name: '龙势', duration: 2,
                        sourceHeroId: zx.id, description: '演示',
                    });
                    useGameStore.setState({
                        player1Heroes: [...useGameStore.getState().player1Heroes],
                    });
                }
            }
            return true;
        case 'fxreap':
            // 夺岁·斩岁：跨格新月巨刃 + 血偿刻印
            pushDemoSkillFx('zhenxiao', 'duosui_skill1', [2, 1], [2, 3]);
            return true;
        case 'fxreckon':
            // 夺岁·偿岁：目标格红刃痕从地而起 + 施法格盾环合拢
            pushDemoSkillFx('zhenxiao', 'duosui_skill2', [2, 1], [2, 3]);
            return true;
        case 'fxblade':
            return runMirrorBladeDemo();
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
        case 'fxyunying':
            // 云缨·星火照野（左上）：长枪绕身旋舞一周，四道弧刃逐拍甩开
            pushDemoSkillFx('yunying', 'yunying_skill1', [4, 0], [4, 1]);
            // 云缨·踏火长驱：真枪两扫，枪尖扫过的扇形烧成红色火扇
            pushDemoSkillFx('yunying', 'yunying_skill2', [2, 1], [2, 2]);
            return true;
        case 'fxyunying2':
            // 只放技能二，便于单独看清踏火长驱的火扇与真枪
            pushDemoSkillFx('yunying', 'yunying_skill2', [2, 1], [2, 2]);
            return true;
        case 'fxlibai': {
            // 李太白·谪仙醉斩：2×3 青莲剑阵边框先钉住范围，四道剑光穿阵
            const rect: Position[] = [];
            for (let r = 1; r <= 3; r++) {
                for (let c = 2; c <= 3; c++) rect.push([r, c]);
            }
            pushDemoSkillFx('libai', 'libai_skill2', [2, 1], [2, 2], {
                coveredPositions: rect,
                impactPositions: [[2, 2], [2, 3]],
            });
            return true;
        }
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
        case 'fxmarsh': {
            // 姜太公的棋盘家具：一片 3×3 水泽（重叠两层）+ 一枚沉在水底的鱼钩
            if (!ensureFxDemoStage()) return false;
            const stage = useGameStore.getState();
            useGameStore.setState({
                boardEffects: [
                    ...(stage.boardEffects ?? []).filter(effect =>
                        effect.type !== 'water-marsh' && effect.type !== 'fish-hook'),
                    {
                        id: 'demo-water-marsh-a',
                        type: 'water-marsh',
                        position: [2, 1] as Position,
                        owner: 'player1' as const,
                        sourceHeroId: 'demo-jiangtaigong',
                        duration: 2,
                    },
                    {
                        id: 'demo-water-marsh-b',
                        type: 'water-marsh',
                        position: [2, 2] as Position,
                        owner: 'player1' as const,
                        sourceHeroId: 'demo-jiangtaigong',
                        duration: 2,
                    },
                    {
                        id: 'demo-fish-hook',
                        type: 'fish-hook',
                        position: [4, 4] as Position,
                        owner: 'player2' as const,
                        sourceHeroId: 'demo-jiangtaigong-2',
                        duration: 3,
                    },
                ],
            });
            return true;
        }
        case 'fxbinding': {
            // 束缚区常驻标记：震霄「金银错」的 3×3 实心圈（金）+ 血契的 3×3 空心环（赤），
            // 同 linkId 的格子共享边界判据，锁栏只画在贴着圈外的那一侧
            if (!ensureFxDemoStage()) return false;
            const stage = useGameStore.getState();
            const solid: Position[] = [];
            for (let r = 1; r <= 3; r++) {
                for (let c = 0; c <= 2; c++) solid.push([r, c] as Position);
            }
            const ring: Position[] = [];
            for (let r = 3; r <= 5; r++) {
                for (let c = 3; c <= 5; c++) {
                    if (r === 4 && c === 4) continue;
                    ring.push([r, c] as Position);
                }
            }
            const group = (linkId: string, cells: Position[], owner: 'player1' | 'player2', sourceHeroId: string) =>
                cells.map(([r, c]) => ({
                    id: `${linkId}-${r}-${c}`,
                    type: 'binding-zone' as const,
                    position: [r, c] as Position,
                    owner,
                    sourceHeroId,
                    duration: 99,
                    linkId,
                }));
            useGameStore.setState({
                boardEffects: [
                    ...(stage.boardEffects ?? []).filter(effect => effect.type !== 'binding-zone'),
                    ...group('demo-zhenxiao-binding', solid, 'player1', 'demo-zhenxiao'),
                    ...group('demo-xueqi-binding', ring, 'player2', 'demo-xueqi'),
                ],
            });
            return true;
        }
        case 'fxzhiguang': {
            // 折光的光棱：两边阵营各一枚，验证晶面描边分色与呼吸光晕
            if (!ensureFxDemoStage()) return false;
            const stage = useGameStore.getState();
            useGameStore.setState({
                boardEffects: [
                    ...(stage.boardEffects ?? []).filter(effect => effect.type !== 'light-prism'),
                    {
                        id: 'demo-light-prism-p1',
                        type: 'light-prism',
                        position: [2, 2] as Position,
                        owner: 'player1' as const,
                        sourceHeroId: 'demo-zhiguang',
                        duration: 3,
                    },
                    {
                        id: 'demo-light-prism-p2',
                        type: 'light-prism',
                        position: [3, 3] as Position,
                        owner: 'player2' as const,
                        sourceHeroId: 'demo-zhiguang-2',
                        duration: 3,
                    },
                ],
            });
            return true;
        }
        case 'fxbeam': {
            // 棱光千折的光路演示：向东两格 → 被光棱拐向南两格 → 再拐向东冲到边缘
            if (!ensureFxDemoStage()) return false;
            const fromPos: Position = [2, 1];
            const path: Position[] = [[2, 2], [2, 3], [3, 3], [4, 3], [4, 4], [4, 5]];
            const angleDeg = computeFxAngleDeg(fromPos, [2, 2]);
            useGameStore.getState().pushSkillFx({
                profile: resolveSkillFx('zhiguang_skill2'),
                owner: 'player1',
                fromPos,
                targetPos: [2, 2],
                angleDeg,
                direction: computeFxDirection(angleDeg),
                coveredPositions: path,
                impactPositions: [[3, 3], [4, 5]],
                areaBounds: computeSkillAreaBounds(getSkill('zhiguang_skill2')!, path) ?? undefined,
            });
            return true;
        }
        case 'death':
            // 真英雄阵亡：水墨消散 + 全局震屏 + 击杀横幅（hero-kill 三件套）
            state.addLog({
                type: 'kill',
                player: 'player1',
                message: '特效演示：击杀',
                details: {
                    kind: 'hero-kill',
                    killerHeroId: 'moran-player1-1',
                    killerName: '演示击杀者',
                    victimHeroId: 'baize-player2-1',
                    victimName: '演示单位',
                    victimPosition: [3, 2],
                    killCount: 1,
                },
            });
            return true;
        case 'death-pseudo':
            // 召唤物/分身被打散：只有水墨消散，不震屏也不弹横幅（pseudo-kill）
            state.addLog({
                type: 'kill',
                player: 'player1',
                message: '特效演示：打散召唤物',
                details: {
                    kind: 'pseudo-kill',
                    victimHeroId: 't-summon|jinwu|t_painting-player2-1|1|1',
                    victimName: '金乌',
                    victimPosition: [3, 2],
                },
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
                // 霆渊的两枚印同屏：引雷印（雷金双纹）与链式闪电（青紫电环）要一眼分得开
                EffectManager.addEffect(chain, {
                    type: 'mark', name: '引雷印', duration: 3,
                    sourceHeroId: heroOf('tingyuan')?.id ?? 'demo', description: '演示',
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
    // 取帧脚本要就地改一份特效事件的几何（例如抛掷的钓线得真的跨过棋盘才判读得出长短），
    // 所以把 store 本身也挂出来；只在 VITE_E2E 构建里存在，正式包拿不到。
    (window as unknown as { __SIX_CHESS_STORE__?: typeof useGameStore }).__SIX_CHESS_STORE__ = useGameStore;
    window.__SIX_CHESS_E2E__ = {
        prepareSkillAudio: async skillIds => {
            audioManager.unlock();
            await soundManager.warmupFor(skillIds);
            return audioManager.getAudioContext()?.state ?? 'unsupported';
        },
        setBattleSoundMuted: muted => soundManager.setMuted(muted),
        skillAudioSnapshot: () => useGameStore.getState().skillFx.map(event => ({
            id: event.id, skillId: event.skillId, bornAt: event.bornAt, cues: planSkillSoundCues(event),
        })),
        hitFeedbackDemo,
        snapshot,
        prepareFinalStrike,
        fxDemo: runFxDemo,
        mirrorBladeDemo: runMirrorBladeDemo,
        skillFxDemo: runSkillFxDemo,
        mechanismTriggerDemo: runMechanismTriggerDemo,
        prepareTimingDemo,
        castTimingDemo: () => useGameStore.getState().executeSkill([2, 3]),
        prepareWangshuDemo,
        prepareYunxiuCloudDemo,
        castYunxiuCloudDemo: () => {
            const caster = useGameStore.getState().player1Heroes[0];
            useGameStore.getState().executeSkill(caster.position?.[0] === 0 ? [0, 0] : [2, 2]);
            return yunxiuCloudSnapshot();
        },
        tickYunxiuCloudDemo: () => {
            const state = useGameStore.getState(), caster = state.player1Heroes[0];
            placeRod(state, caster, [2, 4]);
            const logs = tickCloudsAtRoundStart(state, caster);
            useGameStore.setState({ boardEffects: [...(state.boardEffects ?? [])], battleLog: [...state.battleLog] });
            for (const message of logs) useGameStore.getState().addLog({ type: 'passive', player: caster.owner, message });
            return yunxiuCloudSnapshot();
        },
        prepareAoyuanSequenceDemo,
        castAoyuanSequenceDemo: () => {
            const skill = useGameStore.getState().selectedSkill;
            useGameStore.getState().executeSkill(skill?.id === 'aoyuan_skill1' ? [1, 2] : [2, 4]);
            return useGameStore.getState().skillFx.map(event => ({ id: event.id, skillId: event.skillId,
                bornAt: event.bornAt, startDelayMs: event.startDelayMs, dragonContactsOnly: event.dragonContactsOnly,
                dragonStartDeg: event.dragonStartDeg, fromPos: event.fromPos, targetPos: event.targetPos,
                coveredPositions: event.coveredPositions }));
        },
        wangshuDemoStep,
        wangshuDemoSnapshot: () => {
            const state = useGameStore.getState(), caster = state.player1Heroes.find(hero => hero.passiveId === 'wangshu_passive');
            return { caster, ally: state.player1Heroes[1], enemy: state.player2Heroes[0],
                events: state.skillFx.map(event => ({ skillId: event.skillId, moon: event.profile.moon })),
                logs: state.battleLog.map(log => ({ type: log.type, message: log.message })) };
        },
        setQualityMode: mode => setRenderQualityPreference(mode),
    };
}
