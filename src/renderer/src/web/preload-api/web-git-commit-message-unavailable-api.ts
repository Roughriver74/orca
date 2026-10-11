import { translate } from '@/i18n/i18n'
import type { PreloadApi } from '../../../../preload/api-types'

/** Split out of `web-git-api.ts` to stay under the file's line budget: commit-message/PR-field generation and model discovery have no web-client implementation yet. */
export const webGitCommitMessageUnavailableApi: Pick<
  NonNullable<Partial<PreloadApi>['git']>,
  | 'generateCommitMessage'
  | 'discoverCommitMessageModels'
  | 'cancelGenerateCommitMessage'
  | 'generatePullRequestFields'
  | 'cancelGeneratePullRequestFields'
> = {
  generateCommitMessage: async () => ({
    success: false,
    error: translate(
      'auto.web.web.preload.api.9fc90740b6',
      'Commit message generation is unavailable in the web client.'
    )
  }),
  discoverCommitMessageModels: async () => ({
    success: false,
    error: translate(
      'auto.web.web.preload.api.e57c82d276',
      'Commit message model discovery is unavailable in the web client.'
    )
  }),
  cancelGenerateCommitMessage: () => Promise.resolve(),
  generatePullRequestFields: async () => ({
    success: false,
    error: translate(
      'auto.web.web.preload.api.b8a1618172',
      'Pull request detail generation is unavailable in the web client.'
    )
  }),
  cancelGeneratePullRequestFields: () => Promise.resolve()
}
