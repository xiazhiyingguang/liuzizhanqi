import { getHeroFullBodyUrl } from '../../data/hero-assets';
import { SUMMON_IMAGE_MANIFEST } from '../../data/summon-image-manifest';

export function getSummonImageUrl(id: string): string | undefined {
    const original = getHeroFullBodyUrl(id);
    return original ? (SUMMON_IMAGE_MANIFEST[original] ?? original) : undefined;
}

// Retain a bounded set of decoded images so revealing does not decode six PNGs at once.
const prepared = new Map<string, { image: HTMLImageElement; ready: Promise<void> }>();
export async function prepareSummonImages(ids: string[]): Promise<void> {
    const tasks = ids.map(id => {
        const url = getSummonImageUrl(id);
        if (!url) return Promise.resolve();
        const cached = prepared.get(url);
        if (cached) {
            prepared.delete(url);
            prepared.set(url, cached);
            return cached.ready;
        }
        const image = new Image();
        image.decoding = 'async';
        image.src = url;
        const ready = image.decode().catch(() => { prepared.delete(url); });
        prepared.set(url, { image, ready });
        while (prepared.size > 18) prepared.delete(prepared.keys().next().value!);
        return ready;
    });
    // Slow/failed networks must not trap the user; portraits retain their error fallback.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        Promise.all(tasks),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 5000); }),
    ]);
    clearTimeout(timeout);
}
