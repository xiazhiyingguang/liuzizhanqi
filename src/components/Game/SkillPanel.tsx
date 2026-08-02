import { useGameStore } from '../../store/game-store';
import { getSkill } from '../../data/skills';
import HeroAvatar from '../ui/HeroAvatar';

export default function SkillPanel() {
    const {
        selectedHero,
        selectedSkill,
        currentPlayer,
        isAiMode,
        aiPlayer,
        player1Heroes,
        player2Heroes,
        baizeReviveTargetHeroId,
        changliSkill2Empowered,
        jetzmiSkill1Enhanced,
        heroXRedirectTargetIds,
        soulLampBeneficiaryIds,
        skillSelectedHeroIds,
        showMoveRange,
        selectSkill,
        selectBaizeReviveTarget,
        toggleChangliSkill2Empowered,
        toggleJetzmiSkill1Enhanced,
        selectHeroXRedirectTarget,
        selectSoulLampBeneficiary,
        selectSkillHeroTarget,
        endHeroAction
    } = useGameStore();

    if (isAiMode && currentPlayer === aiPlayer) {
        return (
            <div className="ink-panel p-4 h-full flex flex-col items-center justify-center text-center">
                <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
                    {[0, 1, 2].map(index => (
                        <span
                            key={index}
                            className="h-2 w-2 rounded-full bg-vermillion/55 animate-pulse"
                            style={{ animationDelay: `${index * 160}ms` }}
                        />
                    ))}
                </div>
                <h3 className="font-title text-base text-vermillion">宗师电脑思考中</h3>
                <p className="mt-2 text-xs leading-5 text-ink-faint font-body">
                    正在评估技能收益、击杀机会与站位风险
                </p>
            </div>
        );
    }

    if (!selectedHero) {
        return (
            <div className="ink-panel p-4 h-full flex flex-col">
                <h3 className="font-title text-base text-ink mb-3">操作</h3>
                <p className="text-ink-faint text-sm font-body text-center py-8">
                    请选择一位英雄
                </p>
            </div>
        );
    }

    if (selectedHero.owner !== currentPlayer) {
        return (
            <div className="ink-panel p-4 h-full flex flex-col">
                <h3 className="font-title text-base text-ink mb-3">操作</h3>
                <p className="text-ink-faint text-sm font-body text-center py-8">
                    无法操作对方英雄
                </p>
            </div>
        );
    }

    const skill1 = getSkill(selectedHero.skill1Id);
    const skill2 = getSkill(selectedHero.skill2Id);
    const isP1 = selectedHero.owner === 'player1';
    const deadAllies = (selectedHero.owner === 'player1' ? player1Heroes : player2Heroes)
        .filter(hero => hero.state === 'dead');
    const choosingBaizeReviveTarget =
        selectedSkill?.id === 'baize_skill2' &&
        (selectedHero.counters['天禄'] ?? 0) >= 3 &&
        deadAllies.length > 0;
    const livingAllies = (selectedHero.owner === 'player1' ? player1Heroes : player2Heroes)
        .filter(hero => hero.state === 'alive' && hero.id !== selectedHero.id);
    const temporarilyDeadAllies = (selectedHero.owner === 'player1' ? player1Heroes : player2Heroes)
        .filter(hero => hero.state === 'temp_dead');
    const visibleCounters = Object.entries(selectedHero.counters)
        .filter(([name]) => /[\u3400-\u9fff]/.test(name));

    return (
        <div className="ink-panel p-4 h-full flex flex-col overflow-hidden">
            {/* 英雄头部 */}
            <div className="flex items-center gap-2.5 mb-3 flex-shrink-0">
                <div className={`
                    w-9 h-9 rounded-lg flex items-center justify-center
                    ${isP1 ? 'bg-indigo-ink/10 border border-indigo-ink/20' : 'bg-vermillion/10 border border-vermillion/20'}
                `}>
                    <HeroAvatar
                        heroId={selectedHero.id}
                        heroName={selectedHero.name}
                        size={36}
                        className="h-full w-full rounded-[7px] object-cover"
                        fallbackClassName={isP1 ? 'text-indigo-ink' : 'text-vermillion'}
                        eager
                    />
                </div>
                <div>
                    <h3 className="font-title text-sm text-ink leading-tight">{selectedHero.name}</h3>
                    <span className="text-[10px] text-ink-faint font-body">选择操作</span>
                </div>
            </div>

            {/* 操作列表 */}
            <div className="space-y-2 overflow-y-auto flex-1 min-h-0 light-scrollbar pr-1">
                {/* 移动 */}
                <button
                    disabled={selectedHero.hasActedThisTurn || selectedHero.hasMovedThisTurn}
                    onClick={() => showMoveRange()}
                    className="skill-btn skill-btn-move"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-jade font-title text-sm">行</span>
                            <span className="font-body text-sm text-ink">移动</span>
                            {selectedHero.hasMovedThisTurn && (
                                <span className="text-jade text-xs">✓</span>
                            )}
                        </div>
                        <span className="text-[10px] text-ink-faint font-body">
                            移动力 {selectedHero.moveRange}
                        </span>
                    </div>
                </button>

                {/* 技能1 */}
                {skill1 && (
                    <button
                        disabled={selectedHero.hasActedThisTurn}
                        onClick={() => selectSkill(skill1.id)}
                        className="skill-btn skill-btn-skill"
                    >
                        <div className="flex items-center justify-between mb-0.5">
                            <div className="flex items-center gap-2">
                                <span className="text-indigo-ink font-title text-sm">技</span>
                                <span className="font-body text-sm text-ink">{skill1.name}</span>
                            </div>
                            {skill1.baseDamage && (
                                <span className="text-[10px] text-vermillion font-body">
                                    {skill1.baseDamage}伤
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-ink-faint font-body leading-relaxed pl-5">
                            {skill1.description}
                        </p>
                    </button>
                )}

                {/* 技能2 */}
                {skill2 && (
                    <button
                        disabled={selectedHero.hasActedThisTurn}
                        onClick={() => selectSkill(skill2.id)}
                        className="skill-btn skill-btn-ultimate"
                    >
                        <div className="flex items-center justify-between mb-0.5">
                            <div className="flex items-center gap-2">
                                <span className="text-purple-700 font-title text-sm">术</span>
                                <span className="font-body text-sm text-ink">{skill2.name}</span>
                            </div>
                            {skill2.baseDamage && (
                                <span className="text-[10px] text-vermillion font-body">
                                    {skill2.baseDamage}伤
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-ink-faint font-body leading-relaxed pl-5">
                            {skill2.description}
                        </p>
                    </button>
                )}

                {choosingBaizeReviveTarget && (
                    <div className="ink-surface p-2 space-y-1.5">
                        <p className="text-[11px] text-ink-light font-body">
                            {baizeReviveTargetHeroId ? '已选目标，请点击棋盘空位' : '选择要复活的英雄'}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {deadAllies.map(hero => (
                                <button
                                    key={hero.id}
                                    onClick={() => selectBaizeReviveTarget(hero.id)}
                                    className={`px-2 py-1 text-xs rounded border font-body ${
                                        baizeReviveTargetHeroId === hero.id
                                            ? 'border-jade bg-jade/10 text-jade'
                                            : 'border-ink/15 text-ink-light hover:bg-ink/5'
                                    }`}
                                >
                                    {hero.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {selectedSkill?.id === 'changli_skill2' &&
                    (selectedHero.counters['暗夜星火'] ?? 0) >= 2 && (
                    <button
                        onClick={toggleChangliSkill2Empowered}
                        className={`skill-btn ${
                            changliSkill2Empowered
                                ? 'border-purple-600 bg-purple-600/10 text-purple-800'
                                : 'border-ink/15 text-ink-light'
                        }`}
                    >
                        {changliSkill2Empowered
                            ? '已选择：消耗2层星火尝试眩晕'
                            : '强化释放：消耗2层星火（可选）'}
                    </button>
                )}

                {selectedSkill?.id === 'jetzmi_skill1' &&
                    selectedHero.name === '亡灵城主·杰茨米' &&
                    (selectedHero.counters['jetzmi_form'] ?? 0) !== 1 && (
                    <button
                        onClick={toggleJetzmiSkill1Enhanced}
                        className={`skill-btn ${
                            jetzmiSkill1Enhanced
                                ? 'border-purple-600 bg-purple-600/10 text-purple-800'
                                : 'border-ink/15 text-ink-light'
                        }`}
                    >
                        {jetzmiSkill1Enhanced
                            ? '已选择：消耗2点亡灵共鸣攻击第二目标'
                            : '强化释放：消耗2点亡灵共鸣（可选）'}
                    </button>
                )}

                {selectedHero.passiveId === 'hero_x_passive' &&
                    (selectedHero.counters['增势'] ?? 0) >= 3 &&
                    livingAllies.length > 0 && (
                    <div className="ink-surface p-2 space-y-1.5">
                        <p className="text-[11px] text-ink-light font-body">选择下次增势援护的承伤队友</p>
                        <div className="flex flex-wrap gap-1.5">
                            {livingAllies.map(hero => (
                                <button
                                    key={hero.id}
                                    onClick={() => selectHeroXRedirectTarget(hero.id)}
                                    className={`px-2 py-1 text-xs rounded border font-body ${
                                        heroXRedirectTargetIds?.[selectedHero.id] === hero.id
                                            ? 'border-jade bg-jade/10 text-jade'
                                            : 'border-ink/15 text-ink-light hover:bg-ink/5'
                                    }`}
                                >
                                    {hero.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {selectedHero.passiveId === 'soul_lamp_passive' && livingAllies.length > 0 && (
                    <div className="ink-surface p-2 space-y-1.5">
                        <p className="text-[11px] text-ink-light font-body">选择缚魂灯的吸血受益者（真实死亡后永久生效）</p>
                        <div className="flex flex-wrap gap-1.5">
                            {livingAllies.map(hero => (
                                <button
                                    key={hero.id}
                                    onClick={() => selectSoulLampBeneficiary(hero.id)}
                                    className={`px-2 py-1 text-xs rounded border font-body ${
                                        soulLampBeneficiaryIds?.[selectedHero.id] === hero.id
                                            ? 'border-jade bg-jade/10 text-jade'
                                            : 'border-ink/15 text-ink-light hover:bg-ink/5'
                                    }`}
                                >
                                    {hero.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {selectedSkill?.id === 'jetzmi_skill2' && temporarilyDeadAllies.length > 0 && (
                    <div className="ink-surface p-2 space-y-1.5">
                        <p className="text-[11px] text-ink-light font-body">选择要复活的暂时阵亡队友，然后点击杰茨米释放</p>
                        <div className="flex flex-wrap gap-1.5">
                            {temporarilyDeadAllies.map(hero => (
                                <button
                                    key={hero.id}
                                    onClick={() => selectSkillHeroTarget(hero.id)}
                                    className={`px-2 py-1 text-xs rounded border font-body ${
                                        skillSelectedHeroIds?.[selectedHero.id] === hero.id
                                            ? 'border-jade bg-jade/10 text-jade'
                                            : 'border-ink/15 text-ink-light hover:bg-ink/5'
                                    }`}
                                >
                                    {hero.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 结束行动 */}
                <button
                    onClick={() => endHeroAction()}
                    className="skill-btn skill-btn-end py-2.5 font-title tracking-wider text-sm"
                >
                    结束行动
                </button>

                {/* 仅展示玩家可理解的中文资源，隐藏内部技术计数器。 */}
                {visibleCounters.length > 0 && (
                    <div className="pt-2 border-t border-ink/8">
                        <h4 className="text-[10px] font-body text-ink-faint mb-1">状态</h4>
                        <div className="flex flex-wrap gap-1">
                            {visibleCounters.map(([name, value]) => (
                                <span key={name} className="text-[10px] px-1.5 py-0.5 bg-ink/5 text-ink-light rounded font-body">
                                    {name}: {String(value)}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
