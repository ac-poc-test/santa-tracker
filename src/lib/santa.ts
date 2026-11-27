import { geoContains, geoCircle, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import landTopo from 'world-atlas/land-110m.json';
import countriesTopo from 'world-atlas/countries-110m.json';

// Santa flies through the time zone where the clock reads this hour,
// crossing it from its eastern to its western edge in one hour.
const DELIVERY_HOUR = 2;
// Sun at least this far below the horizon counts as dark (civil twilight).
const DARK_ALTITUDE = -6;
// Each north-south zig-zag sweeps a strip this many degrees wide.
const STRIP_WIDTH = 3;

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 500;

type Cell = { lon: number; lat: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const land = feature(landTopo as any, (landTopo as any).objects.land) as unknown as Feature<MultiPolygon>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const countries = feature(countriesTopo as any, (countriesTopo as any).objects.countries) as unknown as FeatureCollection<
  Polygon | MultiPolygon,
  { name: string }
>;

const projection = geoNaturalEarth1().fitExtent(
  [
    [8, 34],
    [MAP_WIDTH - 8, MAP_HEIGHT - 40],
  ],
  { type: 'Sphere' },
);
const path = geoPath(projection);

// One-degree land mask, computed once per process.
let landCells: Cell[] | undefined;
function getLandCells(): Cell[] {
  if (!landCells) {
    landCells = [];
    for (let lat = -59.5; lat < 84; lat += 1) {
      for (let lon = -179.5; lon < 180; lon += 1) {
        if (geoContains(land, [lon, lat])) landCells.push({ lon, lat });
      }
    }
  }
  return landCells;
}

const rad = Math.PI / 180;

/** Point on Earth where the sun is directly overhead. */
export function subsolarPoint(date: Date): [number, number] {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86_400_000;
  const g = (2 * Math.PI * (dayOfYear - 1)) / 365;
  const declination =
    (0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)) / rad;
  const eqTimeMinutes =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const lon = normalizeLon(-(utcMinutes + eqTimeMinutes - 720) / 4);
  return [lon, declination];
}

function sunAltitude([sunLon, sunLat]: [number, number], { lon, lat }: Cell): number {
  const h = (lon - sunLon) * rad;
  const s = Math.sin(lat * rad) * Math.sin(sunLat * rad) + Math.cos(lat * rad) * Math.cos(sunLat * rad) * Math.cos(h);
  return Math.asin(s) / rad;
}

function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Degrees west of `east`, in [0, 360). */
function westOf(east: number, lon: number): number {
  return (((east - lon) % 360) + 360) % 360;
}

function formatOffset(offset: number): string {
  return offset === 0 ? 'UTC' : `UTC${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
}

export type SantaState = {
  time: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  zone: string;
  localTime: string;
  country: string | null;
  nightPath: string;
  sunX: number;
  sunY: number;
  progress: number;
};

export function santaAt(date: Date): SantaState {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const hour = Math.floor(utcHours);
  const progress = utcHours - hour;

  // Nominal zone (15 degrees wide) where the local clock reads DELIVERY_HOUR.
  let offset = (((DELIVERY_HOUR - hour) % 24) + 24) % 24;
  if (offset > 12) offset -= 24;
  const eastEdge = normalizeLon(offset * 15 + 7.5);

  const sun = subsolarPoint(date);
  const dark = (c: Cell) => sunAltitude(sun, c) < DARK_ALTITUDE;
  const all = getLandCells();

  let route = all.filter((c) => westOf(eastEdge, c.lon) < 15 && dark(c));
  let routeWidth = 15;
  if (route.length === 0) {
    // A zone with no dark land (open ocean, polar day): widen the search
    // westwards, into zones where it is still the small hours.
    route = all.filter((c) => westOf(eastEdge, c.lon) < 60 && dark(c));
    routeWidth = 60;
  }
  if (route.length === 0) route = all.filter(dark);

  // Boustrophedon: strips from east to west, alternating north-south and south-north.
  const strip = (c: Cell) => Math.floor(westOf(eastEdge, c.lon) / STRIP_WIDTH);
  route.sort((a, b) => {
    const sa = strip(a);
    const sb = strip(b);
    if (sa !== sb) return sa - sb;
    const southward = sa % 2 === 0;
    if (a.lat !== b.lat) return southward ? b.lat - a.lat : a.lat - b.lat;
    return westOf(eastEdge, a.lon) - westOf(eastEdge, b.lon);
  });

  // Spend time in proportion to strip progress, so Santa leaves the zone
  // at its western edge as the hour ends, even when land is sparse.
  const target = progress * routeWidth;
  let index = route.findIndex((c) => westOf(eastEdge, c.lon) + 0.5 >= target);
  if (index < 0) index = route.length - 1;
  const stripStart = route.findIndex((c) => strip(c) === strip(route[index]));
  let stripEnd = route.length;
  for (let i = stripStart; i < route.length; i++) {
    if (strip(route[i]) !== strip(route[stripStart])) {
      stripEnd = i;
      break;
    }
  }
  const stripFrom = Math.floor(westOf(eastEdge, route[stripStart].lon) / STRIP_WIDTH) * STRIP_WIDTH;
  const within = Math.min(Math.max((target - stripFrom) / STRIP_WIDTH, 0), 0.9999);
  const cell = route[stripStart + Math.floor(within * (stripEnd - stripStart))];

  const [x, y] = projection([cell.lon, cell.lat]) ?? [0, 0];
  const [sunX, sunY] = projection(sun) ?? [0, 0];
  const antiSun: [number, number] = [normalizeLon(sun[0] + 180), -sun[1]];
  const nightPath = path(geoCircle().center(antiSun).radius(90).precision(1)()) ?? '';

  const country = countries.features.find((f) => geoContains(f, [cell.lon, cell.lat]))?.properties.name ?? null;

  const local = new Date(date.getTime() + offset * 3_600_000);
  const localTime = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;

  return {
    time: date.toISOString(),
    lon: cell.lon,
    lat: cell.lat,
    x,
    y,
    zone: formatOffset(offset),
    localTime,
    country,
    nightPath,
    sunX,
    sunY,
    progress,
  };
}

export function mapPaths() {
  return {
    sphere: path({ type: 'Sphere' }) ?? '',
    graticule: path(geoGraticule10()) ?? '',
    countries: countries.features.map((f) => path(f as Feature<Geometry>) ?? ''),
  };
}
