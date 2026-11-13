# Screen recording (record screen / manual record) and its sound

`lib/useScreenRecorder.ts` records the dashboard tab to `.webm`: one segment per plan run (the **record screen**
checkbox) or a manual clip (**record**). Files go to the granted folder, else the browser's Downloads, named after the
run (`<run>_succeed.webm`). `getDisplayMedia` needs a click and a share dialog, so a one-time confirmation is unavoidable.

## Sound (2026-11-12, branch `feat/record-audio`)

Until then the recorder asked for video only (`audio: false`), so every file was silent. `lib/recordAudio.ts` now:

| Source | How | Notes |
|---|---|---|
| **Tab audio** (default on) | `getDisplayMedia({audio: true, preferCurrentTab, systemAudio: 'include'})` | In Chrome's share dialog tick **Also share tab audio**; without it the toggles show a note and the clip is silent. The page stays audible (`suppressLocalAudioPlayback: false`). Earcons, the 119 alarm and any `<audio>` are WebAudio / media sound and are recorded. |
| **Microphone** (default off) | `getUserMedia` with echo cancellation, noise suppression, auto gain | The user's voice in qa / ask. The tab's sound comes out of the speakers and into the mic again, hence the echo cancellation. A refused mic is noted and the recording goes on. |

Tab audio alone is recorded as it is (the shared stream's own audio track, no mixer: one thing less that can stay
silent); with the microphone too, both are mixed with WebAudio into **one audio track** (`buildRecordingStream`), and
`MediaRecorder` gets that stream (`video/webm;codecs=vp9,opus` first). The choices are in `localStorage` (`robotapp_record_tab_audio`,
`robotapp_record_mic`) and are edited by `components/RecordAudioToggles.tsx`, next to the record controls; they apply
from the next recording. Notes (no audio track, mic refused) reach the toggles through the `robotapp:record-audio-note`
window event; at every start the toggles also say what the recording carries ("Recording with sound: tab audio." /
"This recording has NO sound.").

**The robot's spoken lines are the open question.** They come from `speechSynthesis`, whose output Chrome often leaves
out of tab audio (the robot's own speaker, `source='robot'`, is outside the browser and is never recorded). The
**audio test** button measures it on the machine in use (5 s: shares the tab with its audio, plays a beep through
WebAudio and says a sentence, reports the level of each). If the spoken line is *not recorded*, the lines have to be
played from an `<audio>` / WebAudio source (backend text-to-speech endpoint + `useVoiceOutput` / `speakAndWait`
change): not done yet, only needed if the test says so.

Test by hand: tick **record screen**, share "This tab" with tab audio, run `announce::안녕하세요` with 🔊 voice on, stop,
play the `.webm`. Repeat with 🎤 mic ticked and say something.
