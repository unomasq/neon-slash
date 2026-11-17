import type { TrackDef } from '../pattern';
import { synthwave } from './synthwave';
import { electro } from './electro';
import { dnb } from './dnb';

export const TRACKS: TrackDef[] = [synthwave, electro, dnb];

export function getTrack(id: string): TrackDef {
  return TRACKS.find(t => t.id === id) ?? synthwave;
}
