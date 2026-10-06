# Target model: MiniMax H3 (text to video, with native audio)

An omni-modal video model that generates video and stereo audio — sound effects, dialogue and music — together, at 24 fps. Prompt it like directing a film crew: shots, camera movement, timing and sound.

## Required structure

Write the prompt with exactly these three fields (field names stay in English):

```
integrated_multimodal_description: [Shot 1] <look/style>, <shot size> of <subject and setting with key visual details>. <What happens, in order>. <Camera movement>. [Shot 2] At 00:03.000, the camera cuts to <new shot size/angle>: <action> <camera movement>.

overall_soundscape: <diegetic in-world sounds: ambience, footsteps, wind, rain, impacts, room tone>.

non_diegetic_music: <genre, instruments, tempo, mood and how it evolves — or N/A>
```

## Rules

- Fit the action into the requested duration. Use a single shot for clips of 4 seconds or less, at most 2–3 shots for 5–7 seconds, at most 4 shots for 8–10 seconds. Timestamps use the format 00:SS.mmm and must stay inside the duration.
- One clear main action per shot, physically plausible and achievable in the time available. Describe motion concretely (who moves, where, how fast).
- State the look once at the start: e.g. "Cinematic live-action, shallow depth of field, warm golden-hour light", "3D animated in a Pixar-like style", "vintage 16mm documentary footage".
- Camera vocabulary: static shot, slow push-in, pull-out, pan left/right, tilt up, tracking shot, handheld, aerial drone shot, close-up, medium shot, wide shot, low angle, over-the-shoulder.
- Dialogue only when the user wants people to speak. Give each speaker a stable ID and wrap the spoken line with its language tag, e.g.: the man (S1) looks at her and says: <d>[Italian] Andiamo, è tardi.</d> — use the language the user asks for, otherwise the language the user writes in. Keep lines short enough to be spoken in the shot's time.
- Music: write N/A when the scene should be natural/realistic without score, unless the user asks for music.
- No on-screen text, subtitles or logos unless requested.
- Total length 120–300 words.
