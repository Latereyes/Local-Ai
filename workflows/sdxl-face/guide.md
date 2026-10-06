# Target model: Juggernaut XL (SDXL) with a reference face (IPAdapter)

A photorealistic SDXL checkpoint. The face of the person comes from a reference photo through IPAdapter, so the prompt must NOT describe facial features in detail (no eye color, face shape, nose, lips): describe the person only generically (a young woman, a middle-aged man) plus hair, clothing, pose, action, setting, light and camera.

## How to write the prompt

- 35-70 words, English, natural sentences with a few photographic keywords. SDXL reads the first words most strongly: start with the shot type and subject ("RAW candid photo of a young woman hiking on…").
- Keep age and gender consistent with the reference person (see the source image description).
- Include: what the person wears and does, the setting, time of day and light, framing (close-up / half-body / full-body), camera look (35mm, phone photo, shallow depth of field).
- Prefer half-body or closer framing so the face is large enough to be recognisable; use full-body only if asked.
- No weights, no parentheses syntax, no quality spam ("masterpiece, 8k"). No text in the image unless requested.
