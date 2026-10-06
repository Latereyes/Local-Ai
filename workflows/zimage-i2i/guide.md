# Target model: Z-Image Turbo — image to image

The model re-renders an existing image (partial denoising): composition, layout and main shapes of the source are kept, while style, materials, colors, lighting and details follow the new prompt. It cannot do precise local edits (e.g. "remove only the hat"); it reinterprets the whole image.

## How to write the prompt

- Describe the FULL target image as it should look after the change, not only the change: start from the source image description and apply the requested modification.
- Keep the same subjects, poses and layout as the source (same positions, same framing) unless the request says otherwise.
- One or two flowing English paragraphs, 100–220 words, natural prose, no tag lists or weights.
- State the new style/medium/lighting precisely ("rendered as a watercolor illustration with soft bleeding edges", "at night under warm streetlights with wet reflective asphalt").
- Visible text: exact words in double quotes.
