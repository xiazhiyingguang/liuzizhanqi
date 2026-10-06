import designs from '../data/material-sounds.json';
import files from '../data/material-sound-files.json';
import { computeFxImpactDelayMs, computeMirrorBladeTiming, type SkillFxEvent } from './skill-fx';

export type SoundMaterial = 'ice' | 'metal' | 'soulfire' | 'wind' | 'water';
export interface MaterialSoundDesign {
    material: SoundMaterial;
    variant: string;
    pitch: number;
    cast?: boolean;
}
export interface MaterialSoundFile {
    file: string;
    peakMs: number;
    durationMs: number;
}
export interface SkillSoundCue extends MaterialSoundFile {
    role: 'cast' | 'impact';
    /** Absolute time of the audible transient, not the beginning of the WAV. */
    at: number;
    volume: number;
}
export const MATERIAL_SOUND_DESIGNS = designs as Record<string, MaterialSoundDesign>;
export const MATERIAL_SOUND_FILES = files as Record<string, { cast?: MaterialSoundFile; impact: MaterialSoundFile }>;

export function materialSoundId(event: SkillFxEvent): string | undefined {
    const id = event.profile.kind === 'feixue-shatter' ? 'feixue_shatter' : event.skillId;
    return id && MATERIAL_SOUND_DESIGNS[id] ? id : undefined;
}

/** One sound for simultaneous AOE contacts; retain at most four distinct beats. */
export function planSkillSoundCues(event: SkillFxEvent): SkillSoundCue[] {
    const id = materialSoundId(event);
    if (!id) return [];
    const design = MATERIAL_SOUND_DESIGNS[id];
    const asset = MATERIAL_SOUND_FILES[id];
    const cells = event.damagePositions?.length ? event.damagePositions
        : event.impactPositions?.length ? event.impactPositions : [event.targetPos];
    const times = event.mirrorBlades?.length
        ? event.mirrorBlades.map((blade, index) => computeMirrorBladeTiming(blade, index).impactMs)
        : cells.map(cell => computeFxImpactDelayMs(event, cell));
    // The second crest is an actual second wave shared with damage-number timing.
    if (event.profile.kind === 'lingxi-fan') times.push(Math.min(...times) + 130);
    const beats = times.sort((a, b) => a - b).reduce<number[]>((kept, time) => {
        if (kept.length < 4 && (!kept.length || time - kept[kept.length - 1] >= 70)) kept.push(time);
        return kept;
    }, []);
    const soft = ['ward', 'return', 'still', 'mirror'].includes(design.variant);
    const volume = soft ? .30 : .43;
    const cues: SkillSoundCue[] = beats.map((time, index) => ({
        ...asset.impact, role: 'impact', at: event.bornAt + time,
        volume: volume * (index === 0 ? 1 : .62),
    }));
    if (asset.cast) cues.unshift({ ...asset.cast, role: 'cast', at: event.bornAt, volume: .17 });
    return cues;
}
