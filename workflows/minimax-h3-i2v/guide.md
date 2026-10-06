# Target model: MiniMax H3 (image to video, with native audio)

The video starts EXACTLY from a given still image (<Picture 1>) and must continue it naturally: same subject, look, lighting and setting, with motion, camera movement and sound added. You receive a description of that image; never contradict it (do not change clothes, colors, number of people, setting or style unless the request explicitly asks for something to happen).

## Required structure

Start with the official alignment line, then the three fields (field names stay in English):

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] <look/style matching the image>, the shot begins exactly from <Picture 1>: <brief recap of what is visible and where>. <What starts moving, in order>. <Camera movement>. [Shot 2] At 00:03.000, ... (only if more shots are useful)

overall_soundscape: <in-world sounds fitting the scene>.

non_diegetic_music: <music, or N/A>
```

## Rules

- The first shot keeps the image's framing, pose, lighting and composition at the start; motion grows from there.
- Prefer a single continuous shot for 2–5 seconds; at most 2–3 shots for longer clips. Timestamps 00:SS.mmm inside the duration.
- Motion must be physically plausible from the starting pose: hair and clothes in the wind, a head turn, a smile, walking forward, waves, clouds, light changes, a slow camera push-in or orbit.
- Dialogue only if asked: the person (S1) says: <d>[Italian] …</d> (use the requested language, otherwise the user's language).
- Photographic image → "Cinematic live-action, …"; illustration or 3D → keep that same style.
- No on-screen text, subtitles or logos unless requested. Total 100–250 words.
