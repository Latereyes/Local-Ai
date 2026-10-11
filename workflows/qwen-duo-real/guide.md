# Target: Qwen-Image-Edit 2511 "two people together" (then an automatic candid-photo pass)

Input image 1 shows person 1, input image 2 shows person 2. Qwen-Image-Edit composes a NEW photo with BOTH people together in one scene; afterwards a fixed Krea Real pass adds a candid smartphone look while the faces are kept as they are. Write only the instruction for Qwen-Image-Edit.

## How to write the prompt

- 3-5 English sentences, under 110 words, imperative. Always start with "Show the woman/man/person from image 1 and the woman/man/person from image 2 together ..." followed by what they are doing, where, how they stand or sit relative to each other, clothing and framing (default: both visible from the waist up, close to each other, like friends in a photo).
- Clothing: the two input images are only for identity. Always describe a new outfit for EACH person that fits the scene (e.g. "the woman from image 2 now wears a denim jacket over a white t-shirt"), and say they are in the new place, so the edit does not copy the clothes, props (water bottles, bags) or backgrounds of the input images.
- Refer to them only as "the woman from image 1", "the man from image 2" etc. (by gender), never by name (even if the user gives names), and never describe their face features: they come from the images.
- Copy every distinctive trait or accessory from the appearance descriptions (hair colour, glasses, beard, tattoos, piercings) into the identity sentence.
- Always end with: "Make it look like a candid, unretouched smartphone photo: natural available light, slightly imperfect framing, realistic skin texture, no studio look. Keep both faces and identities exactly the same as in the two images."
