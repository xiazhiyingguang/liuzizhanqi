import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Effect, Hero } from '../../types/game';
import { HeroState } from '../../types/game';
import {
    effectDurationLabel,
    effectTypeLabel,
    formatPercent,
    mergeDuplicateEffects,
    visibleCounterEntries
} from '../../core/hero-status-presentation';
import { DamageCalculator } from '../../core/damage-calculator';
import HeroAvatar from '../ui/HeroAvatar';

type Placement = 'right' | 'auto-vertical';

interface HeroStatusPopoverProps {
    hero: Hero;
    children: ReactNode;
    delayMs?: number;
    placement?: Placement;
    className?: string;
}

interface PopoverPosition {
    left: number;
    top: number;
    above: boolean;
}

const POPOVER_WIDTH = 320;
/** 卡片高度预算（含内边距），用于把卡片钳制在视口内 */
const POPOVER_HEIGHT_BUDGET = 420;
const EDGE_GAP = 12;
const CLOSE_GRACE_MS = 260;
const LONG_PRESS_MS = 560;

const EFFECT_BADGE_CLASS: Record<Effect['type'], string> = {
    buff: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    debuff: 'border-red-200 bg-red-100 text-red-700',
    stun: 'border-orange-200 bg-orange-100 text-orange-700',
    control: 'border-purple-200 bg-purple-100 text-purple-700',
    shield: 'border-sky-200 bg-sky-100 text-sky-700',
    mark: 'border-amber-200 bg-amber-100 text-amber-700'
};

