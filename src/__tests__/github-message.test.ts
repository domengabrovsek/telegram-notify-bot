import { buildGitHubMessage } from '@/services/github-message';
import type { GitHubWebhookPayload } from '@/types';

const repository = { html_url: 'https://github.com/domengabrovsek/home-infra', default_branch: 'main' };
const pullRequest = {
  title: 'feat: add webhook',
  html_url: 'https://github.com/domengabrovsek/home-infra/pull/42',
  user: { login: 'domengabrovsek', type: 'User' },
  head: { ref: 'feat/webhook' },
  base: { ref: 'main' },
  merged: false,
  commits: 3,
};

const prEvent = (action: string, overrides: Partial<typeof pullRequest> = {}): GitHubWebhookPayload => ({
  action,
  repository,
  pull_request: { ...pullRequest, ...overrides },
});

describe('buildGitHubMessage', () => {
  describe('pull_request', () => {
    it('formats pr_opened with the commit count', () => {
      expect(buildGitHubMessage('pull_request', prEvent('opened'))).toBe(
        [
          '🚀 New Pull Request Opened',
          '',
          '📝 Title: feat: add webhook',
          '👤 Author: domengabrovsek',
          '🌿 Branch: feat/webhook → main',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42',
          '📋 Commits: 3',
        ].join('\n'),
      );
    });

    it('formats pr_merged for a closed and merged PR', () => {
      expect(buildGitHubMessage('pull_request', prEvent('closed', { merged: true }))).toBe(
        [
          '✅ Pull Request Merged',
          '',
          '📝 Title: feat: add webhook',
          '👤 Author: domengabrovsek',
          '🌿 Branch: feat/webhook → main',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42',
        ].join('\n'),
      );
    });

    it('formats pr_closed for a closed PR that was not merged', () => {
      expect(buildGitHubMessage('pull_request', prEvent('closed'))).toBe(
        [
          '❌ Pull Request Closed',
          '',
          '📝 Title: feat: add webhook',
          '👤 Author: domengabrovsek',
          '🌿 Branch: feat/webhook → main',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42',
        ].join('\n'),
      );
    });

    it('formats pr_review_requested with the requested reviewer', () => {
      const payload = { ...prEvent('review_requested'), requested_reviewer: { login: 'reviewer-bot' } };

      expect(buildGitHubMessage('pull_request', payload)).toBe(
        [
          '👋 Review Requested',
          '',
          '📝 Title: feat: add webhook',
          '👤 Requester: domengabrovsek',
          '🔎 Reviewer: reviewer-bot',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42',
        ].join('\n'),
      );
    });

    it('omits the reviewer line when a team is requested', () => {
      const message = buildGitHubMessage('pull_request', prEvent('review_requested'));

      expect(message).not.toContain('🔎 Reviewer');
    });

    it('ignores synchronize, which the home-infra caller does not subscribe to', () => {
      expect(buildGitHubMessage('pull_request', prEvent('synchronize'))).toBeNull();
    });

    it('ignores PRs that target a branch other than the default branch', () => {
      expect(buildGitHubMessage('pull_request', prEvent('opened', { base: { ref: 'release' } }))).toBeNull();
    });
  });

  describe('issue_comment', () => {
    const commentEvent = (userType = 'User', overrides: Partial<GitHubWebhookPayload> = {}): GitHubWebhookPayload => ({
      action: 'created',
      repository,
      issue: { title: 'feat: add webhook', pull_request: { url: 'https://api.github.com/pulls/42' } },
      comment: {
        body: 'Looks good',
        html_url: 'https://github.com/domengabrovsek/home-infra/pull/42#issuecomment-1',
        user: { login: 'alice', type: userType },
      },
      ...overrides,
    });

    it('formats pr_commented for a human comment on a PR', () => {
      expect(buildGitHubMessage('issue_comment', commentEvent())).toBe(
        [
          '💬 New Comment on PR',
          '',
          '📝 Title: feat: add webhook',
          '👤 Author: alice',
          '💭 Comment: Looks good',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42#issuecomment-1',
        ].join('\n'),
      );
    });

    it('truncates the comment body to 300 characters', () => {
      const payload = commentEvent();
      payload.comment = { ...payload.comment, body: 'x'.repeat(301) };

      expect(buildGitHubMessage('issue_comment', payload)).toContain(`💭 Comment: ${'x'.repeat(300)}...\n`);
    });

    it('skips bot-authored comments', () => {
      expect(buildGitHubMessage('issue_comment', commentEvent('Bot'))).toBeNull();
    });

    it('skips comments on plain issues', () => {
      expect(buildGitHubMessage('issue_comment', commentEvent('User', { issue: { title: 'bug' } }))).toBeNull();
    });

    it('skips edited comments', () => {
      expect(buildGitHubMessage('issue_comment', commentEvent('User', { action: 'edited' }))).toBeNull();
    });
  });

  describe('pull_request_review_comment', () => {
    const reviewCommentEvent = (userType = 'User'): GitHubWebhookPayload => ({
      action: 'created',
      repository,
      pull_request: pullRequest,
      comment: {
        body: 'Rename this',
        path: 'src/handler.ts',
        html_url: 'https://github.com/domengabrovsek/home-infra/pull/42#discussion_r1',
        user: { login: 'alice', type: userType },
      },
    });

    it('formats pr_review_comment with the file path', () => {
      expect(buildGitHubMessage('pull_request_review_comment', reviewCommentEvent())).toBe(
        [
          '🔍 New Review Comment',
          '',
          '📝 Title: feat: add webhook',
          '👤 Author: alice',
          '📄 File: src/handler.ts',
          '💭 Comment: Rename this',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42#discussion_r1',
        ].join('\n'),
      );
    });

    it('skips bot-authored review comments', () => {
      expect(buildGitHubMessage('pull_request_review_comment', reviewCommentEvent('Bot'))).toBeNull();
    });
  });

  describe('pull_request_review', () => {
    const reviewEvent = (state: string, userType = 'User'): GitHubWebhookPayload => ({
      action: 'submitted',
      repository,
      pull_request: pullRequest,
      review: { state, user: { login: 'alice', type: userType } },
    });

    it.each([
      ['approved', '✅ PR Review: Approved'],
      ['changes_requested', '🔴 PR Review: Changes Requested'],
      ['commented', '💬 PR Review: Commented'],
      ['dismissed', '👀 PR Review: dismissed'],
    ])('formats pr_review for state %s', (state, expectedHeader) => {
      expect(buildGitHubMessage('pull_request_review', reviewEvent(state))).toBe(
        [
          expectedHeader,
          '',
          '📝 Title: feat: add webhook',
          '👤 Reviewer: alice',
          '📦 Repository: https://github.com/domengabrovsek/home-infra',
          '🔗 Pull request: https://github.com/domengabrovsek/home-infra/pull/42',
        ].join('\n'),
      );
    });

    it('skips bot-authored reviews', () => {
      expect(buildGitHubMessage('pull_request_review', reviewEvent('approved', 'Bot'))).toBeNull();
    });
  });

  it('ignores events it does not handle', () => {
    expect(buildGitHubMessage('push', { repository })).toBeNull();
  });
});
