import type { SkillFxEvent } from '../../core/skill-fx';
import { XiangyuGuardFx } from './XiangyuGuardFx';
import '../../styles/tianwei-stance-fx.css';

/** 剑与羽共用常驻物象，中央保持留白；不使用模糊滤镜或逐帧 JS。 */
export function StanceEmblem({ snow }: { snow: boolean }) {
    return <svg className={`ts-emblem ts-emblem-${snow ? 'snow' : 'owl'}`} viewBox="0 0 100 100" aria-hidden="true">
        {snow ? <>
            <path className="ts-steel" d="M80 10 87 18 74 69 69 75 68 66Z" />
            <path className="ts-frost-edge" d="M80 10 74 46 70 66M75 31 81 27M73 43 79 38M71 54 76 50" />
            <path className="ts-hilt" d="m62 69 18 5m-10-1-3 13m-3 1 7 2" />
            <path className="ts-snow-seal" d="M27 83 42 80m4 0 12-2M32 88 45 85" />
        </> : <>
            <path className="ts-owl-shadow" d="M19 71Q5 48 20 20L29 32M81 71Q95 48 80 20L71 32" />
            <path className="ts-owl-edge" d="M19 71Q8 49 20 20L29 32M81 71Q92 49 80 20L71 32M27 82 40 87 50 83 60 87 73 82" />
            <path className="ts-owl-feather" d="m14 48 8 10-3 12-6-14Zm72 0-8 10 3 12 6-14ZM28 77l10 4-3 4-7-4Zm44 0-10 4 3 4 7-4Z" />
        </>}
    </svg>;
}

export function TianweiStanceFx({ event }: { event: SkillFxEvent }) {
    if (event.profile.stance?.startsWith('overlord-')) return <XiangyuGuardFx event={event} />;
    const snow = event.profile.stance === 'snow-break';
    return <span className={`ts-stance ts-${snow ? 'snow-break' : 'ink-stealth'}`} data-stance-source={event.sourceHeroId}>
        <svg className="ts-action" viewBox="0 0 100 100" aria-hidden="true">
            {snow ? <>
                <g className="ts-drawn-sword"><path className="ts-steel" d="M72 2 82 13 42 73 34 78 36 65Z" />
                    <path className="ts-frost-edge" d="M72 2 39 65m19-38 12-5M49 43l12-5M40 58l12-5" />
                    <path className="ts-hilt" d="m25 66 26 15m-14-7-8 14m-4-1 8 5" /></g>
                <path className="ts-snow-wake" d="M-7 70Q40 48 104 20L83 33Q40 49-7 70Z" />
                <path className="ts-snow-cut" d="M-7 70Q42 47 104 20" pathLength="100" />
                <path className="ts-snow-cut ts-snow-cut-b" d="M5 76Q37 59 72 45" pathLength="100" />
                <g className="ts-ice-chips"><path d="m16 56 6-9 2 9-6 4Zm29-10 4-11 4 8-5 5Zm29-14 9-6-3 8-6 2Z" /></g>
            </> : <>
                <g className="ts-ink-fold"><path d="M16 79C-4 52 11 22 27 16 8 41 27 55 31 72L43 86Z" />
                    <path d="M84 79C104 52 89 22 73 16 92 41 73 55 69 72L57 86Z" />
                    <path d="M22 77Q51 59 78 77L65 88 36 88Z" /></g>
                {[0, 1, 2, 3].map(i => <g className={`ts-fold-feather ts-fold-feather-${i}`} key={i}>
                    <path d="M0-17C13-11 13 6 0 18-7 6-8-8 0-17Z" /><path className="ts-feather-vein" d="M0-13 0 18M0-3 7-8M0 4 7-1" /></g>)}
            </>}
        </svg>
        <StanceEmblem snow={snow} />
    </span>;
}
