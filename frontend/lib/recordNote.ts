'use client'
// A one-line message for the toggles next to the record button (lib/recordAudio.ts, components/RecordAudioToggles.tsx):
// what the recording carries, or why it does not carry sound. A window event, so no component has to pass props around.
export const NOTE_EVENT = 'robotapp:record-audio-note'

export function noteRecordingAudio(msg: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTE_EVENT, { detail: msg }))
}
