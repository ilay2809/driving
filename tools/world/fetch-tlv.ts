/**
 * Fetch supporting layers from the Tel Aviv-Yafo municipality ArcGIS server
 * (IView2) for the simulator area. Output: data/raw/tlv/<name>.geojson (git-ignored).
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm world:fetch-tlv
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREA, RAW_TLV_DIR as OUT } from './area';

const BASE = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer';
const PAGE = 2000;

// layer id -> output name. See docs/DATA_SOURCES.md for descriptions.
export const LAYERS: Record<number, string> = {
  513: 'buildings', // מבנים (polygons, floors ms_komot, heights)
  507: 'street_axes', // צירי רחוב (polylines with Hebrew/English names)
  508: 'main_street_axes', // צירי רחובות ראשיים
  547: 'signalized_junctions', // צמתים מרומזרים
  836: 'junctions', // צמתים
  636: 'traffic_directions', // כווני תנועה (one-way directions)
  611: 'bus_lanes', // נתיבי תחבורה ציבורית
  544: 'parking_zones', // אזורי חניה
  956: 'bus_stops', // תחנות אוטובוס משרד התחבורה
  577: 'bike_paths', // שבילי אופניים
  628: 'trees', // עצים
  659: 'pedestrian_streets', // רחובות מוטי הליכה
  550: 'bridges', // גשרים
  449: 'loading_zones', // תמרורי פריקה וטעינה
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchLayer(id: number, name: string): Promise<void> {
  const path = join(OUT, `${name}.geojson`);
  if (existsSync(path)) {
    console.log('cached', name);
    return;
  }
  const features: any[] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${AREA.minLon},${AREA.minLat},${AREA.maxLon},${AREA.maxLat}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
    });
    const url = `${BASE}/${id}/query?${params.toString()}`;
    const data = await getJson(url);
    if (data.error) throw new Error(`layer ${id} ${name}: ${JSON.stringify(data.error)}`);
    const batch: any[] = data.features ?? [];
    features.push(...batch);
    const more = data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true || batch.length === PAGE;
    console.log(`${name}: +${batch.length} (total ${features.length})${more ? ' …' : ''}`);
    if (!more || batch.length === 0) break;
    offset += batch.length;
    await new Promise((r) => setTimeout(r, 300));
  }
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', layerId: id, name, fetchedAt: new Date().toISOString(), source: `${BASE}/${id}`, features }));
  console.log('saved', name, features.length, 'features');
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const [id, name] of Object.entries(LAYERS)) {
    try {
      await fetchLayer(Number(id), name);
    } catch (e) {
      console.error('FAILED', name, String(e));
    }
  }
  console.log('done');
}

if (process.argv[1] && /fetch-tlv\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
