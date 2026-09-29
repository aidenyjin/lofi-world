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
| beat | rooftop residents nod, string lights breathe at night |
| kick | a whisper of exposure in the grade |
| hi-hat | leaves flutter |
| bar | a wind gust through the leaves (bigger every 4 bars) |
| chord | grade leans warm on major chords, cool on minor |
| section | camera moves to a new shot; the bridge pulls focus to the train line and sends a train through |

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

Keys: `M` mute, `H` hide HUD, `F` fullscreen.

## Replacing placeholder art

The characters and signs are drawn on canvases at runtime (`src/world/textures.ts`). To use real art,
return a texture loaded from a PNG in `characterTexture()` instead. The sprites are camera-facing cut-outs
anchored at their feet, so any transparent PNG of a character works.
