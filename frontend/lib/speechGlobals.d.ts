// Web Speech recognition is not in the default DOM lib types; hriVoice.ts casts it to its own shape.
interface Window {
  SpeechRecognition?: unknown
  webkitSpeechRecognition?: unknown
}
