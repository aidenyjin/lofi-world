# lofi world

A procedurally generated city you travel through, in sync with procedurally generated lofi.
The style is Cult of the Lamb crossed with Chillhop: ink-outlined toon shapes, painterly surfaces,
pastel sun-bleached colour, heavy haze and depth of field.

```
npm install
npm run dev      # http://localhost:5173, then click "tune in"
npm run build    # static site in dist/
```

## How it fits together

```
music/engine.ts ──emits──▶ events.ts (bus) ──▶ world/world.ts
  Tone.js band               beat · bar · chord       camera director, palette,
  on the audio clock         section · kick · hat     leaves, trains, traffic, post
```

The music engine is the conductor. Every event is scheduled on the audio clock and delivered through
`Tone.Draw`, so the world reacts to the beat you hear rather than the one being scheduled ahead.

| Music | World |
| --- | --- |
| beat | string lights and lamp pools breathe at night; boats bob; water glints |
| hi-hat | leaves flutter |
| bar | a wind gust through the leaves (bigger every 4 bars) |
| chord | grade leans warm on major chords, cool on minor |
| section | camera moves to a new shot; the bridge pulls focus to the train line and sends a train through |
| kick | fountains leap, a whisper of exposure in the grade |
| hi-hat | neon signs flicker now and then |
| section | birds are startled into a wide sweep |
| bar gusts | bunting and laundry ripple harder |

## The city

Everything is generated from the seed, chunk by chunk, as the camera drifts:

- **Waterfront:** a canal with animated painted water, stone quay walls and mooring posts; arched stone
  bridges at every avenue plus footbridges; moored boats, some with canopies and lanterns; rowing
  boats drifting past with passengers; wall lanterns whose light streaks across the water at night.
- **Promenade:** paved quay with iron railings, landing steps, lamps, trees in stone rings, benches
  facing the water, kiosks and a flower-bed hedge, then gardens toward the camera.
- **Streets:** asphalt with dashed centre lines, zebra crossings, kerbed sidewalks, street lamps with
  light pools at night, street trees, benches, hydrants, post boxes, planters, bins and bicycles; parked
  cars on the avenue and traffic with headlights on the cross streets; bunting and festoon lights strung
  across streets and the canal.
- **Markets:** paved squares of striped stalls with crates of fruit, hanging lanterns and shoppers.
- **Parks:** lawns with gravel paths, trees, benches and lamps, often a fountain that sprays on the kick.
- **Facades:** shopfronts with lit display windows, doors, striped scalloped awnings and painted shop
  boards; café tables with umbrellas; shutters, curtains, sills, arched window heads, flower boxes,
  balconies with potted plants, string courses, fire escapes and neon blade signs. Windows glow in warm
  tints at night and a few flicker blue with TV light.
- **Rooftops:** water towers, stair bulkheads, AC units, antennas, smoking chimneys, solar panels,
  satellite dishes, skylights, glass greenhouses, patio umbrellas, gardens with string lights, laundry
  that sways in the wind and lit billboards.
- **Sky and life:** bird flocks that beat their wings in time, chimney smoke drifting with the wind,
  fireflies over the water after dark, falling leaves, the elevated train and the hazy skyline.

## The journey

The camera travels forward through the city along a central corridor that changes every few blocks:

- **Canal**: a boat-height glide past facades on both banks, under bunting and over stone bridges,
  with the city reflected in the water.
- **Street**: lamps, trees, parked cars, café tables and awnings on both sides.
- **Market lane**: rows of striped stalls under a canopy of festoon lights.
- **Park avenue**: lawns, tree rows, benches and a fountain.

Both banks are generated (the far bank is a mirrored chunk with its own seed), so every district has
buildings facing it on both sides. Section changes switch between the ground-level ride, a drone flight
over the rooftops and a high vista with the train overtaking.

## Rendering

- Soft PCF shadows from a 4096² shadow map that follows the camera ahead
- Screen-space ambient occlusion, pooled toward the palette's lilac instead of grey
- Screen-space god rays from the sun through the skyline and buildings
- Bloom on neon, lit windows, lamps and water glints (stronger at night)
- Real planar reflections in the canal, rippled and painted over
- Sun-tinted rim light
- Procedural world-space surface detail: plaster washes and rain streaks, brick courses and mortar,
  dressed stone, wood grain, roof gravel, cracked asphalt, paving slabs, dappled foliage, glazed
  tiles, bark and grass
