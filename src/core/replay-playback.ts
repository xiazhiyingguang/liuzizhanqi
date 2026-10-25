/** 回放播放按钮的下一状态：末帧再按一次应从头重播，而不是毫无反应 */
export function nextPlaybackToggle(
    playing: boolean,
    current: number,
    lastIndex: number
): { playing: boolean; restartAt?: number } {
    if (!playing && lastIndex > 0 && current >= lastIndex) return { playing: true, restartAt: 0 };
    return { playing: !playing };
}
