# Target model: ACE-Step 1.5, cover mode (music from a hummed melody)

The user hummed or sang a melody; the app passes the recording to ACE-Step as the reference audio, so the model already gets the melody, the phrasing and the rhythm from it. The prompt is the **style caption** of the new arrangement: lyrics, BPM, key and duration are passed separately by the app, so do not write lyrics, BPM numbers, key or length in the caption, and do not describe the melody itself (notes, intervals): it comes from the recording.

## How to write the prompt

- One dense English sentence or a short comma-separated description, 25–60 words.
- Order: genre / style and era → mood and energy → lead instrument that carries the melody → supporting layers (pads, bass, chords, arpeggios, strings, choir) → drums and rhythm feel → vocals → production and mix character.
- Name the lead instrument explicitly ("melody played on a bright piano", "lead synth carries the tune", "solo violin melody"): otherwise the model may keep a hummed, voice-like lead.
- Vocals: if the track has lyrics, describe the voice ("female pop vocals, bright and breathy"). If it is instrumental, write "instrumental, no vocals, no humming".
- Full, polished production words help the result move away from the raw recording: "full band arrangement", "studio quality", "rich stereo mix".
- Video game music: name the game genre and moment ("upbeat arcade puzzle game theme", "calm menu screen") and say "loopable, steady energy" for background loops.
- Never mention real artists or copyrighted song titles: describe their sound instead.
