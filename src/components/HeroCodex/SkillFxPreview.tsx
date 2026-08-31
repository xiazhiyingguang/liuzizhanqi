/**
 * 图鉴卡内的技能特效预览：技能名旁放一个小图标，鼠标停留片刻后浮出特效舞台。
 *
 * 战斗内的 SkillFxVisual 是纯 props 驱动的（只有 SkillFxLifecycle 读 store），
 * 这里按 core/skill-fx-preview 的固定演示格位造事件复用它，
 * 让图鉴与战斗永远画同一个特效，不必另写一套动画。
 *
 * 悬停延时 / 关闭宽限 / portal 定位沿用 BattleGlossaryTerm 与 HeroStatusPopover 的做法。
 *
 * 渲染期不读 window：组件要能在 node 环境下 renderToStaticMarkup，
 * 因此减弱动态偏好与标签页隐藏都在 useEffect 里落到 state。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
    PREVIEW_GRID_COLS,
    PREVIEW_GRID_ROWS,
    buildPreviewFxEvent,
    previewCellVariants,
} from '../../core/skill-fx-preview';
import { SKILL_FX_KIND_LABELS, resolveSkillFx } from '../../core/skill-fx';
import { SkillFxVisual } from '../Game/SkillFxLayer';

/** 一轮特效播完后到下一轮的静默间隔 */
const LOOP_GAP_MS = 500;
/** 鼠标需停留多久才浮出预览：避开只是路过图标的误触 */
const HOVER_DWELL_MS = 600;
/** 指针移出后留一点时间让它移进面板 */
const CLOSE_GRACE_MS = 240;

const PANEL_WIDTH = 304;
const PANEL_HEIGHT_BUDGET = 300;
const EDGE_GAP = 12;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const CELLS = Array.from({ length: PREVIEW_GRID_ROWS * PREVIEW_GRID_COLS }, (_, index) => [
    Math.floor(index / PREVIEW_GRID_COLS),
    index % PREVIEW_GRID_COLS,
] as const);

