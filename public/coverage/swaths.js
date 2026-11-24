// Published ground coverage of Earth-observation satellites, for /coverage.
// Each entry matches CelesTrak object names (GP groups weather, resource, planet) and gives the nadir swath width
// (km across track) of the satellite's widest imaging instrument, as its operator or WMO OSCAR states it.
// "disk": geostationary full-disk imagers. They see the whole visible disc, so the coverage radius is computed from
// the orbit itself (great-circle distance from the sub-satellite point to the horizon: RE · acos(RE / r)).
// A satellite in those groups that matches nothing here has no published swath in this table and is NOT drawn
// (no guessed values). The studio lists them.
export const SWATHS = [
  // --- wide imagers, low orbit ---
  { re: /^SUOMI NPP|^NOAA 2\d/, inst: 'VIIRS', km: 3040, src: 'NOAA NCC, About VIIRS' },
  { re: /^NOAA 1[5-9]\b/, inst: 'AVHRR/3', km: 2900, src: 'NOAA / WMO OSCAR, AVHRR/3' },
  { re: /^METOP-/, inst: 'AVHRR/3', km: 2900, src: 'EUMETSAT / WMO OSCAR, AVHRR/3' },
  { re: /^DMSP/, inst: 'OLS', km: 3000, src: 'WMO OSCAR, OLS' },
  { re: /^FENGYUN 3/, inst: 'MERSI', km: 2900, src: 'WMO OSCAR, MERSI-2' },
  { re: /^METEOR-M/, inst: 'MSU-MR', km: 2800, src: 'WMO OSCAR, MSU-MR' },
  { re: /^TERRA$|^AQUA$/, inst: 'MODIS', km: 2330, src: 'NASA, MODIS specifications' },
  { re: /^AURA$/, inst: 'OMI', km: 2600, src: 'NASA, Aura OMI' },
  { re: /^SENTINEL-5P/, inst: 'TROPOMI', km: 2600, src: 'ESA, Sentinel-5P' },
  { re: /^GCOM-W/, inst: 'AMSR2', km: 1450, src: 'JAXA, GCOM-W' },
  { re: /^GCOM-C/, inst: 'SGLI', km: 1150, src: 'JAXA, GCOM-C' },
  { re: /^SENTINEL-3/, inst: 'OLCI', km: 1270, src: 'ESA, Sentinel-3 OLCI' },
  { re: /^SMAP/, inst: 'Radiometer', km: 1000, src: 'NASA JPL, SMAP' },
  { re: /^GPM/, inst: 'GMI', km: 885, src: 'NASA, GPM Core Observatory' },
  // --- moderate resolution ---
  { re: /^SENTINEL-2/, inst: 'MSI', km: 290, src: 'ESA, Sentinel-2 MSI' },
  { re: /^SENTINEL-1/, inst: 'C-SAR (IW mode)', km: 250, src: 'ESA, Sentinel-1' },
  { re: /^NISAR/, inst: 'L-SAR', km: 242, src: 'NASA, NISAR about the satellite' },
  { re: /^LANDSAT [89]/, inst: 'OLI', km: 185, src: 'USGS, Landsat 8/9' },
  { re: /^EARTHCARE/, inst: 'MSI', km: 150, src: 'ESA, EarthCARE' },
  { re: /^SWOT/, inst: 'KaRIn', km: 120, src: 'NASA JPL, SWOT (two 50 km swaths, 20 km gap)' },
  { re: /^SPOT [67]/, inst: 'NAOMI', km: 60, src: 'Airbus, SPOT 6/7' },
  // --- very high resolution ---
  { re: /^FLOCK 4/, inst: 'PlanetScope SuperDove (PSB.SD)', km: 32.5, src: 'Planet docs, PlanetScope (scene 32.5 × 19.6 km)' },
  { re: /^FLOCK/, inst: 'PlanetScope Dove (PS2)', km: 25.0, src: 'Planet docs, PlanetScope (scene 25.0 km wide)' },
  { re: /^PLEIADES NEO/, inst: 'Pleiades Neo imager', km: 14, src: 'ESA Earth Online, Pleiades Neo' },
  { re: /^PLEIADES/, inst: 'HiRI', km: 20, src: 'Airbus, Pleiades 1A/1B' },
  { re: /^WORLDVIEW-1\b|^WORLDVIEW 1\b/, inst: 'WV60', km: 17.7, src: 'PGC, Vantor constellation' },
  { re: /^WORLDVIEW-2\b|^WORLDVIEW 2\b/, inst: 'WV110', km: 16.4, src: 'PGC, Vantor constellation' },
  { re: /^WORLDVIEW-3\b|^WORLDVIEW 3\b/, inst: 'WV-3', km: 13.1, src: 'PGC, Vantor constellation' },
  { re: /^GEOEYE/, inst: 'GIS', km: 15.3, src: 'PGC, Vantor constellation' },
  { re: /LEGION/, inst: 'WorldView Legion imager', km: 10, src: 'PGC, Vantor constellation' },
  { re: /^SKYSAT/, inst: 'SkySat imager', km: 5.73, src: 'Planet docs, SkySat' },
  // --- geostationary full disk ---
  { re: /^GOES 1[6-9]/, inst: 'ABI full disk', disk: true, src: 'NOAA, GOES-R ABI' },
  { re: /^HIMAWARI/, inst: 'AHI full disk', disk: true, src: 'JMA, Himawari' },
  { re: /^METEOSAT|^MTG-I/, inst: 'SEVIRI / FCI full disk', disk: true, src: 'EUMETSAT' },
  { re: /^FENGYUN 4/, inst: 'AGRI full disk', disk: true, src: 'CMA / WMO OSCAR, AGRI' },
  { re: /GEO-KOMPSAT-2A|^GK-2A/, inst: 'AMI full disk', disk: true, src: 'KMA, GK-2A' },
  { re: /^INSAT-3D/, inst: 'Imager full disk', disk: true, src: 'ISRO / IMD, INSAT-3D' },
  { re: /^ELEKTRO-L/, inst: 'MSU-GS full disk', disk: true, src: 'WMO OSCAR, MSU-GS' },
];
export const matchSwath = (name) => SWATHS.find((s) => s.re.test(name)) || null;
