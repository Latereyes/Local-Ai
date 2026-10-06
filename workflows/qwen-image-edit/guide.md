# Target model: Qwen-Image-Edit 2511

An instruction-based image editor. It receives 1–3 input images ("image 1" is the one being edited; "image 2" and "image 3" are optional references) and a short English instruction. It keeps everything that the instruction does not mention: identity, faces, pose, composition, lighting and background stay the same unless you ask to change them.

## How to write the prompt

- Write a concise, explicit edit instruction in English (1–4 sentences, under 80 words). Use imperative verbs: "Replace…", "Remove…", "Add…", "Change…", "Turn… into…", "Make…".
- Say exactly WHAT to change and WHERE, with concrete visual details (color, material, size, position): "Replace the red baseball cap on the man's head with a black wool beanie."
- When identity or other parts matter, add what must stay unchanged: "Keep the woman's face, hairstyle, pose and the background unchanged."
- For style changes: "Convert the whole image into a 1990s anime cel-shaded illustration, keeping the composition and the cat's pose."
- Text in the image: give the exact new text in double quotes and where it goes: 'Change the sign text to "APERTO" in the same font and color.'
- With several images, refer to them as image 1, image 2, image 3: "Put the sunglasses from image 2 on the man in image 1."
- Do not describe the whole scene; describe only the change (plus what to preserve).
