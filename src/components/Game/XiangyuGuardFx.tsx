import type { SkillFxEvent } from '../../core/skill-fx';
import '../../styles/xiangyu-guard-fx.css';

/** 两侧甲片让开脸部，兜住下颌而不遮名字和血条。 */
export function XiangyuGuardEmblem() {
    return <svg className="xyg-emblem" viewBox="0 0 100 100" aria-hidden="true">
        <g className="xyg-plate xyg-left"><path d="M12 24 22 31 22 57 32 73 26 80 10 60 7 36Z" />
            <path className="xyg-rivet" d="m13 36 3 2m0 14 3 2m0 10 5 7" /></g>
        <g className="xyg-plate xyg-right"><path d="M88 24 78 31 78 57 68 73 74 80 90 60 93 36Z" />
            <path className="xyg-rivet" d="m87 36-3 2m0 14-3 2m0 10-5 7" /></g>
        <path className="xyg-seal" d="m34 80 16 7 16-7-4 9-12 5-12-5Z" />
    </svg>;
}

export function XiangyuGuardFx({ event }: { event: SkillFxEvent }) {
    const convert = event.profile.stance === 'overlord-convert';
    return <span className={`xyg-stage ${convert ? 'xyg-convert' : 'xyg-awaken'}`} data-guard-source={event.sourceHeroId}>
        <svg className="xyg-action" viewBox="0 0 100 100" aria-hidden="true">
            {convert ? <g className="xyg-absorb">
                <path d="M-13 15Q8 8 22 36L27 61 43 77M113 15Q92 8 78 36L73 61 57 77" />
                <path d="M-7 65Q7 80 30 72L44 82M107 65Q93 80 70 72L56 82" />
            </g> : <g className="xyg-armor-shadow">
                <path d="M8 74-6 43 9 9 28 26 22 46 35 72ZM92 74l14-31L91 9 72 26 78 46 65 72Z" />
                <path d="M21 76 50 86 79 76 65 94 35 94Z" />
            </g>}
        </svg>
        <XiangyuGuardEmblem />
        <span className="xyg-caption">{convert ? '化伤为盾' : '霸王镇守'}</span>
        {event.guardAmount !== undefined && <span className="xyg-gain">盾 +{event.guardAmount}</span>}
    </span>;
}
