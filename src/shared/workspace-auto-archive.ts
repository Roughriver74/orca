/** Composed into GlobalSettings through GlobalSettingsBase. */
export type WorkspaceAutoArchiveSettings = {
  /** Days without activity before a workspace is archived automatically; 0 = off.
   *  Read through resolveWorkspaceAutoArchiveDays. */
  autoArchiveInactiveWorkspacesDays?: number
}

/** Workspaces idle this many days are archived automatically; 0 turns auto-archive off. */
export const WORKSPACE_AUTO_ARCHIVE_DAYS_DEFAULT = 2
export const WORKSPACE_AUTO_ARCHIVE_DAYS_MAX = 365

export function resolveWorkspaceAutoArchiveDays(
  settings: WorkspaceAutoArchiveSettings | null | undefined
): number {
  const raw = settings?.autoArchiveInactiveWorkspacesDays
  if (
    typeof raw !== 'number' ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    raw > WORKSPACE_AUTO_ARCHIVE_DAYS_MAX
  ) {
    return WORKSPACE_AUTO_ARCHIVE_DAYS_DEFAULT
  }
  return raw
}
