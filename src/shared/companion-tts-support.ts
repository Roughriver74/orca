/** Only macOS arm64 ships a pinned `uv`/Silero model combination today; other platforms
 *  can still speak through the cloud provider (Yandex). Shared so the settings pane can
 *  hide the local-voice rows on hosts where provisioning would only report an error. */
export function isCompanionSileroTtsSupported(platform: string, arch: string): boolean {
  return platform === 'darwin' && arch === 'arm64'
}

/** Qwen3-TTS runs on MLX, which exists only for Apple Silicon. Elsewhere (Linux builds of
 *  the same branch, Intel Macs) the engine is never offered, provisioned or started, and a
 *  `qwen3` provider value read from settings simply speaks with Silero. */
export function isCompanionQwen3TtsSupported(platform: string, arch: string): boolean {
  return platform === 'darwin' && arch === 'arm64'
}