- Windows ray-cast furnished rooms behind reflective glass
- 4× MSAA HDR render target, depth of field, pastel grade, light leak that follows the sun, grain

The time of day cycles independently (golden hour → dusk → night → dawn → day, 20 minutes by default).

### Source map

- `src/music/theory.ts`: jazz progressions, voicings and voice leading
- `src/music/engine.ts`: the band (FM keys, boom-bap drums, bass, melody, vinyl crackle) and arrangement
- `src/world/city.ts`: chunked procedural city (districts, buildings, rooftop props, viaduct)
- `src/world/geo.ts`: merges each chunk into a few draw calls; inverted-hull ink outlines
- `src/world/textures.ts`: canvas-drawn sign atlas (shop, neon and Chinese signs, murals), brush grain, leaves
- `src/world/hoods.ts`: neighbourhoods and corridor districts
- `src/world/transport.ts`: traffic lanes, buses, trams and trains; `src/world/rail.ts`: the curved railway
- `src/world/surfaces.ts`: procedural surface textures; `src/world/windows.ts`: glass and interiors
- `src/world/water.ts`: reflective canal
- `src/world/sky.ts`: sky dome and the hazy distant skyline
- `src/fx/post.ts`: one-pass depth of field, pastel grade, light leak, paper grain and vignette
- `src/palette.ts`: time-of-day palettes and sun path

## URL options

| Param | Effect |
| --- | --- |
| `?seed=123` | reproduce a world (the current seed is always written to the URL) |
| `?t=0.35` | freeze time of day (`0` golden hour, `0.16` dusk, `0.35` night, `0.78` day) |
| `?day=600` | seconds per day/night cycle |
| `?shot=vista` | lock the camera to a shot: `canal` (ground ride), `rooftops`, `vista` |
| `?x=400` | start further along the city |
| `?silent` | visuals only, driven by the same sequencer without audio |
| `?train` | send a train through immediately |
| `?nopost` | skip post-processing (debug) |
| `?cam=x,y,z,tx,ty,tz` | fixed debug camera (offsets from the drift position) |

Keys: `M` mute, `H` hide HUD, `F` fullscreen.

## Neighbourhoods

The city cycles through seven neighbourhoods (each visited once per cycle, in a seeded order), four
chunks at a time. Each sets the palette, building material, heights, roof style, signage and what's
strung over the street, and picks what fills the corridor (canal, street, market lane or park avenue):

| Neighbourhood | Character |
| --- | --- |
| Old town | pastel plaster, shopfronts and awnings, festoon bulbs |
| Chinatown | red and gold facades, glazed pagoda roofs with upturned eaves, a paifang gate over the corridor, paper-lantern strings, Chinese signs |
| Harbour | low brick warehouses with sawtooth roofs and tall chimneys, container yards with gantry cranes |
| Neon | tall dark facades traced with neon strips, neon tube festoons, blade signs everywhere |
| Arts | saturated colours and big painted murals on gable walls |
| Garden | stone houses under ivy, lawns, ponds and gazebos |
| Parkland | mostly parks: tree-lined avenues, fountains, ponds |

## Transport

- **Railway:** a curved elevated viaduct (`src/world/rail.ts`) sweeps across the whole city and over the
  canal. Two trains run in opposite directions every half-minute or so, and more are sent on section
  changes. The articulated cars have rounded roofs, lit window bands, doors, bogies, cab noses with
  headlights and pantographs. Buildings under the viaduct stay low, like railway arches, and pillars
  keep clear of roads and the corridor.
- **Trams:** articulated trams run both ways on the tram street, on tracks with overhead wires, and
  pause at shelters.
- **Buses, cars, vans and taxis:** these share the bus street and the corridor's street districts.
- **No clipping:** road vehicles follow the one in front and keep a hard minimum gap. A 5-minute
  simulation never let any gap drop below 0.9 units.

## Mobile

On phones the renderer uses a lower pixel ratio, smaller shadow maps and a lighter depth-of-field pass,
falls back to 8-bit render targets where half-float isn't supported, and shows on-screen mute and
fullscreen buttons. On iPhone, the silent switch mutes web audio.
