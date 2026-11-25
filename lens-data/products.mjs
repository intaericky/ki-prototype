// Lens data: the world maps and which satellite uses which.
//
// Every map is one NASA GIBS layer, requested through WMS in EPSG:4326 over the whole
// Earth (-180..180 longitude, 90..-90 latitude), so every map shares the same
// equirectangular grid and the continents line up pixel for pixel.
//
// kind:
//   day        one day of the layer (the latest complete day)
//   composite  the latest `days` days stacked, newest on top (for sparse layers)
//   month      the latest monthly map
//   fixed      a fixed date (`date`), because the layer ended
//   loop       144 frames, one every 10 minutes over the latest complete UTC day
//   loopmix    a loop made by stacking other loops (`of`)

export const PRODUCTS = [
  // --- optical, true colour, whole Earth every day
  { id: 'modis_terra', kind: 'day', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', title: 'MODIS on Terra, true colour', shows: 'the whole Earth in true colour, one day' },
  { id: 'modis_aqua', kind: 'day', layer: 'MODIS_Aqua_CorrectedReflectance_TrueColor', title: 'MODIS on Aqua, true colour', shows: 'the whole Earth in true colour, one day' },
  { id: 'viirs_snpp', kind: 'day', layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', title: 'VIIRS on Suomi NPP, true colour', shows: 'the whole Earth in true colour, one day' },
  { id: 'viirs_noaa20', kind: 'day', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', title: 'VIIRS on NOAA-20, true colour', shows: 'the whole Earth in true colour, one day' },
  { id: 'viirs_noaa21', kind: 'day', layer: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor', title: 'VIIRS on NOAA-21, true colour', shows: 'the whole Earth in true colour, one day' },

  // --- geostationary full disks, a day in 10-minute steps
  { id: 'goes_east', kind: 'loop', layer: 'GOES-East_ABI_GeoColor', title: 'ABI on GOES-East, GeoColor', shows: 'its full disk (the Americas and Atlantic) every 10 minutes for one day; black outside the disk' },
  { id: 'goes_west', kind: 'loop', layer: 'GOES-West_ABI_GeoColor', title: 'ABI on GOES-West, GeoColor', shows: 'its full disk (the Pacific and the Americas) every 10 minutes for one day; black outside the disk' },
  { id: 'himawari', kind: 'loop', layer: 'Himawari_AHI_Band3_Red_Visible_1km', title: 'AHI on Himawari, red visible band', shows: 'its full disk (Asia, Australia and the Pacific) every 10 minutes for one day, in grey; dark at night; black outside the disk' },
  { id: 'geo_mix', kind: 'loopmix', of: ['himawari', 'goes_west', 'goes_east'], title: 'GOES-East, GOES-West and Himawari together', shows: 'the three open geostationary disks stacked, every 10 minutes for one day; Europe, Africa and the Indian Ocean stay black (no open disk there)' },

  // --- high-resolution optical (land only)
  { id: 'sentinel2', kind: 'composite', days: 30, layer: 'HLS_S30_Nadir_BRDF_Adjusted_Reflectance', title: 'Sentinel-2 MSI (HLS S30), 30-day stack', shows: 'land in true colour at 30 m, the latest 30 days stacked; oceans are not imaged and stay black' },
  { id: 'landsat', kind: 'composite', days: 30, layer: 'HLS_L30_Nadir_BRDF_Adjusted_Reflectance', title: 'Landsat 8/9 OLI (HLS L30), 30-day stack', shows: 'land in true colour at 30 m, the latest 30 days stacked; oceans are not imaged and stay black' },

  // --- radar
  { id: 'nisar', kind: 'composite', days: 30, layer: 'NISAR_L2_Geocoded_Polarimetric_Covariance', title: 'NISAR L-band radar, 30-day stack', shows: 'radar backscatter of land, the latest 30 days stacked; black where not imaged' },
  { id: 'sentinel1', kind: 'composite', days: 12, layer: 'OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1', title: 'Sentinel-1 C-band radar (OPERA RTC), 12-day stack', shows: 'radar backscatter, the latest 12 days stacked; GIBS only processes North America, the rest stays black' },

  // --- weather and ocean, own sensors
  { id: 'metop_b_sst', kind: 'composite', days: 3, layer: 'AVHRR_MetOp-B_L3U_Sea_Surface_Temperature', title: 'AVHRR on Metop-B, sea surface temperature', shows: 'sea surface temperature from its own passes, 3 days stacked; land and cloud stay black' },
  { id: 'metop_c_sst', kind: 'composite', days: 3, layer: 'AVHRR_MetOp-C_L3U_Sea_Surface_Temperature', title: 'AVHRR on Metop-C, sea surface temperature', shows: 'sea surface temperature from its own passes, 3 days stacked; land and cloud stay black' },
  { id: 'ssmis_f16', kind: 'composite', days: 2, layer: 'SSMI_DMSP_F16_Water_Vapor_Over_Oceans_Ascending', title: 'SSMIS on DMSP F16, water vapour over the oceans', shows: 'water vapour over the oceans, 2 days stacked' },
  { id: 'ssmis_f17', kind: 'composite', days: 2, layer: 'SSMI_DMSP_F17_Water_Vapor_Over_Oceans_Ascending', title: 'SSMIS on DMSP F17, water vapour over the oceans', shows: 'water vapour over the oceans, 2 days stacked' },
  { id: 'amsr2_vapour', kind: 'composite', days: 2, layer: 'AMSRU2_Total_Precipitable_Water_Day', title: 'AMSR2 on GCOM-W, water vapour', shows: 'total water vapour over the oceans (the layer ends 2025-09-01)' },
  { id: 'amsr2_wind', kind: 'composite', days: 2, layer: 'AMSRU2_Wind_Speed_Day', title: 'AMSR2 on GCOM-W, ocean wind speed', shows: 'wind speed over the oceans (the layer ends 2025-09-01)' },
  { id: 'imerg', kind: 'day', layer: 'IMERG_Precipitation_Rate', title: 'GPM IMERG, precipitation', shows: 'rain and snow rate, one day; black where it is dry' },

  // --- atmosphere and Earth science
  { id: 'ozone_mls', kind: 'composite', days: 7, layer: 'MLS_O3_46hPa_Day', title: 'MLS on Aura, ozone at 46 hPa', shows: 'ozone in the stratosphere, 7 days stacked' },
  { id: 'co2_oco2', kind: 'composite', days: 30, layer: 'OCO-2_Carbon_Dioxide_Total_Column_Average', title: 'OCO-2, carbon dioxide', shows: 'column carbon dioxide along its tracks, 30 days stacked' },
  { id: 'ch4_airs', kind: 'month', layer: 'AIRS_L3_Methane_400hPa_Volume_Mixing_Ratio_Monthly_Day', title: 'AIRS on Aqua, methane at 400 hPa, monthly', shows: 'methane in the mid-troposphere, one month' },
  { id: 'olr_airs', kind: 'month', layer: 'AIRS_L3_All_Sky_Outgoing_Longwave_Radiation_Monthly_Day', title: 'AIRS on Aqua, outgoing longwave radiation, monthly', shows: 'heat leaving the Earth, one month' },
  { id: 'air_temp', kind: 'month', layer: 'MERRA2_Air_Temperature_250hPa_Monthly', title: 'MERRA-2 air temperature at 250 hPa, monthly', shows: 'upper-air temperature from the NASA reanalysis, which assimilates radio-occultation soundings' },
  { id: 'sea_height', kind: 'latest', layer: 'JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies', title: 'Multi-mission altimetry, sea surface height (JPL MEaSUREs)', shows: 'sea level anomaly from the TOPEX/Jason altimeters (the layer ends 2019-01-22)' },
  { id: 'soil_smap', kind: 'composite', days: 3, layer: 'SMAP_L3_Passive_Day_Soil_Moisture', title: 'SMAP L-band radiometer, soil moisture', shows: 'soil moisture over land, 3 days stacked' },
  { id: 'soil_cygnss', kind: 'composite', days: 7, layer: 'CYGNSS_L3_Soil_Moisture_SDR_Daily', title: 'CYGNSS, soil moisture', shows: 'soil moisture from reflected GPS signals, 7 days stacked (the layer ends 2020-08-16)' },
];

// match: how close the map is to what the satellite itself sees
//   own              made from this satellite's own instrument
//   family           a sister satellite with the same instrument
//   type             the same kind of instrument on another satellite
//   nearest_product  the satellite takes no picture; a world map of what it measures
//   unknown          the instrument is not known; a true-colour map stands in
export const MATCHES = ['own', 'family', 'type', 'nearest_product', 'unknown'];

const N = (s) => (s.name + ' | ' + (s.gcat_name || '')).toUpperCase();

// first rule that matches wins
const RULES = [
  // own instruments
  [/^TERRA\b/, 'modis_terra', 'own'], [/^AQUA\b/, 'modis_aqua', 'own'],
  [/SUOMI NPP/, 'viirs_snpp', 'own'], [/NOAA 20\b/, 'viirs_noaa20', 'own'], [/NOAA 21\b/, 'viirs_noaa21', 'own'],
  [/^GOES 19\b/, 'goes_east', 'own'], [/^GOES 16\b/, 'goes_east', 'family', 'same ABI imager; GOES-16 handed GOES-East to GOES-19 in 2025'],
  [/^GOES 18\b/, 'goes_west', 'own'], [/^GOES 17\b/, 'goes_west', 'family', 'same ABI imager; GOES-17 handed GOES-West to GOES-18 in 2023'],
  [/^HIMAWARI-9/, 'himawari', 'own'], [/^HIMAWARI-8/, 'himawari', 'family', 'same AHI imager; Himawari-8 is the backup of Himawari-9'],
  [/^SENTINEL-2[ABC]\b/, 'sentinel2', 'own'], [/^LANDSAT [89]\b/, 'landsat', 'own'],
  [/^NISAR\b/, 'nisar', 'own'], [/^SENTINEL-1[A-D]\b/, 'sentinel1', 'own'],
  [/^METOP-B\b/, 'metop_b_sst', 'own'], [/^METOP-C\b/, 'metop_c_sst', 'own'],
  [/DMSP 5D-3 F16/, 'ssmis_f16', 'own'], [/DMSP 5D-3 F17/, 'ssmis_f17', 'own'], [/DMSP 5D-3 F18/, 'ssmis_f17', 'family', 'same SSMIS radiometer as F17'],
  [/GCOM-W/, 'amsr2_vapour', 'own'], [/^GPM-CORE\b/, 'imerg', 'own', 'IMERG is the GPM mission rain map, calibrated by GPM Core'],
  [/^OCO 2\b/, 'co2_oco2', 'own'], [/^AURA\b/, 'ozone_mls', 'own'], [/^CYGFM/, 'soil_cygnss', 'own'],
  // satellites that take no picture: a map of what they measure
  [/GHGSAT|\bPIERRE\b|\bVALMAY\b|\bELLIOT\b|\bJUBA\b|\bVANGUARD\b|ELEONORE|NURAY|TANAGER/, 'ch4_airs', 'nearest_product', 'measures methane'],
  [(s) => s.no_swath_reason === 'ro' || s.kind === 'MET-RO', 'air_temp', 'nearest_product', 'radio occultation sounds air temperature; MERRA-2 assimilates these soundings'],
  [/GOSAT|IBUKI|DAQI/, 'co2_oco2', 'type', 'carbon dioxide spectrometer'],
  [/JASON|SENTINEL-6|\bSWOT\b|CRYOSAT|HAI ?YANG ?2|HAIYANG ER|HY-2/, 'sea_height', 'nearest_product', 'radar altimeter measures sea height'],
  [/\bSMOS\b|HYDROGNSS|PRETTY/, 'soil_smap', 'nearest_product', 'measures soil moisture'],
  [/TOMORROW-S|EARTHCARE/, 'imerg', 'nearest_product', 'precipitation or cloud radar'],
  [/^AWS\b|WSF-M/, 'amsr2_vapour', 'type', 'microwave sounder or radiometer'],
  [/CORIOLIS|ZHONGFA HAIYANG/, 'amsr2_wind', 'nearest_product', 'measures ocean wind'],
  [/PREFIRE|UVSQ/, 'olr_airs', 'nearest_product', 'measures heat leaving the Earth'],
  [/SCISAT|\bMATS\b|\bTIMED\b|SENTINEL-5P/, 'ozone_mls', 'nearest_product', 'measures the composition or temperature of the upper air'],
  [/^PACE\b|SHUISE|HAI ?YANG ?1|HAIYANG YI|SENTINEL-3[AB]/, 'modis_aqua', 'type', 'ocean and land colour imager'],
  [/BIOMASS/, 'nisar', 'type', 'radar'],
];

const RADAR = /NOVASAR|\bSAR\b|COSMO|ICEYE|CAPELLA|RADARSAT|\bRCM\b|SAOCOM|GAOFEN-3|GAOFEN-12|TERRASAR|TANDEM|KOMPSAT-5|ARIRANG-5|\bPAZ\b|STRIX|UMBRA|KONDOR|OBZOR-R|TIANHUI ?2|LUDI TANCE|HONGTU/;
const WEATHER = /FENGYUN|FENG YUN|METEOSAT|METEOR|ELEKTRO|ARKTIKA|INSAT|GEO-?KOMPSAT|EWS-G|DMSP|NOAA|GOES/;

export function assign(s) {
  const n = N(s);
  for (const [test, map, match, note] of RULES) if (typeof test === 'function' ? test(s) : test.test(n)) return { map_id: map, map_match: match, map_note: note || '' };
  const geo = s.perigee_km > 30000;
  let k = s.kind;
  // CelesTrak-only satellites have no GCAT category: tell them apart by name and instrument
  if (k === 'CelesTrak EO group') k = RADAR.test(n) || /\bSAR\b/i.test(s.swath_instrument || '') ? 'IMG-R' : WEATHER.test(n) ? 'MET' : 'IMG';
  if (k === 'IMG-R' || RADAR.test(n) && k === 'IMG') return { map_id: 'nisar', map_match: 'type', map_note: 'radar' };
  if (k === 'MET') return geo ? { map_id: 'geo_mix', map_match: 'type', map_note: 'geostationary weather imager' } : { map_id: 'viirs_noaa20', map_match: 'type', map_note: 'polar weather imager' };
  if (k === 'IMG') return { map_id: 'sentinel2', map_match: 'type', map_note: 'optical imager' };
  return { map_id: 'modis_terra', map_match: 'unknown', map_note: 'instrument not known; true colour stands in' };
}
