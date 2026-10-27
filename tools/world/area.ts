/** Geographic extent of the simulator world (WGS84). Shared by all fetch/build scripts. */
export const AREA = {
  // North Tel Aviv, north of the Yarkon: Ramat Aviv, Neve Avivim, Afeka, Tel Baruch,
  // Shikun Lamed, Kokhav HaTzafon, Hadar Yosef, Tzahala, Ramat HaHayal, TAU.
  minLon: 34.775,
  minLat: 32.095,
  maxLon: 34.875,
  maxLat: 32.155,
};
export const OSM_TILE_DEG = 0.02;
export const RAW_OSM_DIR = 'data/raw/osm';
export const RAW_TLV_DIR = 'data/raw/tlv';
