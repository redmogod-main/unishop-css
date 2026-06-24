// World data for PLAGUE.
// Each country has rough Mercator-ish coordinates on a 1000x500 canvas.
// climate:   "cold" | "temperate" | "hot" | "arid" | "tropical"
// density:   "urban" | "rural"
// wealth:    0 (poor) | 1 (medium) | 2 (rich)
// borders:   indices into the array of land-adjacent countries (used for cross-border spread).
// airport, seaport: whether the country has international hubs.
const WORLD = (function () {
  const c = [
    { name: 'USA',          x: 200, y: 195, population: 331e6, wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['Canada', 'Mexico'] },
    { name: 'Canada',       x: 215, y: 130, population: 38e6,  wealth: 2, climate: 'cold',      density: 'urban', airport: true,  seaport: true,  borders: ['USA'] },
    { name: 'Mexico',       x: 195, y: 245, population: 130e6, wealth: 1, climate: 'hot',       density: 'urban', airport: true,  seaport: true,  borders: ['USA'] },
    { name: 'Brazil',       x: 330, y: 335, population: 213e6, wealth: 1, climate: 'tropical',  density: 'urban', airport: true,  seaport: true,  borders: ['Argentina', 'Peru'] },
    { name: 'Argentina',    x: 305, y: 415, population: 45e6,  wealth: 1, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['Brazil', 'Peru'] },
    { name: 'Peru',         x: 285, y: 355, population: 33e6,  wealth: 1, climate: 'tropical',  density: 'rural', airport: true,  seaport: true,  borders: ['Brazil', 'Argentina'] },
    { name: 'Greenland',    x: 380, y: 90,  population: 56e3,  wealth: 1, climate: 'cold',      density: 'rural', airport: true,  seaport: true,  borders: [] },
    { name: 'Iceland',      x: 455, y: 130, population: 370e3, wealth: 2, climate: 'cold',      density: 'urban', airport: true,  seaport: true,  borders: [] },
    { name: 'UK',           x: 480, y: 170, population: 67e6,  wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: [] },
    { name: 'France',       x: 495, y: 195, population: 67e6,  wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['Germany', 'Spain', 'Italy'] },
    { name: 'Germany',      x: 520, y: 180, population: 83e6,  wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['France', 'Italy', 'Russia'] },
    { name: 'Spain',        x: 470, y: 215, population: 47e6,  wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['France'] },
    { name: 'Italy',        x: 525, y: 215, population: 60e6,  wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['France', 'Germany'] },
    { name: 'Russia',       x: 660, y: 145, population: 144e6, wealth: 1, climate: 'cold',      density: 'urban', airport: true,  seaport: true,  borders: ['Germany', 'China', 'Kazakhstan'] },
    { name: 'Egypt',        x: 575, y: 250, population: 104e6, wealth: 0, climate: 'arid',      density: 'urban', airport: true,  seaport: true,  borders: ['Nigeria'] },
    { name: 'Nigeria',      x: 525, y: 295, population: 220e6, wealth: 0, climate: 'tropical',  density: 'urban', airport: true,  seaport: true,  borders: ['Egypt', 'South Africa'] },
    { name: 'South Africa', x: 565, y: 410, population: 60e6,  wealth: 1, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['Nigeria'] },
    { name: 'Saudi Arabia', x: 615, y: 250, population: 35e6,  wealth: 2, climate: 'arid',      density: 'urban', airport: true,  seaport: true,  borders: ['Egypt', 'Iran', 'Turkey'] },
    { name: 'Turkey',       x: 580, y: 220, population: 84e6,  wealth: 1, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['Iran', 'Saudi Arabia', 'Russia'] },
    { name: 'Iran',         x: 645, y: 235, population: 86e6,  wealth: 1, climate: 'arid',      density: 'urban', airport: true,  seaport: true,  borders: ['Saudi Arabia', 'Turkey', 'Pakistan', 'Kazakhstan'] },
    { name: 'Kazakhstan',   x: 705, y: 185, population: 19e6,  wealth: 1, climate: 'cold',      density: 'rural', airport: true,  seaport: false, borders: ['Russia', 'China', 'Iran'] },
    { name: 'Pakistan',     x: 705, y: 245, population: 225e6, wealth: 0, climate: 'arid',      density: 'urban', airport: true,  seaport: true,  borders: ['Iran', 'India', 'China'] },
    { name: 'India',        x: 730, y: 275, population: 1380e6, wealth: 1, climate: 'tropical', density: 'urban', airport: true,  seaport: true,  borders: ['Pakistan', 'China'] },
    { name: 'China',        x: 810, y: 230, population: 1411e6, wealth: 1, climate: 'temperate', density: 'urban', airport: true, seaport: true,  borders: ['India', 'Russia', 'Kazakhstan', 'Pakistan', 'South Korea'] },
    { name: 'South Korea',  x: 870, y: 215, population: 52e6,  wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: ['China'] },
    { name: 'Japan',        x: 895, y: 220, population: 125e6, wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: [] },
    { name: 'Indonesia',    x: 855, y: 340, population: 274e6, wealth: 1, climate: 'tropical',  density: 'urban', airport: true,  seaport: true,  borders: [] },
    { name: 'Australia',    x: 895, y: 400, population: 26e6,  wealth: 2, climate: 'arid',      density: 'urban', airport: true,  seaport: true,  borders: [] },
    { name: 'New Zealand',  x: 955, y: 430, population: 5e6,   wealth: 2, climate: 'temperate', density: 'urban', airport: true,  seaport: true,  borders: [] },
    { name: 'Madagascar',   x: 625, y: 380, population: 28e6,  wealth: 0, climate: 'tropical',  density: 'rural', airport: false, seaport: true,  borders: [] },
  ];

  // Convert border name lists to index lists for fast lookup.
  const byName = new Map(c.map((co, i) => [co.name, i]));
  c.forEach((co) => {
    co.id = byName.get(co.name);
    co.borderIds = co.borders.map((n) => byName.get(n)).filter((v) => v !== undefined);
  });

  return {
    width: 1000,
    height: 500,
    countries: c,
    byName,
  };
})();
