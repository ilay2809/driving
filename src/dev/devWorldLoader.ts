/**
 * Tiny world-file loader for dev harness pages (the app's real loader lives in
 * src/world/loader.ts and is owned by another module). Fetches a JSON or gzipped JSON
 * world file and validates it with parseWorld.
 */
import { parseWorld, type WorldFile } from '@/world/schema';

export async function loadWorldFile(url: string): Promise<WorldFile | undefined> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  // dev/preview servers answer unknown paths with the SPA index.html (status 200)
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return undefined;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let text: string;
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  if (text.trimStart().startsWith('<')) return undefined;
  return parseWorld(JSON.parse(text));
}