/** 特效舞台本体：演示棋盘 + 档案行 + 重播（图鉴卡内不直接展示，只在浮层里出现） */
export function SkillFxStage({ skillId, accent }: { skillId: string; accent: string }) {
    const profile = resolveSkillFx(skillId);
    const event = useMemo(() => buildPreviewFxEvent(profile), [profile]);
    const [cycle, setCycle] = useState(0);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [tabHidden, setTabHidden] = useState(false);

    useEffect(() => {
        const query = window.matchMedia(REDUCED_MOTION_QUERY);
        setReducedMotion(query.matches);
        const onChange = (change: MediaQueryListEvent) => setReducedMotion(change.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    // 循环用的是普通 setTimeout，不像 rAF 会被浏览器节流，标签页隐藏时要停下来
    useEffect(() => {
        const onVisibilityChange = () => setTabHidden(document.hidden);
        setTabHidden(document.hidden);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    useEffect(() => {
        if (reducedMotion || tabHidden) return;
        const timer = window.setTimeout(
            () => setCycle(current => current + 1),
            profile.durationMs + LOOP_GAP_MS
        );
        return () => window.clearTimeout(timer);
    }, [cycle, profile, reducedMotion, tabHidden]);

    const isSelfCast = event.fromPos[0] === event.targetPos[0] && event.fromPos[1] === event.targetPos[1];

    return (
        <div className="skill-fx-stage" style={{ '--codex-fx-accent': accent } as CSSProperties}>
            {reducedMotion ? (
                <p className="skill-fx-stage-note">系统已开启减弱动态效果，特效预览暂停播放。</p>
            ) : (
                <div className="skill-fx-stage-grid" aria-hidden="true">
                    {CELLS.map(([row, col]) => {
                        const showCaster = event.fromPos[0] === row && event.fromPos[1] === col;
                        const showTarget = !isSelfCast && event.targetPos[0] === row && event.targetPos[1] === col;
                        return (
                            <div key={`${row}-${col}`} className="skill-fx-stage-cell">
                                {showCaster && (
                                    <span className="skill-fx-stage-piece">
                                        {isSelfCast ? '身' : '施'}
                                    </span>
                                )}
                                {showTarget && <span className="skill-fx-stage-piece">的</span>}
                                {previewCellVariants(event, row, col).map(variant => (
                                    <SkillFxVisual
                                        key={`${cycle}-${variant}`}
                                        event={event}
                                        variant={variant}
                                        atPos={[row, col]}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="skill-fx-stage-meta">
                <span className="skill-fx-stage-kind">{SKILL_FX_KIND_LABELS[profile.kind]}</span>
                <span className="skill-fx-stage-duration">{profile.durationMs}ms</span>
                {profile.c1 && (
                    <i className="skill-fx-stage-swatch" style={{ backgroundColor: profile.c1 }} />
                )}
                {profile.c2 && (
                    <i className="skill-fx-stage-swatch" style={{ backgroundColor: profile.c2 }} />
                )}
                {profile.kind === 'ink' ? (
                    <span className="skill-fx-stage-missing">未定制 · 通用兜底</span>
                ) : (
                    <code className="skill-fx-stage-code">{profile.kind}</code>
                )}
                {!reducedMotion && (
                    <button
                        type="button"
                        data-sfx="tab"
                        onClick={() => setCycle(current => current + 1)}
                        className="skill-fx-stage-replay"
                    >
                        重播
                    </button>
                )}
            </div>
        </div>
    );
}

/** 星芒图标：表示"这一栏有技能特效可看" */
function SparkIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
            <path d="M18.5 3.5v3M20 5h-3" />
        </svg>
    );
}

export default function SkillFxPreview({
    skillId,
    skillName,
    accent,
}: {
    skillId: string;
    skillName: string;
    accent: string;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const panelId = `skill-fx-peek-${useId().replace(/:/g, '')}`;
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0, above: false });

    const clearTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const updatePosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        // 默认向下展开；下方空间不够时翻到上方
        const belowRoom = window.innerHeight - rect.bottom;
        const above = belowRoom < PANEL_HEIGHT_BUDGET && rect.top > belowRoom;
        setPosition({
            left: Math.max(EDGE_GAP, Math.min(
                rect.left + rect.width / 2 - PANEL_WIDTH / 2,
                window.innerWidth - PANEL_WIDTH - EDGE_GAP
            )),
            top: above ? rect.top - 8 : rect.bottom + 8,
            above,
        });
    }, []);

    const scheduleShow = useCallback(() => {
        clearTimer();
        timerRef.current = setTimeout(() => {
            updatePosition();
            setOpen(true);
        }, HOVER_DWELL_MS);
    }, [clearTimer, updatePosition]);

    const scheduleHide = useCallback(() => {
        clearTimer();
        timerRef.current = setTimeout(() => setOpen(false), CLOSE_GRACE_MS);
    }, [clearTimer]);

    const showNow = useCallback(() => {
        clearTimer();
        updatePosition();
        setOpen(true);
    }, [clearTimer, updatePosition]);

    useEffect(() => () => clearTimer(), [clearTimer]);

    useEffect(() => {
        if (!open) return;
        const onResize = () => updatePosition();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))) return;
            setOpen(false);
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onResize, true);
        window.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onOutsidePointer);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('scroll', onResize, true);
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onOutsidePointer);
        };
    }, [open, updatePosition]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                data-sfx="tab"
                className="skill-fx-peek-trigger"
                style={{ color: accent, borderColor: `${accent}44` }}
                aria-label={`${skillName} 的技能特效`}
                aria-describedby={open ? panelId : undefined}
                onMouseEnter={scheduleShow}
                onMouseLeave={scheduleHide}
                onFocus={showNow}
                onBlur={scheduleHide}
            >
                <SparkIcon />
            </button>

            {open && createPortal(
                <div
                    ref={panelRef}
                    id={panelId}
                    role="tooltip"
                    className="skill-fx-peek-panel"
                    style={{
                        left: position.left,
                        top: position.top,
                        width: PANEL_WIDTH,
                        transform: position.above ? 'translateY(-100%)' : undefined,
                    }}
                    onMouseEnter={clearTimer}
                    onMouseLeave={scheduleHide}
                >
                    <div className="skill-fx-peek-heading">
                        <span className="skill-fx-peek-title">{skillName}</span>
                        <span className="skill-fx-peek-hint">施法格 → 目标格循环演示</span>
                    </div>
                    <SkillFxStage skillId={skillId} accent={accent} />
                </div>,
                document.body
            )}
        </>
    );
}
