import { useState } from 'react';
import { audioManager } from '../../audio/audio-manager';

/**
 * 全局背景音乐音量控件（右下角常驻）：
 * 点击圆形按钮切换静音，滑块调节 BGM 音量，偏好写入 localStorage。
 */
export default function BgmControl() {
    const [muted, setMuted] = useState(() => audioManager.getUserState().muted);
    const [volume, setVolume] = useState(() => audioManager.getUserState().volume);

    const handleToggleMute = () => {
        audioManager.toggleMute();
        setMuted(audioManager.getUserState().muted);
    };

    const handleVolumeChange = (value: number) => {
        audioManager.setVolume(value);
        setVolume(value);
    };

    return (
        <div
            className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 px-2 py-1 rounded-full
                bg-rice/85 backdrop-blur-sm border border-ink/20 shadow-sm
                opacity-50 hover:opacity-100 transition-opacity"
            data-testid="bgm-control"
        >
            <button
                type="button"
                data-sfx="toggle"
                onClick={handleToggleMute}
                title={muted ? '开启背景音乐' : '静音背景音乐'}
                aria-label={muted ? '开启背景音乐' : '静音背景音乐'}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-title
                    transition-colors select-none ${
                        muted
                            ? 'bg-ink/10 text-ink-light'
                            : 'bg-vermillion/90 text-rice-light hover:brightness-110'
                    }`}
            >
                {muted ? '静' : '乐'}
            </button>
            <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={e => handleVolumeChange(parseFloat(e.target.value))}
                title="背景音乐音量"
                aria-label="背景音乐音量"
                className="w-16 h-1 accent-[#8b2500] cursor-pointer"
                disabled={muted}
            />
        </div>
    );
}
