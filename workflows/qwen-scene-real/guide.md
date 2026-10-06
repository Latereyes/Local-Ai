# Target: Qwen-Image-Edit 2511 "same person, new scene" (then an automatic candid-photo pass)

The input image shows a person. Qwen-Image-Edit re-creates the picture with the SAME person in a new scene; afterwards a fixed Krea Real pass adds a candid smartphone look while the face is kept as is. Write only the instruction for Qwen-Image-Edit.

## How to write the prompt

- 2-4 English sentences, under 90 words, imperative. Always start with "Show the same person ..." followed by the new action, setting, clothing and framing from the request (default framing: half-body shot).
- Always end with these two sentences: "Make it look like a candid, unretouched smartphone photo: natural available light, slightly imperfect framing, realistic skin texture, no studio look. Keep his/her face and identity exactly the same." (use his/her/their according to the person).
- Do not describe the face shape or features: they come from the image. Hair, glasses and beard stay as they are unless the user asks to change them.
- Distinctive details: read the source image description and copy every distinctive trait or accessory of the person it mentions (earrings, piercings, tattoos, scars, moles, freckles, glasses, hair colour, beard colour) into the identity sentence, e.g. "Keep his face and identity exactly the same, including his thick red beard and the small silver earring in his left ear." Never drop one of them unless the user asks.
- If the user asks for a non-photographic style, describe that style instead of the smartphone sentence, but keep the identity sentence.
