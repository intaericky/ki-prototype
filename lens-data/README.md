# Lens data package

This package holds the data for Lens: every operating Earth-observation satellite, the text the tablet shows for it, and the world map each satellite's lens refracts.

```
data/satellites.json   every satellite (also as data/satellites.csv)
data/maps.json         every map and loop: what it shows, its source layer and dates, its coverage
maps/<map_id>.jpg      still world maps, 4096 × 2048
loops/<map_id>/        24-hour loops: 144 frames, one every 10 minutes, 2048 × 1024
```

## One grid for everything

Every map and every loop frame uses the same equirectangular (plate carrée) grid, the same one as NASA's Blue Marble:

- longitude runs from −180° at the left edge to +180° at the right edge;
- latitude runs from +90° at the top edge to −90° at the bottom edge.

So pixel (u, v) in any map is the same place on Earth, and the continents line up exactly between maps. A point at latitude φ and longitude λ (in degrees) sits at u = (λ + 180) / 360 and v = (90 − φ) / 180.

Black means "not observed": outside a geostationary disk, oceans for land-only sensors, or gaps between orbits. It is part of the data, not missing data.

## Satellites (`data/satellites.json`)

The table holds one record per satellite. Several satellites share one map; each record only points to it with `map_id`.

| Field | Meaning |
|---|---|
| `norad` | NORAD catalogue number (unique id) |
| `name`, `gcat_name` | CelesTrak name, and the name in McDowell's GCAT |
| `gcat_category`, `kind` | GCAT category (for example `IMG`, `IMG-R`, `MET`, `EOSCI`, `MET-RO`) |
| `state`, `class`, `launch_year`, `purpose` | Country, operator class, launch year and purpose, in words |
| `tle_epoch_utc`, `mean_motion_rev_per_day`, `eccentricity`, `inclination_deg`, `raan_deg`, `arg_perigee_deg`, `mean_anomaly_deg`, `ndot` | Mean orbital elements from CelesTrak at `tle_epoch_utc`. Propagate them with SGP4. |
| `perigee_km`, `apogee_km` | Height range of the orbit |
| `swath_km`, `swath_instrument`, `swath_source` | Published swath: the width of ground the satellite images at once. This is the lens diameter. |
| `no_swath_reason` | When no swath is published: `ro` (radio occultation, no imager), `secret` (military) or `unknown` |
| `estimated_swath_km`, `estimate_basis` | Estimated swath when none is published |
| `tablet.line1` … `tablet.line4` | The four lines the tablet shows when the satellite is touched. Replace `{ALT}` in line 3 with the satellite's current height in km, rounded, with a thousands separator (for example `Launched in 2016, 35,786 km up`). |
| `map_id` | The map or loop this satellite's lens refracts (see `data/maps.json`) |
| `map_match` | How close that map is to what the satellite itself sees (below) |
| `map_note` | Why this map was chosen, when it is not the satellite's own |

`map_match` values:

- `own`: made from this satellite's own instrument.
- `family`: from a sister satellite with the same instrument.
- `type`: the same kind of instrument on another satellite (optical, radar or weather).
- `nearest_product`: the satellite takes no picture; this is a world map of what it measures (for example air temperature for radio occultation, sea height for altimeters, methane for methane sensors).
- `unknown`: the instrument is not known; a true-colour map stands in.

## Maps (`data/maps.json`)

Each entry has:
- `id`, `title` and `shows` (what the map shows, in words);
- `file` for stills, or `folder` and `pattern` for loops;
- `width` and `height`;
- `gibs_layer` (the NASA source layer);
- `dates` used, or for loops `day_utc` and `first_frame_utc`;
- `coverage_percent`, the share of the Earth that is not black.

Some layers are stacks of several days, because one day of that sensor covers only thin strips. The `dates` list shows which days.

Each loop frame k shows the time `first_frame_utc` + k × 10 minutes. If a frame was missing at the source, the nearest available time is used, and `frames_filled_from_nearest_time` counts how often that happened.

## Sources and credit

- Satellites: Jonathan McDowell, General Catalog of Artificial Space Objects (GCAT), planet4589.org; orbits from CelesTrak (T.S. Kelso); swaths from operators, WMO OSCAR/Space and ESA eoPortal.
- Maps: NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS). The layers carry the credit of their missions: NASA, NOAA, USGS, ESA/Copernicus, JAXA, EUMETSAT and JMA.

## Rebuilding

The package is a snapshot. To rebuild it with fresh data (needs Node 18 or newer):

```
npm install
npx playwright install chromium
node build.mjs            # or: node build.mjs catalogue | maps | loops
```

The output goes to `out/`.