export default function HeroStatusPopover({
    hero,
    children,
    delayMs = 120,
    placement = 'right',
    className = ''
}: HeroStatusPopoverProps) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const lastTouchStartedAtRef = useRef(0);
    const instanceId = useId();
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<PopoverPosition>({ left: 0, top: 0, above: false });
    const popoverId = `hero-status-${instanceId.replace(/:/g, '')}`;

    // 展示数据：效果按「名称+类型+来源」合并去重，计数器只保留玩家向中文键
    const displayEffects = mergeDuplicateEffects(hero.effects);
    const counterEntries = visibleCounterEntries(hero);

    const clearTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const updatePosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (placement === 'right') {
            setPosition({
                left: Math.min(rect.right + 10, window.innerWidth - POPOVER_WIDTH - EDGE_GAP),
                top: Math.max(EDGE_GAP, Math.min(rect.top, window.innerHeight - POPOVER_HEIGHT_BUDGET)),
                above: false
            });
            return;
        }

        const above = rect.top >= POPOVER_HEIGHT_BUDGET * 0.6;
        setPosition({
            left: Math.max(
                EDGE_GAP,
                Math.min(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, window.innerWidth - POPOVER_WIDTH - EDGE_GAP)
            ),
            top: above ? rect.top - 10 : rect.bottom + 10,
            above
        });
    }, [placement]);

    const show = (immediate = false) => {
        clearTimer();
        timerRef.current = setTimeout(() => {
            updatePosition();
            setOpen(true);
        }, immediate ? 0 : delayMs);
    };

    const hide = useCallback(() => {
        clearTimer();
        setOpen(false);
    }, [clearTimer]);

    const scheduleHide = useCallback(() => {
        clearTimer();
        timerRef.current = setTimeout(() => setOpen(false), CLOSE_GRACE_MS);
    }, [clearTimer]);

    const startLongPress = () => {
        lastTouchStartedAtRef.current = Date.now();
        clearTimer();
        longPressTriggeredRef.current = false;
        timerRef.current = setTimeout(() => {
            updatePosition();
            longPressTriggeredRef.current = true;
            setOpen(true);
        }, LONG_PRESS_MS);
    };

    const finishLongPress = () => {
        clearTimer();
    };

    useEffect(() => {
        if (!open) return;
        const reposition = () => updatePosition();
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
            hide();
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
            document.removeEventListener('pointerdown', closeOnOutsidePointer);
        };
    }, [hide, open, updatePosition]);

    useEffect(() => () => clearTimer(), [clearTimer]);

    // 展示口径：暴击率与战斗判定同源；暴伤为基础1.5倍之外的额外加成百分比
    const critRate = DamageCalculator.getDisplayedCritRate(hero);
    const critDamageBonus = Math.round((DamageCalculator.getDisplayedCritDamage(hero) - 1) * 100);
    const hpRatio = hero.maxHp > 0 ? Math.max(0, hero.currentHp / hero.maxHp) : 0;
    const hpBarClass = hpRatio > 0.6 ? 'hp-high' : hpRatio > 0.3 ? 'hp-mid' : 'hp-low';
    const isP1 = hero.owner === 'player1';
    const isDead = hero.state === HeroState.DEAD;
    const isTempDead = hero.state === HeroState.TEMP_DEAD;

    const statCells: Array<{ label: string; value: string }> = [
        ...(hero.baseAttack !== undefined ? [{ label: '攻击', value: String(hero.baseAttack) }] : []),
        { label: '防御', value: formatPercent(hero.defense) },
        { label: '移动', value: `${hero.moveRange} 格` },
        { label: '暴击率', value: formatPercent(critRate) },
        { label: '暴伤', value: `+${critDamageBonus}%` },
        { label: '击杀', value: String(hero.killCount) }
    ];

    return (
        <>
            <div
                ref={triggerRef}
                className={className}
                tabIndex={0}
                aria-label={`${hero.name}，悬停或聚焦查看英雄详情`}
                aria-describedby={open ? popoverId : undefined}
                onMouseEnter={() => show(false)}
                onMouseLeave={scheduleHide}
                onFocus={() => {
                    if (Date.now() - lastTouchStartedAtRef.current < 1000) return;
                    show(true);
                }}
                onBlur={scheduleHide}
                onTouchStart={startLongPress}
                onTouchMove={finishLongPress}
                onTouchEnd={finishLongPress}
                onTouchCancel={finishLongPress}
                onClickCapture={event => {
                    if (!longPressTriggeredRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    longPressTriggeredRef.current = false;
                }}
            >
                {children}
            </div>

            {open && createPortal(
                <div
                    ref={popoverRef}
                    id={popoverId}
                    role="tooltip"
                    className="pointer-events-auto fixed z-[100] w-80 max-h-[460px] overflow-y-auto overscroll-contain rounded-xl border border-gold/25
                        bg-[#f7f0df]/95 p-3.5 text-left shadow-[0_14px_42px_rgba(36,29,18,0.22)] backdrop-blur-md animate-fade-in"
                    onMouseEnter={clearTimer}
                    onMouseLeave={scheduleHide}
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: position.above ? 'translateY(-100%)' : undefined
                    }}
                >
                    {/* 头部：头像 + 名字 + 阵营 / 存活状态 */}
                    <div className="mb-2.5 flex items-center gap-2.5 border-b border-gold/15 pb-2.5">
                        <div className={`h-10 w-10 flex-shrink-0 rounded-lg border p-[2px]
                            ${isP1 ? 'border-indigo-ink/25 bg-indigo-ink/10' : 'border-vermillion/25 bg-vermillion/10'}`}>
                            <HeroAvatar
                                heroId={hero.id}
                                heroName={hero.name}
                                size={40}
                                className="h-full w-full rounded-md object-cover"
                                fallbackClassName={isP1 ? 'text-indigo-ink' : 'text-vermillion'}
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <span className="truncate font-title text-sm font-semibold text-ink">{hero.name}</span>
                                <span className={`flex-shrink-0 rounded-full border px-1.5 py-px text-[9px] leading-none font-body
                                    ${isP1 ? 'border-indigo-ink/30 bg-indigo-ink/10 text-indigo-ink' : 'border-vermillion/30 bg-vermillion/10 text-vermillion'}`}>
                                    {isP1 ? '蓝方' : '红方'}
                                </span>
                                {isDead && <span className="ink-seal-sm flex-shrink-0 text-[9px]">殁</span>}
                                {isTempDead && (
                                    <span className="flex-shrink-0 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-px text-[9px] leading-none text-gold-dark">
                                        暂离
                                    </span>
                                )}
                            </div>
                            {/* 生命条 + 护盾 */}
                            <div className="mt-1.5 flex items-center gap-2">
                                <div className="hp-bar-lg min-w-0 flex-1">
                                    <div className={`hp-bar-fill ${hpBarClass}`} style={{ width: `${hpRatio * 100}%` }} />
                                </div>
                                <span className="flex-shrink-0 text-[10px] tabular-nums text-ink-light font-body">
                                    {Math.max(0, hero.currentHp)}/{hero.maxHp}
                                </span>
                                {hero.shield > 0 && (
                                    <span className="flex-shrink-0 rounded-full border border-sky-200 bg-sky-100 px-1.5 py-px text-[9px] leading-none text-sky-700 font-body">
                                        盾 {hero.shield}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 属性网格 */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {statCells.map(stat => (
                            <div key={stat.label} className="rounded-lg border border-ink/[0.06] bg-white/45 px-2 py-1.5 text-center">
                                <div className="text-[9px] leading-tight text-ink-faint font-body">{stat.label}</div>
                                <div className="mt-0.5 text-xs font-semibold tabular-nums text-ink font-body">{stat.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* 玩家向计数器（猎砂/天禄/破锋/财气等） */}
                    {counterEntries.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1">
                            {counterEntries.map(counter => (
                                <span
                                    key={counter.label}
                                    className="rounded-full border border-gold/35 bg-gold/10 px-2 py-0.5 text-[10px] leading-none text-gold-dark font-body"
                                >
                                    {counter.label} ×{counter.value}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* 状态效果列表（已合并去重） */}
                    {displayEffects.length > 0 ? (
                        <div className="mt-2.5 space-y-1.5">
                            {displayEffects.map(effect => (
                                <div key={effect.id} className="rounded-lg border border-ink/[0.07] bg-white/35 px-2.5 py-2">
                                    <div className="flex items-start gap-2">
                                        <span
                                            className={`mt-px flex-shrink-0 rounded border px-1.5 py-px text-[9px] leading-none font-body ${EFFECT_BADGE_CLASS[effect.type]}`}
                                        >
                                            {effectTypeLabel(effect)}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="font-body text-xs font-semibold text-ink">
                                                    {effect.name}
                                                    {(effect.stackCount ?? 1) > 1 ? ` ×${effect.stackCount}` : ''}
                                                </span>
                                                <span className="flex-shrink-0 text-[9px] text-gold-dark font-body">
                                                    {effectDurationLabel(effect)}
                                                </span>
                                            </div>
                                            {effect.description && (
                                                <p className="mt-1 text-[10px] leading-4 text-ink-light font-body">
                                                    {effect.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-2.5 rounded-lg border border-dashed border-ink/10 bg-white/25 px-2.5 py-2 text-center text-[10px] text-ink-faint font-body">
                            当前无状态效果
                        </p>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
