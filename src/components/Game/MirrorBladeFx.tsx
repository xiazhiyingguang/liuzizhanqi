import { memo, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { mirrorBladeMotion } from '../../core/mirror-blade-fx';
import { computeFxAngleDeg, computeMirrorBladeTiming, type Position, type SkillFxEvent } from '../../core/skill-fx';
import '../../styles/mirror-blade-fx.css';

function strikes(event: SkillFxEvent) {
    return event.mirrorBlades ?? [{ fromPos: event.fromPos, targetPos: event.targetPos, logIds: [] }];
}

/** 小尺寸棱镜纹理仅绘制一次，飞行只改变合成层 transform/opacity。 */
export const MirrorBladeLaunchFx = memo(function MirrorBladeLaunchFx({ event }: { event: SkillFxEvent }) {
    const rootRef = useRef<HTMLSpanElement>(null);
    const projectiles = useMemo(() => strikes(event).map((blade, index) => {
        const { launchMs, travelMs } = computeMirrorBladeTiming(blade, index);
        return { launchMs, travelMs, motion: mirrorBladeMotion(blade, event.fromPos, index) };
    }), [event]);
    useEffect(() => {
        const root = rootRef.current;
        const ruler = root?.querySelector<HTMLElement>('.fx-mirror-pitch');
        if (!root || !ruler || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const blades = [...root.querySelectorAll<HTMLElement>('.fx-mirror-projectile')];
        let animations: Animation[] = [];
        let lastPitch = -1;
        const update = () => {
            const pitch = ruler.getBoundingClientRect().width;
            if (pitch === lastPitch || pitch <= 0) return;
            lastPitch = pitch;
            animations.forEach(animation => animation.cancel());
            const elapsed = event.bornAt > 0 ? Math.max(0, Date.now() - event.bornAt) : 0;
            const startTime = Number(document.timeline.currentTime ?? 0) - elapsed;
            animations = blades.map((blade, index) => {
                const projectile = projectiles[index];
                // 使用已解析的 px 关键帧，避免 clamp/CSS 变量让浏览器每帧重算样式。
                const frames = projectile.motion.map((point, step) => ({
                    offset: step / 8, opacity: step === 0 || step === 8 ? 0 : 1,
                    transform: `translate3d(${point.x * pitch}px, ${point.y * pitch}px, 0) rotate(${point.angle}deg)`,
                }));
                const animation = blade.animate(frames, { duration: projectile.travelMs, delay: projectile.launchMs, easing: 'linear', fill: 'both' });
                animation.startTime = startTime;
                return animation;
            });
        };
        update();
        // 每批一个观察器，只有棋盘缩放才重算路径，不向 React 发逐帧状态更新。
        const observer = new ResizeObserver(update);
        observer.observe(ruler);
        return () => { observer.disconnect(); animations.forEach(animation => animation.cancel()); };
    }, [event, projectiles]);
    return (
        <span ref={rootRef} className="fx-anchor fx-mirror-launch">
            <i className="fx-mirror-pitch" />
            <i className="fx-mirror-summon" />
            {projectiles.map((_, index) => (
                <span key={index} className="fx-mirror-projectile" data-blade-index={index}>
                    <i className="fx-mirror-tail" />
                    <i className="fx-mirror-prism" />
                </span>
            ))}
        </span>
    );
});

type ImpactProps = { event: SkillFxEvent; atPos?: Position };
export const MirrorBladeImpactFx = memo(function MirrorBladeImpactFx({ event, atPos = event.targetPos }: ImpactProps) {
    let first = true;
    return <>{strikes(event).map((blade, index) => {
        if (blade.targetPos[0] !== atPos[0] || blade.targetPos[1] !== atPos[1]) return null;
        const { impactMs } = computeMirrorBladeTiming(blade, index);
        const showRing = first;
        first = false;
        return (
            <span key={index} className="fx-anchor fx-mirror-impact" style={{
                '--mb-hit': `${impactMs}ms`, '--mb-angle': `${computeFxAngleDeg(blade.fromPos, blade.targetPos)}deg`,
            } as CSSProperties} data-blade-impact={index}>
                <i className="fx-mirror-cut" />
                {showRing && <i className="fx-mirror-hit-ring" />}
                {Array.from({ length: 2 }, (_, shard) => <i key={shard} className="fx-mirror-shard" style={{ '--mb-shard-angle': `${shard * 137 + index * 19}deg` } as CSSProperties} />)}
            </span>
        );
    })}</>;
}, (previous, next) => previous.event === next.event
    && previous.atPos?.[0] === next.atPos?.[0] && previous.atPos?.[1] === next.atPos?.[1]);
