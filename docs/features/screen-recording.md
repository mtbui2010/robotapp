# Screen recording (record screen / manual record) and its sound

`lib/useScreenRecorder.ts` records the dashboard tab to `.webm`: one segment per plan run (the **record screen**
checkbox) or a manual clip (**record**). Files go to the granted folder, else the browser's Downloads, named after the
run (`<run>_succeed.webm`). `getDisplayMedia` needs a click and a share dialog, so a one-time confirmation is unavoidable.

## Sound

Until 2026-11-12 the recorder asked for video only (`audio: false`), so every file was silent. `lib/recordAudio.ts` has three
**sound sources**, picked in the popover of the one **`⋯` button** next to *rec screen* (it also holds *record sound*, 🎤 *your
answers* and the *audio test*, and shows a dot: green = the last recording carries sound, amber = it does not; `robotapp_record_audio_source_v2`; the default is **system** on Windows / ChromeOS,
else **direct**). **What the user hears never changes:** the robot speaks with the browser's own voice, with or without a
recording.

| Source | What the file gets | Notes |
|---|---|---|
| **system** | everything the computer plays: the robot's voice is the SAME browser voice | The share dialog is for a screen: choose "Entire screen" and tick "Also share system audio" (Windows / ChromeOS only); the whole screen is recorded. Without the tick the toggles say "No system audio". |
| **direct** | the backend's voice of the same lines (`GET /tts`, gTTS), and the earcons | Works on every OS and browser, no "share audio" tick. The file's voice differs from the one heard: gTTS, not the browser's. The backend machine needs the internet. |
| tab | this tab's audio | Needs **Also share tab audio**. Chrome often leaves `speechSynthesis` out of tab audio (a real run's Korean `announce` was silent for 20 s; only the earcon was in the clip). |

With a source that shares audio (system / tab) and no 🎤, the shared stream is recorded as it is (no mixer to stay silent).

### Your answers (🎤)

In every source, with 🎤 ticked, the stream `recordPhrase` opens for each listen (the one Whisper hears) is tapped into the
recording for the length of the listen (`recordVoice.tapMic`, not routed to the speakers): the clip has exactly your answers,
without room noise or the robot's voice from the speakers (an always-open second microphone was silent on a real machine). The
shared sound and the answers are mixed into one track (`ctx` made in the click: autoplay policy; a silent `ConstantSourceNode`
keeps samples flowing — a track with none made the recorder write an empty file). A browser-recognition listen
(`capture: 'browser'`) is not tapped; an answer clicked on the screen has no voice.

### How direct works

`useScreenRecorder` creates an `AudioContext` **in the click**, shares video only (`audio: false`), and installs it as the
**voice sink** (`lib/recordVoice.ts`): `speakAndWait` and `useVoiceOutput.speak` say the line with the browser's voice as
always and ALSO fetch the backend's voice of it (`api.ttsAudio`) and play it with a media element wired into the recording
only (speed: `playbackRate` with `preservesPitch`; a buffer source's rate raised the pitch and made it distorted). The listen
waits for both to end. `playEarcon` / `playAlarm` make their tones in the sink's context (heard and recorded). If the fetch
fails the toggles say once "Robot voice NOT recorded: …" (old backend without `/tts`, no internet for gTTS) and the line is
simply not in the file.

The **audio test** (direct: no share dialog) has the backend say a Korean and an English sentence into the graph and reports the
level on the recording's track, or why it failed. For system / tab it shares the screen / tab, plays a beep and says one
sentence per language through the browser's voice: it tells whether the browser's voice reaches the file in that source.

Test by hand: restart the backend (direct needs `GET /tts`), tick **record screen**, run `announce::안녕하세요`, stop, play the
`.webm`; again with 🎤 ticked, answering an `ask::`. The robot's own speaker (`source='robot'`) is outside the browser and is
never recorded.

**Quick buttons** (the pose / skill buttons under the camera): a click never starts this recording, even with *rec screen* ticked (2026-11-18); a run typed in the Agent panel does.
