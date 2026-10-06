import { audioManager } from './audio-manager';

/** One interruptible soundtrack, routed through the existing master mute. */
export class SummonAudio {
    private tracks = new Map<number, HTMLAudioElement>();
    private sources: MediaElementAudioSourceNode[] = [];
    private active: HTMLAudioElement | null = null;

    constructor() {
        for (const count of [1, 6]) {
            const track = new Audio(`${import.meta.env.BASE_URL}sounds/summon/shanhe-${count === 6 ? 'six' : 'single'}.wav`);
            track.preload = 'auto';
            track.volume = .85;
            this.tracks.set(count, track);
        }
    }

    play(count: number): void {
        this.stop();
        audioManager.unlock();
        const bus = audioManager.getSfxBus();
        if (!bus) return;
        if (!this.sources.length) {
            for (const track of this.tracks.values()) {
                const source = (bus.context as AudioContext).createMediaElementSource(track);
                source.connect(bus);
                this.sources.push(source);
            }
        }
        this.active = this.tracks.get(count === 6 ? 6 : 1)!;
        this.active.currentTime = 0;
        void this.active.play().catch(() => { /* Playback restrictions must not block drawing. */ });
    }

    cue(seconds: number): void {
        if (!this.active) return;
        // Correct late loading and shortened/skipped animations at their visual cue.
        if (Math.abs(this.active.currentTime - seconds) > .16) this.active.currentTime = seconds;
    }

    stop(): void {
        this.active?.pause();
        this.active = null;
    }

    dispose(): void {
        this.stop();
        for (const source of this.sources) source.disconnect();
        for (const track of this.tracks.values()) { track.removeAttribute('src'); track.load(); }
        this.tracks.clear();
        this.sources = [];
    }
}
