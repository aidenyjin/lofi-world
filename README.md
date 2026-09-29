# lofi world

A procedurally generated rooftop city that lives in sync with procedurally generated lofi.
The style is Cult of the Lamb crossed with Chillhop: a tilted 3D diorama with flat, ink-outlined cut-out
characters, pastel sun-bleached colour, heavy haze and depth of field.

```
npm install
npm run dev      # http://localhost:5173, then click "tune in"
npm run build    # static site in dist/
```

## How it fits together

```
music/engine.ts ──emits──▶ events.ts (bus) ──▶ world/world.ts
  Tone.js band               beat · bar · chord       camera director, palette,
  on the audio clock         section · kick · hat     leaves, train, residents, post
```

The music engine is the conductor. Every event is scheduled on the audio clock and delivered through
`Tone.Draw`, so the world reacts to the beat you hear rather than the one being scheduled ahead.

| Music | World |
| --- | --- |
| beat | residents nod, string lights and lamp pools breathe at night, boats bob, water glints |
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
  that sways in the wind, lit billboards and residents.
- **Sky and life:** bird flocks that beat their wings in time, chimney smoke drifting with the wind,
  fireflies over the water after dark, falling leaves, the elevated train and the hazy skyline.

The time of day cycles independently (golden hour → dusk → night → dawn → day, 20 minutes by default).

### Source map

- `src/music/theory.ts`: jazz progressions, voicings and voice leading
- `src/music/engine.ts`: the band (FM keys, boom-bap drums, bass, melody, vinyl crackle) and arrangement
- `src/world/city.ts`: chunked procedural city (buildings, rooftop props, residents, train line)
- `src/world/geo.ts`: merges each chunk into a few draw calls; inverted-hull ink outlines
- `src/world/textures.ts`: canvas-drawn placeholders (characters, signs, brush grain, leaves)
- `src/world/sky.ts`: sky dome and the hazy distant skyline
- `src/fx/post.ts`: one-pass depth of field, pastel grade, light leak, paper grain and vignette
- `src/palette.ts`: time-of-day palettes and sun path

## URL options

| Param | Effect |
| --- | --- |
| `?seed=123` | reproduce a world (the current seed is always written to the URL) |
| `?t=0.35` | freeze time of day (`0` golden hour, `0.16` dusk, `0.35` night, `0.78` day) |
| `?day=600` | seconds per day/night cycle |
| `?shot=vista` | lock the camera to a shot: `rooftops`, `city`, `vista` |
| `?silent` | visuals only, driven by the same sequencer without audio |
| `?train` | send a train through immediately |
| `?nopost` | skip post-processing (debug) |
| `?cam=x,y,z,tx,ty,tz` | fixed debug camera (offsets from the drift position) |

Keys: `M` mute, `H` hide HUD, `F` fullscreen.

## Characters

Rooftop residents are hand-painted gouache cut-outs in `public/sprites/`, listed in `src/world/cast.ts`.
They were generated with Krea 2 Turbo and the `ilkerzgi/krea-2-bold-gouache-urban-sketch-lora` style LoRA
(`tools/sprites/generate.py`), then cut out with `tools/sprites/cutout.py`. To add one, cut out a
transparent image (feet at the bottom), put it in `public/sprites/`, and add an entry to `CAST`.
Generate the whole cast in one pass on one backend so the style stays consistent.

## Mobile

On phones the renderer uses a lower pixel ratio, smaller shadow maps and a lighter depth-of-field pass,
falls back to 8-bit render targets where half-float isn't supported, and shows on-screen mute and
fullscreen buttons. On iPhone, the silent switch mutes web audio.
