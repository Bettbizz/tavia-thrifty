# Tavia Thrifty brand

**Mark: the Round Seal** (chosen 2026-11-06). A Roman T inside an open gold ring. The ring is fine at the top and
heavy at the bottom, with an opening at the upper left and a small diamond in the opening ("second time around").
A stitched line runs inside the ring, like the seam of a garment (left off the app icon, where it's too small to see).

**Colours:** deep teal `#062F2D` (was night green `#0D1B17` until 6 Nov 2026), ivory `#F4EDE1`, ink `#13241F`, gold gradient `#F3E2B8 → #D2AE6A → #B08840 → #E6CC92`.
**Type:** Cinzel (name), Montserrat (tagline), both free (SIL Open Font License). Text is saved as shapes, so no fonts are needed to show the files.

| File | Use |
|---|---|
| `tavia-logo-dark*` | Main logo on night green (splash screen, signs) |
| `tavia-logo-light*` | On ivory / paper (receipts, printing) |
| `*-transparent*` | Same, with no background |
| `tavia-logo-wide-*` | Seal on the left, words on the right (receipts, headers) |
| `tavia-mark-gold*`, `tavia-mark-ink*` | The seal alone |
| `tavia-icon-512/192` | App and launcher icon |

Rebuild: in a folder with `fonts/` (Cinzel and Montserrat variable TTFs from github.com/google/fonts) run
`npm i opentype.js@1.3.4 @resvg/resvg-js@2.6.2` then `node source/seal.mjs <out-folder>`.

`ideas/` has the six first ideas side by side; `archive/needle/` keeps the first needle-and-thread draft.

## Splash / boot animation (`splash/`)

Open `splash/splash-preview.html` in a browser to watch it. Three parts, 30 frames a second:

1. **Start** (1.2 s, once): the ring draws itself round, the diamond pops in, the T fades in.
2. **Booting** (3.9 s, repeats until Android has started): the T turns one and a half times like a coin, slowly (3 s), stops, then the whole
   seal "booms" (swells, a glow, a ring of light, a shine across the T).
3. **Ready** (2.8 s, once at the end): the seal rises and shrinks, a last soft boom, TAVIA THRIFTY comes in letter
   by letter, the gold line grows out from the diamond, the tagline opens out. Holds half a second, then the launcher.

`splash/bootanimation.zip` is the Android boot animation (frames 900 x 900; re-made at the tablet's screen size
once it's known). Rebuild: `node source/build-anim.mjs <out> <size> --frames` (same tools as above).
`source/anim-core.mjs` draws every frame, so the preview and the boot frames always match.
