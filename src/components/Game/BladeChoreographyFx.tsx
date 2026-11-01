import { useEffect, useId, useRef, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import { bladePoint, bladeSceneEnd } from '../../core/blade-choreography';
import { isLowQuality } from '../../core/render-quality';
import HeroAvatar from '../ui/HeroAvatar';
import { useGameStore } from '../../store/game-store';
import '../../styles/blade-choreography.css';

/** 刃口留白、古金护手、墨色中脊；共享地面剑与飞行剑的真实轮廓。 */
function XuanyuanSwordArt() {
    return <g>
        <path d="M0-40 6-25 4 15 0 23-4 15-6-25Z" fill="#c9c9b4" stroke="#73674c" strokeWidth="1.3" />
        <path d="M0-39 0 20-3 14-4-24Z" fill="#f9f3da" />
        <path d="M0-32 0 15" stroke="#95845d" strokeWidth=".9" />
        <path d="M-10 18-6 15 0 18 6 15 10 18 5 23 0 21-5 23Z" fill="#b89a53" stroke="#665435" />
        <path d="M-2 22 2 22 2 33-2 33Z" fill="#4e4b42" />
        <path d="M-3 34 0 39 3 34Z" fill="#b89a53" />
    </g>;
}

export function XuanyuanSwordGlyph() {
    return <svg viewBox="-12 -42 24 84" className="bc-sword-glyph" aria-hidden="true"><XuanyuanSwordArt /></svg>;
}

export function AttachedSwordGuard({ count }: { count: number }) {
    if (count <= 0) return null;
    return <span className="bc-attached-guard" data-attached-swords={count} aria-hidden="true">
        {Array.from({ length: Math.min(count, 4) }, (_, i) => <i key={i} style={{ '--guard-angle': `${i * 90 + 45}deg` } as CSSProperties}><XuanyuanSwordGlyph /></i>)}
        <b>御剑 {count}</b>
    </span>;
}

function Warrant({ label = '悬赏', reward }: { label?: string; reward?: number }) {
    return <g className={`bc-warrant${reward === undefined ? ' bc-hunt-order' : ''}`}>
        <path d="M-14-25 13-23 15 17 9 25 2 22-5 26-13 21Z" fill="#e9d7ae" stroke="#76603b" strokeWidth="1.2" />
        <path d="M-10-20 10-19 11 17-9 19Z" fill="none" stroke="#b49a68" strokeWidth=".7" />
        <path d="M-11-24 12-22" stroke="#554a3c" strokeWidth="2" />
        <text x="0" y="-3" textAnchor="middle" className="bc-warrant-ink">{label === '猎杀令' ? '猎' : '赏'}</text>
        <path d="M-5 7 4 7 5 16-4 16Z M-2 9 2 9 2 13-2 13Z" fill="none" stroke="#a84d37" strokeWidth="1.3" />
        {reward !== undefined && <text x="0" y="34" textAnchor="middle" className="bc-small-label">{['天威', '回生', '暴击', '吸血'][reward] ?? '赏'}</text>}
    </g>;
}

function ReturningKnife() {
    return <g className="bc-knife"><path d="M-38 2Q-9-1 31-10L44-8Q22 7-12 8L-27 5-39 8Z" fill="#cdc9bc" stroke="#544740" strokeWidth="1.1" />
        <path d="M-26 5Q8 5 40-8" stroke="#fff3db" strokeWidth="1.6" fill="none" />
        <path d="M-38 2-27 5-28 9-40 11Z" fill="#6e3033" /><path d="M-34 5-34 9M-31 5-31 9" stroke="#bb9670" /></g>;
}

/** 一个事件一张 SVG、一个限帧循环；只挪动预建的轮廓，不每帧重渲染 React。 */
export function BladeChoreographyFx({ event }: { event: SkillFxEvent }) {
    const nodes = useRef<Array<SVGGElement | null>>([]);
    const returns = useRef<Array<SVGGElement | null>>([]);
    const id = useId().replace(/:/g, '');
    const details = event.choreography;
    const liveEvents = useGameStore(state => state.skillFx);
    useEffect(() => {
        if (!details) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, last = -Infinity, stopped = false;
        const draw = (now: number) => {
            if (stopped) return;
            if (now - last < (isLowQuality() ? 33 : 16)) { frame = requestAnimationFrame(draw); return; }
            last = now;
            const elapsed = Date.now() - event.bornAt;
            details.strokes.forEach((stroke, i) => {
                const node = nodes.current[i];
                if (!node) return;
                const p = bladePoint(stroke, reduced.matches ? stroke.arrive : elapsed, details.scene === 'leap', details.scene === 'cuts');
                const after = elapsed - stroke.arrive;
                const superseded = stroke.swordId && liveEvents.some(other => other.id > event.id &&
                    other.choreography?.strokes.some(next => next.swordId === stroke.swordId));
                const show = !reduced.matches && !superseded && elapsed >= (details.scene === 'drift' ? stroke.reveal ?? 0 : stroke.start) && after < 0;
                node.setAttribute('transform', `translate(${p.x} ${p.y})${details.scene === 'leap' || details.scene === 'order' || details.scene === 'reward' ? '' : ` rotate(${p.angle + (details.scene === 'cuts' ? 0 : 90)})`}`);
                node.style.opacity = show ? '1' : '0';
                node.dataset.progress = p.progress.toFixed(3);
                const back = returns.current[i];
                if (back) {
                    const q = bladePoint({ ...stroke, from: stroke.to, to: stroke.from, start: stroke.arrive + 90, arrive: stroke.arrive + 330 }, elapsed);
                    back.setAttribute('transform', `translate(${q.x} ${q.y}) rotate(${q.angle})`);
                    back.style.opacity = !reduced.matches && after >= 90 && after < 330 ? '.46' : '0';
                }
            });
            if (!reduced.matches && elapsed < bladeSceneEnd(details)) frame = requestAnimationFrame(draw);
        };
        const motion = () => { cancelAnimationFrame(frame); last = -Infinity; draw(performance.now()); };
        draw(performance.now()); reduced.addEventListener('change', motion);
        return () => { stopped = true; cancelAnimationFrame(frame); reduced.removeEventListener('change', motion); };
    }, [details, event.bornAt, event.id, liveEvents]);
    if (!details) return null;
    const { scene, strokes } = details;
    const blade = scene === 'cuts';
    const paper = scene === 'order' || scene === 'reward';
    return <span className={`bc-performance bc-${scene}`} data-blade-scene={scene} style={{ '--bc-r': event.fromPos[0], '--bc-c': event.fromPos[1] } as CSSProperties}>
        <svg className="bc-scene" viewBox="0 0 600 600" aria-hidden="true">
            <defs><linearGradient id={`${id}-steel`}><stop stopColor="#514744" /><stop offset=".55" stopColor="#a3403c" /><stop offset="1" stopColor="#f7e5cb" /></linearGradient></defs>
            {strokes.map((stroke, i) => {
                const x = (stroke.to[1] + .5) * 100, y = (stroke.to[0] + .5) * 100;
                const sx = (stroke.from[1] + .5) * 100, sy = (stroke.from[0] + .5) * 100;
                const dx = x - sx, dy = y - sy, length = Math.hypot(dx, dy) || 1;
                const path = `M${sx} ${sy} Q${(sx + x) / 2 - dy / length * 14} ${(sy + y) / 2 + dx / length * 14} ${x} ${y}`;
                const style = { '--bc-start': `${stroke.start}ms`, '--bc-flight': `${stroke.arrive - stroke.start}ms`, '--bc-arrive': `${stroke.arrive}ms` } as CSSProperties;
                return <g key={i} style={style} data-blade-route={`${stroke.from.join(',')}>${stroke.to.join(',')}`} data-blade-arrive={stroke.arrive}>
                    <path className="bc-route-shadow" d={path} pathLength="100" />
                    <path className="bc-route-edge" d={path} pathLength="100" />
                    <g ref={el => { nodes.current[i] = el; }} className="bc-traveller" style={{ opacity: 0 }}>
                        {paper ? <Warrant label={stroke.label} reward={stroke.reward} /> : blade ? <ReturningKnife /> : scene === 'leap' ? <>
                            <g transform="translate(0 22) rotate(72)"><svg x="-13" y="-49" width="26" height="98" viewBox="-12 -42 24 84"><XuanyuanSwordArt /></svg></g>
                            <foreignObject x="-25" y="-43" width="50" height="50"><div className="bc-travel-avatar"><HeroAvatar heroId={event.sourceHeroId ?? 'xuanyuan'} size={50} eager /></div></foreignObject>
                        </> : <svg x="-10" y="-36" width="20" height="72" viewBox="-12 -42 24 84"><XuanyuanSwordArt /></svg>}
                    </g>
                    {blade && <g ref={el => { returns.current[i] = el; }} style={{ opacity: 0 }} data-blade-return="cosmetic"><ReturningKnife /></g>}
                    <g transform={`translate(${x} ${y})`} className="bc-arrival">
                        {paper ? <><g transform="translate(25 -10) scale(.72)"><Warrant label={stroke.label} reward={stroke.reward} /></g>{scene === 'reward' && <text y="-36" textAnchor="middle" className="bc-received">赏金归主</text>}</> : blade ? ((stroke.logIds?.length ?? 0) > 0 && <g transform={`rotate(${i % 2 ? -35 : 30})`}>
                            <path d="M-46 12Q-10-2 40-18L48-17Q10 5-37 16Z" fill={`url(#${id}-steel)`} />
                            <path d="M-39 12 43-17" stroke="#fff0da" strokeWidth="1.4" />
                            <path d="M-18 17-28 23M10-17 17-25" stroke="#813e38" strokeWidth="1" />
                        </g>) : <>
                            <ellipse cy="24" rx="29" ry="8" className="bc-landing-ink" />
                            <path d={scene === 'attach' || scene === 'recall' ? 'M-25-13Q0-33 25-13L20 16Q0 35-20 16Z' : 'M-27 25-9 22-4 27 14 22 28 25'} className="bc-landing-edge" />
                            {stroke.count && stroke.count > 1 ? <text y="-30" textAnchor="middle" className="bc-small-label">御剑 ×{stroke.count}</text> : null}
                        </>}
                    </g>
                </g>;
            })}
            {scene === 'leap' && (event.damagePositions ?? []).map((pos, i) => <g key={i} className="bc-contact" style={{ '--bc-arrive': '430ms' } as CSSProperties} transform={`translate(${(pos[1] + .5) * 100} ${(pos[0] + .5) * 100})`}><path d="M-25 17 22-19M-12 18 28-13" /></g>)}
        </svg>
    </span>;
}
