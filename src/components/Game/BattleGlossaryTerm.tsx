import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BattleGlossaryEntry } from '../../core/battle-glossary';

interface BattleGlossaryTermProps {
    glossary: BattleGlossaryEntry;
    children: string;
}

interface TooltipPosition {
    left: number;
    top: number;
    above: boolean;
}

const TOOLTIP_WIDTH = 304;
const EDGE_GAP = 12;
const HOVER_DELAY_MS = 800;
const LONG_PRESS_MS = 720;
const CLOSE_GRACE_MS = 260;

export default function BattleGlossaryTerm({ glossary, children }: BattleGlossaryTermProps) {
    const triggerRef = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const lastTouchStartedAtRef = useRef(0);
    const tooltipId = `battle-term-${useId().replace(/:/g, '')}`;
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0, above: true });

    const clearTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const updatePosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const availableWidth = Math.max(0, window.innerWidth - EDGE_GAP * 2);
        const renderedWidth = Math.min(TOOLTIP_WIDTH, availableWidth);
        const above = rect.top >= 180;
        setPosition({
            left: Math.max(
                EDGE_GAP,
                Math.min(
                    rect.left + rect.width / 2 - renderedWidth / 2,
                    window.innerWidth - renderedWidth - EDGE_GAP
                )
            ),
            top: above ? rect.top - 8 : rect.bottom + 8,
            above
        });
    }, []);

    const show = useCallback((delayMs: number) => {
        clearTimer();
        timerRef.current = setTimeout(() => {
            updatePosition();
            setOpen(true);
        }, delayMs);
    }, [clearTimer, updatePosition]);

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
        longPressTriggeredRef.current = false;
        clearTimer();
        timerRef.current = setTimeout(() => {
            updatePosition();
            longPressTriggeredRef.current = true;
            setOpen(true);
        }, LONG_PRESS_MS);
    };

    useEffect(() => {
        if (!open) return;

        const reposition = () => updatePosition();
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target))) return;
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

    return (
        <>
            <span
                ref={triggerRef}
                role="button"
                tabIndex={0}
                aria-label={`${glossary.title}，战斗术语，悬停或长按查看释义`}
                aria-describedby={open ? tooltipId : undefined}
                className="cursor-help whitespace-nowrap touch-manipulation select-none border-b border-dashed border-gold-dark/55 text-gold-dark decoration-clone outline-none
                    transition-colors hover:border-ink/55 hover:text-ink focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-gold/50"
                onMouseEnter={() => show(HOVER_DELAY_MS)}
                onMouseLeave={scheduleHide}
                onFocus={() => {
                    if (Date.now() - lastTouchStartedAtRef.current < 1000) return;
                    show(0);
                }}
                onBlur={scheduleHide}
                onTouchStart={startLongPress}
                onTouchMove={clearTimer}
                onTouchEnd={clearTimer}
                onTouchCancel={clearTimer}
                onContextMenu={event => {
                    if (Date.now() - lastTouchStartedAtRef.current > 1200) return;
                    event.preventDefault();
                }}
                onClickCapture={event => {
                    if (!longPressTriggeredRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    longPressTriggeredRef.current = false;
                }}
            >
                {children}
            </span>

            {open && createPortal(
                <div
                    ref={tooltipRef}
                    id={tooltipId}
                    role="tooltip"
                    className="pointer-events-auto fixed z-[110] w-[304px] max-w-[calc(100vw-24px)] rounded-xl border border-gold/25 bg-[#f7f0df]/95 p-4 text-left
                        shadow-[0_14px_42px_rgba(36,29,18,0.24)] backdrop-blur-md animate-fade-in"
                    onMouseEnter={clearTimer}
                    onMouseLeave={scheduleHide}
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: position.above ? 'translateY(-100%)' : undefined
                    }}
                >
                    <div className="flex items-center justify-between gap-3 border-b border-gold/15 pb-2.5">
                        <span className="font-title text-base text-ink">{glossary.title}</span>
                        <span className="flex-shrink-0 rounded-full border border-gold/20 bg-gold/5 px-2 py-0.5 text-[9px] text-gold-dark font-body">
                            {glossary.category}
                        </span>
                    </div>
                    <p className="mt-2.5 text-xs leading-5 text-ink-light font-body">
                        {glossary.description}
                    </p>
                    <p className="mt-2 text-[9px] text-ink-faint font-body">点击其他位置关闭</p>
                </div>,
                document.body
            )}
        </>
    );
}
