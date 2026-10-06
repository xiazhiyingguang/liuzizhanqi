import { useGameStore } from '../../store/game-store';
import { getHeroInfo } from '../../data/heroes';
import { WEAPON_CODEX } from '../../data/weapon-codex';
import InkButton from '../ui/InkButton';
import InkCard from '../ui/InkCard';
import InkDivider from '../ui/InkDivider';
import HeroIcon from '../ui/HeroIcon';
import SetupExitButton from '../GameSetup/SetupExitButton';

/**
 * 武装阶段（仅经典模式）：为已点的六位英雄各自开关"专属武器"。
 * 一器一主，所以这里没有背包与穿戴面板，只有带/不带两个状态；
 * 效果尚未实装的器照常展示，但点不动，免得把空白草案当成已定稿规则打进场。
 */
export default function WeaponSelect() {
    const {
        selectingPlayer,
        player1SelectedHeroIds,
        player2SelectedHeroIds,
        player1WeaponIds,
        player2WeaponIds,
        toggleWeapon,
        confirmWeaponSelection,
        isOnlineMode,
        isAiMode,
        localPlayerNumber,
        player1ReadyWeaponSelect,
        player2ReadyWeaponSelect
    } = useGameStore();

    const localPlayerKey = localPlayerNumber === 1 ? 'player1' : localPlayerNumber === 2 ? 'player2' : null;
    const viewPlayer = isAiMode ? 'player1' : (isOnlineMode && localPlayerKey ? localPlayerKey : selectingPlayer);
    const localReady = viewPlayer === 'player1' ? player1ReadyWeaponSelect : player2ReadyWeaponSelect;
    const opponentReady = viewPlayer === 'player1' ? player2ReadyWeaponSelect : player1ReadyWeaponSelect;
    const canAct = isAiMode ? !player1ReadyWeaponSelect : (isOnlineMode ? !localReady : selectingPlayer === viewPlayer);
    const selectedIds = viewPlayer === 'player1' ? player1SelectedHeroIds : player2SelectedHeroIds;
    const weapons = viewPlayer === 'player1' ? player1WeaponIds ?? {} : player2WeaponIds ?? {};

    const equippedCount = selectedIds.filter(id => weapons[id]).length;
    const availableCount = selectedIds.filter(id => WEAPON_CODEX.find(w => w.heroId === id)?.implemented).length;
    const playerLabel = isAiMode ? '你' : (viewPlayer === 'player1' ? '玩家一' : '玩家二');

    return (
        <div className="weapon-select-page w-full h-full flex flex-col items-center justify-start px-6 py-8 relative overflow-y-auto">
            <SetupExitButton stage="武装" />
            <span className="absolute font-title text-[16rem] text-ink/[0.02] select-none pointer-events-none"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                武装
            </span>

            <div className="w-full max-w-5xl relative z-10">
                <div className="text-center mb-6 animate-fade-up">
                    <h2 className="font-title text-4xl text-ink tracking-wider mb-1">
                        {playerLabel} · 武装
                    </h2>
                    <InkDivider variant="cloud" className="max-w-[180px] mx-auto mb-2" />
                    <p className="text-ink-light text-sm font-body">
                        经典模式 · 已武装 <span className="font-bold text-indigo-ink">{equippedCount}</span> / {availableCount} 口可用专属器
                    </p>
                    <p className="text-ink-faint text-xs font-body mt-1">
                        一器一主：每位英雄只能带自己那口，未实装效果的器不可启用
                    </p>
                    {isOnlineMode && localReady && !opponentReady && (
                        <p className="text-gold text-sm font-body mt-1 animate-pulse">
                            等待对手确认武装中...
                        </p>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {selectedIds.map((heroId, index) => {
                        const info = getHeroInfo(heroId);
                        const weapon = WEAPON_CODEX.find(item => item.heroId === heroId);
                        const equipped = !!weapons[heroId];
                        const lockable = !weapon?.implemented;
                        return (
                            <InkCard
                                key={heroId}
                                variant={equipped ? 'selected' : 'default'}
                                className="animate-fade-up"
                                style={{ animationDelay: `${index * 60}ms` }}
                            >
                                <div data-testid={`weapon-card-${heroId}`} className="flex flex-col gap-2 p-4">
                                    <div className="flex items-center gap-3">
                                        <HeroIcon heroId={heroId} size={40} className="shrink-0 text-ink-light" />
                                        <div className="min-w-0">
                                            <div className="font-title text-lg text-ink truncate">{info?.name ?? heroId}</div>
                                            <div className="text-xs text-ink-light font-body truncate">
                                                {weapon?.name ?? '未名之器'} · {weapon?.system ?? info?.class ?? ''}
                                            </div>
                                        </div>
                                        {equipped && (
                                            <span className="ml-auto ink-seal-sm shrink-0" data-testid={`weapon-seal-${heroId}`}>带</span>
                                        )}
                                    </div>

                                    <ul className="text-xs text-ink-light font-body leading-relaxed list-disc pl-4 min-h-[2.5rem]">
                                        {(weapon?.effects.length ? weapon.effects : ['效果待定 · 设定案尚未给出条目']).map(effect => (
                                            <li key={effect}>{effect}</li>
                                        ))}
                                    </ul>

                                    <InkButton
                                        data-testid={`weapon-toggle-${heroId}`}
                                        variant={equipped ? 'secondary' : 'primary'}
                                        size="sm"
                                        disabled={!canAct || lockable}
                                        onClick={() => toggleWeapon(heroId)}
                                    >
                                        {lockable ? '未实装' : equipped ? '卸下' : '启用'}
                                    </InkButton>
                                </div>
                            </InkCard>
                        );
                    })}
                </div>

                <div className="setup-confirm flex justify-center mt-8">
                    <span className="mobile-only setup-selected-summary">已武装 {equippedCount}/{availableCount}</span>
                    <InkButton
                        data-testid="confirm-weapon-selection"
                        variant="primary"
                        size="lg"
                        disabled={!canAct}
                        sfx="primary"
                        onClick={confirmWeaponSelection}
                    >
                        确认武装 · 进入布阵
                    </InkButton>
                </div>
            </div>
        </div>
    );
}
