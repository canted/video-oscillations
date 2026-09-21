# Video Oscillations

A standalone color adaptation of [freqPhaseMod](https://lab.palomakop.tv/freqphasemod/) by [Paloma Kop](https://palomakop.tv/).

## Use

Allow camera access. The gradient starts with red at 0% and aqua at 100%.

- Tap the spectrum to add a color stop. Up to 16 stops are supported. With keyboard focus on the spectrum, Enter or Space adds a stop in the largest gap.
- Drag a stop to position it. Stops stay ordered and cannot overlap. Arrow keys move the focused stop by 1%, Shift+arrow by 10%; Home/End move it as far as its neighbors allow.
- Tap a stop to change its rainbow swatch, custom color, or shade. The shade slider runs from black (0%), through the exact color (50%), to white (100%).
- Double-tap a stop to remove it, or drag it down at least 64 pixels and release. A removal cue appears after crossing the threshold; dragging back before release cancels removal. At least two stops remain. Delete/Backspace also work on focused stops.
- **Stepping** expands pure-color plateaus and shrinks the eased blends between them. Only 100% stepping produces hard edges. The top spectrum shows the editable stop positions; **result** shows the gradient used by the video.

At full stepping, endpoint colors receive a full neighboring gap rather than half a gap. Interior widths use the average of their neighboring gaps; all widths are normalized to the output range when the first and last stops sit at 0% and 100%. Moving either endpoint inward preserves its solid-color tail: compensation extends beyond the visible range but never crops that tail. Thus 0–50–100 produces equal thirds, while 0–20–100 produces 13⅓%, 33⅓%, and 53⅓% stripes. Intermediate stepping gradually extends the outer domain and contracts each blend about its midpoint, using smoothstep interpolation so every blend meets its plateau gently.

Effect presets leave the gradient unchanged. **Save image** exports the result as PNG. Slider thumbs and stop handles have 44-pixel touch targets in a mobile-first stacked layout.

The original phase/frequency modulation, seven presets, six waveforms, blur, contrast, inversion, source preview, camera switching, and collapsible controls are preserved. The source preview remains grayscale to show the luminance driving modulation. Camera processing runs locally in your browser; no images are uploaded.

Requires WebGL 2 and camera access over HTTPS or localhost. Frequency modulation additionally requires floating-point render targets; unsupported devices retain phase modulation.

## Development and GitHub Pages

No dependencies or build step. Run the gradient geometry tests with `node --test tests/gradient.test.mjs`. Run `python3 -m http.server 8000` and open `http://localhost:8000`. In GitHub Settings → Pages, deploy from the `main` branch, `/ (root)`. Relative asset URLs support project Pages paths.

## Source and license

Adapted from [`src/freqPhaseMod.liquid`](https://github.com/palomakop/lab/blob/3a2f809e69a387ebadd72c430af95e9c721795f3/src/freqPhaseMod.liquid) in `palomakop/lab`, revision `3a2f809e69a387ebadd72c430af95e9c721795f3`, retrieved September 18, 2026. This repository extracts that individual experiment rather than copying the entire lab website.

Changes: extracted HTML, CSS, and JavaScript into standalone files; replaced grayscale oscillator output with an editable multi-stop gradient and compensated stepping; added rainbow swatches, custom pickers, per-stop shade controls, touch/keyboard editing, and a shared gradient model for the preview and shader; updated attribution and camera error handling; disabled unsupported FM controls. The seven primary rainbow hex values were copied from the user-supplied `tokens.css`; the rest of that file was not imported.

Original work by Paloma Kop. This adaptation retains **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**. See [LICENSE](LICENSE) and [the license page](https://creativecommons.org/licenses/by-nc-sa/4.0/).
