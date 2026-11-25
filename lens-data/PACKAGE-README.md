# Lens data

```
data/satellites.json   the satellites (same content in data/satellites.csv)
data/maps.json         the images: what each shows, where it comes from, how to fetch it live
maps/                  still images, baked on the date in data/maps.json
loops/                 frame sequences (video), baked on the date in data/maps.json
```

## Satellites

There is one record per satellite.

- **Identity:** `norad` is the unique id. `name`, `gcat_name`, `kind` and `purpose` say what the satellite is.
- **Tablet text:** `tablet.line1` to `tablet.line4` are the four lines the tablet shows. In line 3, replace `{ALT}` with the satellite's current height in km, rounded, with a thousands separator.
- **Lens size:** `swath_km` is the published width of ground the satellite images at once, and it is the lens diameter. When there is none, `no_swath_reason` says why (`ro`, `secret` or `unknown`), and `estimated_swath_km` gives an estimate.
- **Image:** `map_id` is the image this satellite's lens shows, an id in `data/maps.json`. Many satellites share one image.
- **Match:** `map_match` says how close that image is to what the satellite itself sees:
  - `own`: its own instrument;
  - `family`: a sister satellite with the same instrument;
  - `type`: the same kind of instrument;
  - `nearest_product`: it takes no picture, so the image is a map of what it measures;
  - `unknown`: its instrument is not known.
- **Orbit:** the orbit fields are a snapshot.

**Live orbits.** Download https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json once a day. Match each record to a satellite by `NORAD_CAT_ID` = `norad`, and propagate it with SGP4. CelesTrak allows at most one download of the same data every 2 hours.

## Images

Every image and every frame uses the same grid as NASA's Blue Marble: equirectangular, longitude −180° to +180° from left to right, latitude +90° to −90° from top to bottom. Pixel positions mean the same place in every image, so they overlay exactly.

Black means not observed: outside a geostationary disk, oceans for land-only sensors, or gaps between orbits.

The two kinds of entry in `data/maps.json` are:
- `type: "image"`: a still image, in `file`;
- `type: "frame sequence (video)"`: 144 frames in `folder`, one every 10 minutes over 24 hours, starting at `first_frame_utc`. Frame k shows `first_frame_utc` + k × 10 minutes.

`baked_dates` or `baked_day_utc` give the dates of the files in this package.

**Live images.** Each entry's `live` block says how to fetch it:
- `url`: the request. Fill in `{W}`, `{H}` and `{TIME}`.
- `time`: which date or time to ask for.
- `refresh`: how often it changes and when to fetch.
- `how`: present when several requests are stacked into one image.

Use the same `{W}` × `{H}` for every request. If a request fails, keep the last good image, or the baked file.

## Sources

- Satellites: Jonathan McDowell, General Catalog of Artificial Space Objects (GCAT); CelesTrak (T.S. Kelso); swaths from operators, WMO OSCAR/Space and ESA eoPortal.
- Images: NASA Global Imagery Browse Services (GIBS), with the credit of each mission (NASA, NOAA, USGS, ESA/Copernicus, JAXA, JMA).
