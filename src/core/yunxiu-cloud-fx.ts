import type { Position } from '../types/game';

export function isYunxiuCloudFx(kind: string): boolean {
    return kind === 'yunxiu-cloud-call' || kind === 'yunxiu-cloud-bolt';
}

/** Always keep the original 3×3 shape; trim the part outside the board instead of shrinking it. */
export function cloudFieldClip([row, col]: Position) {
    return { top: Math.max(0, 1 - row), right: Math.max(0, col - 4),
        bottom: Math.max(0, row - 4), left: Math.max(0, 1 - col) };
}

export function cloudClipVars(position: Position) {
    const clip = cloudFieldClip(position);
    return { '--yx-clip-t': clip.top, '--yx-clip-r': clip.right,
        '--yx-clip-b': clip.bottom, '--yx-clip-l': clip.left };
}

export const CLOUD_SILHOUETTE = 'M 17 100 C -2 71 17 44 46 43 C 43 15 88 3 111 26 C 132 1 177 9 187 34 C 223 10 258 28 260 57 C 292 54 309 88 283 111 C 308 136 299 166 279 181 C 306 213 282 247 252 248 C 252 279 216 293 192 276 C 162 307 126 297 112 277 C 78 297 43 279 43 254 C 9 257 -5 220 16 198 C -6 172 -2 141 20 128 C 7 117 8 109 17 100 Z';

/** One SVG contains the whole discharge. Endpoints stay on the actual victims, including lethal hits. */
export function cloudStrikePaths(center: Position, cells: Position[]) {
    const seen = new Set<string>();
    return cells.flatMap(([row, col]) => {
        const key = `${row},${col}`, dr = row - center[0], dc = col - center[1];
        if (row < 0 || row > 5 || col < 0 || col > 5 || Math.abs(dr) > 1 || Math.abs(dc) > 1 || seen.has(key)) return [];
        seen.add(key);
        const x = (dc + 1) * 100 + 50, y = (dr + 1) * 100 + 50;
        const sign = (row + col) % 2 ? -1 : 1;
        const startY = Math.max(8, y - 116), span = y - startY;
        const d = `M ${x + sign * 13} ${startY} L ${x - sign * 8} ${startY + span * .31} L ${x + sign * 9} ${startY + span * .34} L ${x - sign * 12} ${startY + span * .69} L ${x + sign * 5} ${startY + span * .65} L ${x} ${y}`;
        const fork = `M ${x - sign * 8} ${startY + span * .31} L ${x - sign * 26} ${startY + span * .46} L ${x - sign * 21} ${startY + span * .59} L ${x - sign * 36} ${startY + span * .72}`;
        return [{ key, x, y, d, fork }];
    });
}
