# Crowd Estimator

A small map tool for estimating crowd sizes from satellite imagery, using
Herbert Jacobs' crowd density method. Draw the area, say how tightly packed
people are in each part of it, and it adds up the people.

It's a static site: plain HTML, CSS and JavaScript. No build step, and no
dependencies at runtime. The whole app is the handful of files in this folder.

## Using it

1. **Pan / Zoom** to find the spot, or search an address.
2. **Draw Polygon**, then click the map to place corners. Three is the minimum.
3. **Finish & Generate Grid** cuts the outline into 10 m² blocks.
4. **Paint Grid**, pick a density, then click or drag across the blocks.

The estimate updates as you paint. While you're painting on a phone, the
density picker sits in a bar at the bottom of the screen so you don't have to
scroll back to the panel.

## The maths

Every block is 10 m², about 3.16 × 3.16 m. A block joins the grid if its centre
falls inside your outline.

Densities are people per square metre:

| Level      | People / m² |
| ---------- | ----------- |
| Light      | 1           |
| Moderate   | 1.5         |
| Dense      | 2.4         |
| Very Dense | 4.3         |

So one Dense block is 24 people, and the total is that, summed over the blocks
you painted. There's a "How is this calculated?" panel under the estimate that
says the same thing while you're using the app.

This is an estimate, not a count. The blocks are squares on a locally flat
projection, so the larger the area, the rougher the number gets.

## Files

| Path                       | What's in it                                    |
| -------------------------- | ----------------------------------------------- |
| `index.html`               | markup, inline SVG icons                        |
| `app.js`                   | map, grid, painting, storage, sharing           |
| `styles.css`               | styles                                          |
| `sw.js`                    | service worker; caches the shell so it installs |
| `manifest.webmanifest`     | PWA manifest                                    |
| `icons/`                   | app icons                                       |
| `tools/generate-icons.mjs` | draws those icons, see below                    |
| `wrangler.toml`            | Cloudflare config for serving the folder        |

## Running it

There's no build step and no test suite. `npm run dev` plus a browser is the
whole development loop.

```
npm install
npm run dev       # wrangler serves this folder and prints the URL
npm run deploy    # pushes it to Cloudflare
```

Deploying needs a Cloudflare account and a one-off `npx wrangler login`.

Opening `index.html` directly also mostly works, but the service worker and the
clipboard both need a real web origin, so use `npm run dev` for anything more
than a glance.

## Installing on a phone

Open the deployed HTTPS URL, then use the browser's install action ("Install
app" in Chrome, Share → "Add to Home Screen" in Safari). It then opens like an
app, without the address bar or tabs. Only the app shell is cached, so map tiles
still need a connection.

## Sharing

The share button puts the whole scene in the URL fragment, so nothing is sent
to or stored on a server. On a phone it opens the system share sheet; on desktop
it copies the link instead. Everything lives after the `#`:

```
#p=o2rpc_-1bmgog;87_6b;9i_-g1;...&c=1&n=600&g=40e120l40e15d85e10v
```

- `p` is the outline. Coordinates go out as base36 integers, and every corner
  after the first is stored as a delta from the previous one, which is what
  keeps it short.
- `c=1` means the outline was finished.
- `g` is the painting, run-length encoded in block order, so `120l` is 120
  blocks at Light. Unpainted blocks cost nothing.
- `n` is the block count, checked on arrival so that a grid which regenerates
  to a different size is refused rather than misread.

The receiving side rebuilds the grid from the outline and fits the view to it,
so a link only needs those few numbers. Links written before this format
existed used decimal coordinates and per-block ids; those still open.

## Notes

- Satellite tiles come from Esri's World Imagery, without an API key. Fine for
  personal use, not for bulk or commercial traffic.
- Address search uses the public Nominatim instance, which is rate limited and
  asks that you don't hammer it.
- Your drawing, view and lock state live in `localStorage` under
  `crowdEstimator.state.v1`, per browser. Nothing is uploaded.
- The map controls are zoom, reload (re-fetches tiles and redraws, for when the
  map comes back from a background tab looking wrong) and lock (freezes the map
  so a finished estimate can't be changed by accident).
- If you fork this, keep the attribution in the page footer for the imagery and
  the geocoder.
- To change the icons, edit the drawing code in the script and run
  `node tools/generate-icons.mjs`; it writes the PNGs into `icons/`.
