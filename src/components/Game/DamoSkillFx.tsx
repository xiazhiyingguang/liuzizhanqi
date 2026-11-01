import type { CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';

/** 达摩的拳：四指并拢、拇指扣在侧面的简笔拳面 */
function FistGlyph() {
    return (
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 13.4 Q7 10.4 10.4 10.4 L22.2 10.4 Q25.4 10.4 25.4 13.4 L25.4 21.6 Q25.4 25.4 21.6 25.4 L11 25.4 Q7 25.4 7 21.4 Z" />
            <path d="M12 10.4 L12 16.2 M16 10.4 L16 16.2 M20 10.4 L20 16.2" strokeWidth="1.1" opacity="0.65" />
            <path d="M7 17.6 Q4.4 18.2 4.4 20.4 Q4.4 22.4 7 22.4" strokeWidth="1.2" opacity="0.8" />
        </svg>
    );
}

function vars(event: SkillFxEvent): CSSProperties {
    return {
        ['--fx-rot' as string]: `${event.angleDeg}deg`,
        ['--fx-duration' as string]: `${event.profile.durationMs}ms`,
        ['--fx-c1' as string]: event.profile.c1 ?? '#b08d57',
        ['--fx-c2' as string]: event.profile.c2 ?? '#f7ead0',
    };
}

/** 一苇渡江起手：肩背压低，沿冲撞方向拖一条短促的暗金残影 */
export function DamoChargeCasterFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor damo-charge-caster" style={vars(event)}>
            <i className="fxp-trail damo-charge-trail" />
            <i className="damo-charge-shoulder" />
        </span>
    );
}

/** 一苇渡江落点：拳面砸进目标格；撞山时额外炸开一圈山壁裂纹 */
export function DamoChargeImpactFx({ event }: { event: SkillFxEvent }) {
    const hitMountain = event.damo?.hitMountain === true;
    return (
        <span className={`fx-anchor damo-charge-impact${hitMountain ? ' is-mountain' : ''}`} style={vars(event)}>
            <i className="fxp-hitflash" />
            <span className="damo-fist"><FistGlyph /></span>
            <i className="fxp-ring" />
            {hitMountain && <i className="damo-mountain-crack" />}
        </span>
    );
}

/** 易筋四拳起手：四枚拳影绕身依次亮起 */
export function DamoFlurryCasterFx({ event }: { event: SkillFxEvent }) {
    const punches = Math.max(1, Math.min(4, event.damo?.punches ?? 4));
    return (
        <span className="fx-anchor damo-flurry-caster" style={vars(event)}>
            <i className="damo-flurry-ring" />
            {Array.from({ length: punches }).map((_, index) => (
                <i key={index} className={`damo-fist-orbit damo-fist-orbit-${index + 1}`}>
                    <FistGlyph />
                </i>
            ))}
        </span>
    );
}

/** 易筋四拳落点：一拳一格，拳面压住受击格 */
export function DamoFlurryImpactFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor damo-flurry-impact" style={vars(event)}>
            <i className="fxp-hitflash" />
            <span className="damo-fist"><FistGlyph /></span>
        </span>
    );
}
