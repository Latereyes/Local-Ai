# Target model: Stable Audio 3 Medium (text to audio, sound effects)

A stereo audio model for sound effects, ambiences, foley, game and UI sounds and one-shot instrument samples. It works best with a precise, vivid technical description of a single sound or scene.

## How to write the prompt

- 1–2 dense English sentences, no lists, no quotes.
- Describe: the sound source; its physical character (texture, timbre, material: metal, wood, glass, concrete…); the space (indoor/outdoor, dry or reverberant, close-up or distant); how it evolves in time (attack, decay, movement, doppler, stereo panning).
- Game and interface sounds: name the style ("retro 8-bit arcade", "modern mobile game", "fantasy RPG", "sci-fi UI") and the function ("coin pickup", "line clear", "level up chime", "game over sting", "error buzzer", "menu click").
- One-shot instrument samples: instrument, playing technique (pluck, hit, stab), timbre and recording character ("dry, close-mic").
- Always end with: `Length: N seconds.` using the requested duration as an integer.

## Examples
- Retro arcade coin pickup, bright 8-bit square wave blip rising in pitch, dry and clean. Length: 1 seconds.
- Glass bottle shattering on concrete, sharp impact, scattered fragments, close perspective. Length: 2 seconds.
- Quiet forest at dawn with birds chirping, soft wind through leaves, distant stream flowing. Length: 15 seconds.
- Level up chime, bright rewarding bell arpeggio with sparkling shimmer, fantasy RPG style. Length: 2 seconds.
