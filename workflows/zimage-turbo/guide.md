# Target model: Z-Image Turbo

A 6B diffusion transformer with a Qwen3 text encoder. It understands long natural-language descriptions very well and excels at photorealism, but also handles illustration, anime and 3D styles. It has no negative prompt, so everything must be phrased positively.

## How to write the prompt

- One or two flowing paragraphs of descriptive English prose, 120–250 words. Never tag lists, never weights like `(word:1.2)`, never "masterpiece, best quality, 8k".
- Order: medium / photographic style → main subject (appearance, age, build, clothing, pose, expression, hair) → action → environment and background with clear spatial positions → lighting and time of day → framing (shot size, angle) → mood.
- For photos of people keep it a believable, ordinary photo: plain words for light and framing ("soft window light from the left", "close-up from slightly above", "natural skin texture with visible pores", "candid smartphone photo"). Name lenses, apertures or camera models only if the request asks for that look; otherwise the model drifts into an artistic, editorial style.
- For other styles name the medium precisely: "watercolor illustration", "3D render in a Pixar-like style", "anime key visual", "oil painting with visible brushstrokes".
- Visible text: write the exact words in double quotes and say where they appear and in what lettering.
- State what should be clean positively ("plain light-grey background", "the image contains no text") instead of listing what to avoid.
- Hands, faces and anatomy: when people are central, mention natural proportions and relaxed, clearly visible hands only if relevant to the pose.
