# Video Oscillations

A standalone color adaptation of [freqPhaseMod](https://lab.palomakop.tv/freqphasemod/) by [Paloma Kop](https://palomakop.tv/).

## Use

Allow camera access, choose **color 1** and **color 2**, and adjust the original oscillator controls. Each endpoint has seven rainbow swatches from the supplied Downfold palette, plus a native picker for any color. **Swap colors** reverses the gradient; **black & white** restores the original appearance. Effect presets leave your selected colors unchanged. **Save image** exports the colored output as PNG.

The original phase/frequency modulation, seven presets, six waveforms, blur, contrast, inversion, source preview, camera switching, and collapsible controls are preserved. The source preview remains grayscale to show the luminance driving modulation. Camera processing runs locally in your browser; no images are uploaded.

Requires WebGL 2 and camera access over HTTPS or localhost. Frequency modulation additionally requires floating-point render targets; unsupported devices retain phase modulation.

## Development and GitHub Pages

No dependencies or build step. Run `python3 -m http.server 8000` and open `http://localhost:8000`. In GitHub Settings → Pages, deploy from the `main` branch, `/ (root)`. Relative asset URLs support project Pages paths.

## Source and license

Adapted from [`src/freqPhaseMod.liquid`](https://github.com/palomakop/lab/blob/3a2f809e69a387ebadd72c430af95e9c721795f3/src/freqPhaseMod.liquid) in `palomakop/lab`, revision `3a2f809e69a387ebadd72c430af95e9c721795f3`, retrieved September 18, 2026. This repository extracts that individual experiment rather than copying the entire lab website.

Changes: extracted HTML, CSS, and JavaScript into standalone files; replaced grayscale oscillator output with shader interpolation between two selected RGB colors; added rainbow swatches, custom pickers, swap and grayscale actions; updated attribution and camera error handling; disabled unsupported FM controls. The seven primary rainbow hex values were copied from the user-supplied `tokens.css`; the rest of that file was not imported.

Original work by Paloma Kop. This adaptation retains **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**. See [LICENSE](LICENSE) and [the license page](https://creativecommons.org/licenses/by-nc-sa/4.0/).
