/**
 * Loading world files at runtime. The generated world is served as a gzip file
 * (public/world/north-tlv.json.gz) and decompressed in the browser with
 * DecompressionStream; a server that already decoded it transparently is handled too.
 */
import { parseWorld, type WorldFile } from './schema';
import { buildTrainingGround } from './testWorld';

/** URL of the North Tel Aviv world, relative to the app base. */
export const WORLD_URL = `${import.meta.env.BASE_URL}world/north-tlv.json.gz`;

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Bytes of a (possibly gzipped) JSON world file → validated WorldFile. */
export async function decodeWorld(bytes: Uint8Array): Promise<WorldFile> {
  let text: string;
  if (isGzip(bytes)) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  return parseWorld(JSON.parse(text));
}

export async function loadWorld(url: string = WORLD_URL): Promise<WorldFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`world file ${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return decodeWorld(bytes);
}

export function loadTrainingGround(): WorldFile {
  return buildTrainingGround();
}
