import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Effect, Hero } from '../../types/game';
import { effectDurationLabel } from '../../core/hero-status-presentation';

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

const POPOVER_WIDTH = 288;
const EDGE_GAP = 12;
const CLOSE_GRACE_MS = 260;
const LONG_PRESS_MS = 560;

function effectTypeLabel(effect: Effect): string {
    switch (effect.type) {
        case 'buff': return '增益';
        case 'debuff': return '减益';
        case 'stun': return '眩晕';
        case 'control': return '控制';
        case 'shield': return '护盾';
        default: return '标记';
    }
}

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
    const statusCount = hero.effects.length;
    const popoverId = `hero-status-${instanceId.replace(/:/g, '')}`;

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
                top: Math.max(EDGE_GAP, Math.min(rect.top, window.innerHeight - 300)),
                above: false
            });
            return;
        }

        const above = rect.top >= 230;
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
        if (statusCount === 0) return;
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
        if (statusCount === 0) return;
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

    useEffect(() => {
        if (statusCount === 0) hide();
    }, [statusCount, hide]);

    return (
        <>
            <div
                ref={triggerRef}
                className={className}
                tabIndex={statusCount > 0 ? 0 : -1}
                aria-label={`${hero.name}，当前${statusCount}个状态${statusCount > 0 ? '，悬停或聚焦查看详情' : ''}`}
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

            {open && statusCount > 0 && createPortal(
                <div
                    ref={popoverRef}
                    id={popoverId}
                    role="tooltip"
                    className="pointer-events-auto fixed z-[100] w-72 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-gold/25
                        bg-[#f7f0df]/95 p-3.5 text-left shadow-[0_14px_42px_rgba(36,29,18,0.22)] backdrop-blur-md animate-fade-in"
                    onMouseEnter={clearTimer}
                    onMouseLeave={scheduleHide}
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: position.above ? 'translateY(-100%)' : undefined
                    }}
                >
                    <div className="mb-2.5 flex items-center justify-between border-b border-gold/15 pb-2">
                        <span className="font-title text-sm text-ink">{hero.name}</span>
                        <span className="text-[10px] font-body text-gold-dark">{statusCount} 个状态</span>
                    </div>
                    <div className="space-y-2">
                        {hero.effects.map(effect => (
                            <div key={effect.id} className="rounded-lg border border-ink/[0.07] bg-white/35 px-3 py-2">
                                <div className="flex items-start gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gold-dark" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-body text-xs font-semibold text-ink">
                                                {effect.name}
                                                {(effect.stackCount ?? 1) > 1 ? ` ×${effect.stackCount}` : ''}
                                            </span>
                                            <span className="flex-shrink-0 text-[9px] text-gold-dark font-body">
                                                {effectTypeLabel(effect)} · {effectDurationLabel(effect)}
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
                </div>,
                document.body
            )}
        </>
    );
}
