import { useState } from 'react';
import {
    autoQuality,
    getRenderQualityPreference,
    setRenderQualityPreference,
    type QualityPreference,
} from '../../core/render-quality';

/** 三态轮转顺序：自动 → 流畅（低画质） → 高清 → 自动 */
const CYCLE: QualityPreference[] = [null, 'low', 'full'];

function labelFor(preference: QualityPreference): string {
    if (preference === 'low') return '流畅';
    if (preference === 'full') return '高清';
    return `自动·${autoQuality() === 'low' ? '流畅' : '高清'}`;
}

/**
 * 画质手动开关（左下角常驻）：手机自动进低画质后，用户仍可能想强开高清看特效，
 * 或在弱 CPU 的桌面上要流畅档。点击轮转 自动 → 流畅 → 高清，选择写入 localStorage。
 * 组件只读 <html data-quality>，不订阅 store，因此不会跟着战斗状态重渲染。
 */
export default function QualityControl() {
    const [preference, setPreference] = useState<QualityPreference>(getRenderQualityPreference);

    const cycle = () => {
        const next = CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length] ?? null;
        setRenderQualityPreference(next);
        setPreference(next);
    };

    return (
        <button
            type="button"
            data-testid="quality-toggle"
            data-sfx="toggle"
            onClick={cycle}
            title={`画质档位：${labelFor(preference)}（点击切换 自动 → 流畅 → 高清）`}
            aria-label={`画质档位：${labelFor(preference)}，点击切换`}
            className="fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full px-3 py-1.5
                font-title text-xs text-ink-light bg-rice/85 border border-ink/20 shadow-sm
                opacity-50 hover:opacity-100 transition-opacity select-none"
        >
            画质·{labelFor(preference)}
        </button>
    );
}
