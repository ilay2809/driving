/**
 * Small inline OSM extract used by the pipeline tests: a signalised crossroads, a
 * oneway=-1 street, a two-lane approach with turn:lanes and a stop sign, a mid-block
 * and an approach zebra crossing, and a building. Coordinates sit at the centre of the
 * North Tel Aviv area (WORLD_ORIGIN) so the fixture is inside the fetch bbox.
 *
 *            n4 (34.8250, 32.1265)
 *             |  B (residential, two-way)        n10 = zebra just north of n2
 *   n1 ------ n2 (signals) ------ n3   A (secondary, lanes=2, two-way), n9 = mid-block zebra
 *             |
 *   n8 --D--> n5 --C--> n6          D: oneway, lanes=2, turn:lanes=left|through;right, stop at n15,
 *             |                        no_right_turn relation D → B' (way 201)
 *            n7 (34.8250, 32.1220)  B' (way 201, lanes=2) continues south to a dead end
 *                                    C: drawn n6→n5 with oneway=-1 (travel n5→n6)
 */
export const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
 <bounds minlat="32.120" minlon="34.820" maxlat="32.130" maxlon="34.830"/>
 <node id="1" lat="32.1250" lon="34.8230"/>
 <node id="2" lat="32.1250" lon="34.8250"><tag k="highway" v="traffic_signals"/></node>
 <node id="3" lat="32.1250" lon="34.8270"/>
 <node id="4" lat="32.1265" lon="34.8250"/>
 <node id="5" lat="32.1235" lon="34.8250"/>
 <node id="6" lat="32.1235" lon="34.8265"/>
 <node id="7" lat="32.1220" lon="34.8250"/>
 <node id="8" lat="32.1235" lon="34.8235"/>
 <node id="9" lat="32.1250" lon="34.8240"><tag k="highway" v="crossing"/><tag k="crossing" v="zebra"/></node>
 <node id="10" lat="32.12506" lon="34.8250"><tag k="highway" v="crossing"/><tag k="crossing" v="marked"/><tag k="crossing:island" v="yes"/></node>
 <node id="11" lat="32.1258" lon="34.8258"/>
 <node id="12" lat="32.1258" lon="34.8260"/>
 <node id="13" lat="32.1260" lon="34.8260"/>
 <node id="14" lat="32.1260" lon="34.8258"/>
 <node id="15" lat="32.1235" lon="34.8248"><tag k="highway" v="stop"/><tag k="direction" v="forward"/></node>
 <node id="16" lat="32.1262" lon="34.8262"><tag k="natural" v="tree"/></node>
 <node id="17" lat="32.12488" lon="34.8260"><tag k="highway" v="bus_stop"/><tag k="name" v="תחנה"/></node>
 <way id="100"><nd ref="1"/><nd ref="9"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="secondary"/><tag k="name" v="ראשי"/><tag k="name:en" v="Main"/><tag k="lanes" v="2"/><tag k="maxspeed" v="50"/><tag k="parking:right" v="no"/></way>
 <way id="200"><nd ref="4"/><nd ref="10"/><nd ref="2"/><nd ref="5"/><tag k="highway" v="residential"/><tag k="name" v="צדדי"/><tag k="maxspeed" v="30"/></way>
 <way id="201"><nd ref="5"/><nd ref="7"/><tag k="highway" v="residential"/><tag k="name" v="צדדי"/><tag k="maxspeed" v="30"/><tag k="lanes" v="2"/></way>
 <way id="300"><nd ref="6"/><nd ref="5"/><tag k="highway" v="residential"/><tag k="name" v="הפוך"/><tag k="oneway" v="-1"/></way>
 <way id="400"><nd ref="8"/><nd ref="15"/><nd ref="5"/><tag k="highway" v="tertiary"/><tag k="name" v="כניסה"/><tag k="oneway" v="yes"/><tag k="lanes" v="2"/><tag k="turn:lanes" v="left|through;right"/></way>
 <way id="500"><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="14"/><nd ref="11"/><tag k="building" v="yes"/><tag k="building:levels" v="4"/><tag k="name" v="בניין &quot;הבדיקה&quot;"/></way>
 <way id="600"><nd ref="4"/><nd ref="11"/><tag k="highway" v="footway"/></way>
 <relation id="900"><member type="way" ref="400" role="from"/><member type="node" ref="5" role="via"/><member type="way" ref="201" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_right_turn"/></relation>
</osm>`;
