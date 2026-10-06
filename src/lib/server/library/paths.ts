import path from 'node:path';
import { DATA_DIR, MEDIA_DIR } from '$app/env/private';

export const mediaRoot = path.resolve(MEDIA_DIR);
export const dataRoot = path.resolve(DATA_DIR);

export const sourceFile = (relative: string) => path.join(mediaRoot, relative);
export const videoFile = (episodeId: number) => path.join(dataRoot, 'video', `${episodeId}.mp4`);
export const thumbFile = (episodeId: number) => path.join(dataRoot, 'thumb', `${episodeId}.jpg`);
