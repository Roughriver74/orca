/** Only macOS arm64 ships a pinned `uv`/Silero model combination today; other platforms
 *  can still speak through the cloud provider (Yandex). Shared so the settings pane can
 *  hide the local-voice rows on hosts where provisioning would only report an error. */
export function isCompanionSileroTtsSupported(platform: string, arch: string): boolean {
  return platform === 'darwin' && arch === 'arm64'
}
