# Screen recording (record screen / manual record) and its sound

`lib/useScreenRecorder.ts` records the dashboard tab to `.webm`: one segment per plan run (the **record screen**
checkbox) or a manual clip (**record**). Files go to the granted folder, else the browser's Downloads, named after the
run (`<run>_succeed.webm`). `getDisplayMedia` needs a click and a share dialog, so a one-time confirmation is unavoidable.

## Sound

Until 2026-11-12 the recorder asked for video only (`audio: false`), so every file was silent. `lib/recordAudio.ts` now has
three **sound sources**, picked next to 🔊 sound (`robotapp_record_audio_source`):

| Source | What is recorded | Notes |
|---|---|---|
| **direct** (default) | the robot's spoken lines, the earcons / alarm, and your spoken answers when 🎤 is ticked | Works on every OS and browser, no "share audio" tick. The app makes the sound itself (below). The lines come from the backend, `GET /tts` (gTTS: the backend machine needs the internet), so their voice is gTTS's, not the browser's. |
| tab | this tab's audio | The share dialog needs **Also share tab audio**. Chrome often leaves `speechSynthesis` out of tab audio (a real run's Korean `announce` was silent for 20 s; only the earcon was in the clip). Tab audio alone is recorded as the shared stream, no mixer. |
| whole system | everything the computer plays | "Entire screen" + "Also share system audio" (Windows / ChromeOS); records the whole screen. |

### How direct works

`useScreenRecorder` creates an `AudioContext` **in the click** (autoplay policy), shares video only (`getDisplayMedia`
`audio: false`), and `buildRecordingStream` makes a `MediaStreamAudioDestinationNode` whose track is the recording's only
audio (a silent `ConstantSourceNode` keeps samples flowing: with nothing connected the recorder wrote an empty file). It installs the context as the **voice sink** (`lib/recordVoice.ts`):

- `speakAndWait` (the HRI `speak` lines) and `useVoiceOutput.speak` (narration) fetch the sentence as audio
  (`api.ttsAudio`), play it with a media element wired into the destination (recorded) and `ctx.destination` (heard). The line's speed
  (`HRI_CONFIGS.speech_rate`) is the element's `playbackRate` with `preservesPitch`: an `AudioBufferSourceNode`'s rate raises the
  pitch (rate 1.3 made the Korean voice sound distorted, 2026-11-13); measured in a recording: rate 1.5 -> 1.07 s instead of 1.6 s, still 500 Hz. Narration
  supersedes the line still playing, as with the browser voice. If the fetch fails the browser's voice is used and the
  toggles say once "Robot voice NOT recorded: …" (old backend without `/tts`, no internet for gTTS).
- `playEarcon` / `playAlarm` make their tones in the sink's context.
- **Your voice** (🎤 ticked): not a second always-open microphone (that one was silent on a real machine, and would add the room's
  noise and the robot's voice from the speakers). The stream `recordPhrase` already opens for each listen, the one Whisper
  hears, is tapped into the destination for the length of the listen (`recordVoice.tapMic`, not routed to the speakers). The
  clip therefore has exactly your answers. Measured with a fake microphone: nothing in the listen window with 🎤 off, the
  signal in it with 🎤 on, and the answer still posted to the backend. A browser-recognition listen (`capture: 'browser'`) is not tapped.
- With no recording running there is no sink and nothing changes: `speechSynthesis`.

The **audio test** (direct: no share dialog) has the backend say a Korean and an English sentence into the graph and
reports the level on the recording's track, or why it failed. For tab / system it shares the tab / screen, plays a beep
and says one sentence per language.

Test by hand: restart the backend (it needs `GET /tts`), tick **record screen**, run `announce::안녕하세요`, stop, play the
`.webm`; again with 🎤 mic ticked, saying something while `ask::` listens. The robot's own speaker (`source='robot'`) is
outside the browser and is never recorded.
