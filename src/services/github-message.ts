import type { GitHubWebhookPayload } from '@/types';

/* Ports the PR subset of the github-actions notify action's "Build message" step,
   so a webhook delivery produces the same Telegram text as the Actions router. */

type PrEventType =
  | 'pr_opened'
  | 'pr_merged'
  | 'pr_closed'
  | 'pr_review_requested'
  | 'pr_commented'
  | 'pr_review_comment'
  | 'pr_review';

interface PrNotification {
  eventType: PrEventType;
  repository: string;
  status?: string | undefined;
  title?: string | undefined;
  actor?: string | undefined;
  reviewer?: string | undefined;
  branchHead?: string | undefined;
  branchBase?: string | undefined;
  file?: string | undefined;
  body?: string | null | undefined;
  commits?: number | undefined;
  link?: string | undefined;
}

type FieldKey =
  | 'title'
  | 'author'
  | 'requester'
  | 'review_by'
  | 'reviewer'
  | 'branch'
  | 'file'
  | 'body'
  | 'repository'
  | 'link_pr'
  | 'commits';

const FIXED_HEADERS: Record<Exclude<PrEventType, 'pr_review'>, string> = {
  pr_opened: '🚀 New Pull Request Opened',
  pr_merged: '✅ Pull Request Merged',
  pr_closed: '❌ Pull Request Closed',
  pr_review_requested: '👋 Review Requested',
  pr_commented: '💬 New Comment on PR',
  pr_review_comment: '🔍 New Review Comment',
};

const REVIEW_HEADERS: Record<string, [string, string]> = {
  approved: ['✅', 'Approved'],
  changes_requested: ['🔴', 'Changes Requested'],
  commented: ['💬', 'Commented'],
};

const LAYOUT: Record<PrEventType, FieldKey[]> = {
  pr_opened: ['title', 'author', 'branch', 'repository', 'link_pr', 'commits'],
  pr_merged: ['title', 'author', 'branch', 'repository', 'link_pr'],
  pr_closed: ['title', 'author', 'branch', 'repository', 'link_pr'],
  pr_review_requested: ['title', 'requester', 'reviewer', 'repository', 'link_pr'],
  pr_commented: ['title', 'author', 'body', 'repository', 'link_pr'],
  pr_review_comment: ['title', 'author', 'file', 'body', 'repository', 'link_pr'],
  pr_review: ['title', 'review_by', 'repository', 'link_pr'],
};

const MAX_BODY_LENGTH = 300;

function isBot(user: { type?: string } | undefined): boolean {
  return user?.type === 'Bot';
}

/* Maps a webhook delivery to a notification, applying the same gates as the
   notify.yml router and the home-infra caller's event filter. Returns null for
   anything that should not notify. */
export function toPrNotification(event: string, payload: GitHubWebhookPayload): PrNotification | null {
  const repository = payload.repository?.html_url ?? '';
  const pr = payload.pull_request;

  switch (event) {
    case 'pull_request': {
      // The Actions callers filter pull_request on `branches: [main]`, the base branch
      if (!pr || pr.base?.ref !== payload.repository?.default_branch) return null;

      const common = {
        repository,
        title: pr.title,
        actor: pr.user?.login,
        link: pr.html_url,
      };
      const branches = { branchHead: pr.head?.ref, branchBase: pr.base?.ref };

      if (payload.action === 'opened') {
        return { eventType: 'pr_opened', ...common, ...branches, commits: pr.commits };
      }
      if (payload.action === 'closed') {
        return { eventType: pr.merged ? 'pr_merged' : 'pr_closed', ...common, ...branches };
      }
      if (payload.action === 'review_requested') {
        return { eventType: 'pr_review_requested', ...common, reviewer: payload.requested_reviewer?.login };
      }
      return null;
    }

    case 'issue_comment': {
      const { comment, issue } = payload;
      if (payload.action !== 'created' || !issue?.pull_request || isBot(comment?.user)) return null;
      return {
        eventType: 'pr_commented',
        repository,
        title: issue.title,
        actor: comment?.user?.login,
        body: comment?.body,
        link: comment?.html_url,
      };
    }

    case 'pull_request_review_comment': {
      const { comment } = payload;
      if (payload.action !== 'created' || isBot(comment?.user)) return null;
      return {
        eventType: 'pr_review_comment',
        repository,
        title: pr?.title,
        actor: comment?.user?.login,
        file: comment?.path,
        body: comment?.body,
        link: comment?.html_url,
      };
    }

    case 'pull_request_review': {
      const { review } = payload;
      if (payload.action !== 'submitted' || isBot(review?.user)) return null;
      return {
        eventType: 'pr_review',
        repository,
        status: review?.state,
        title: pr?.title,
        actor: review?.user?.login,
        link: pr?.html_url,
      };
    }

    default:
      return null;
  }
}

function header(n: PrNotification): string {
  if (n.eventType === 'pr_review') {
    const status = n.status ?? '';
    const [emoji, label] = REVIEW_HEADERS[status] ?? ['👀', status || 'Review'];
    return `${emoji} PR Review: ${label}`;
  }
  return FIXED_HEADERS[n.eventType];
}

export function formatPrNotification(n: PrNotification): string {
  const title = n.title ?? '';
  const actor = n.actor ?? '';
  const reviewer = n.reviewer ?? '';
  const branchHead = n.branchHead ?? '';
  const branchBase = n.branchBase ?? '';
  const file = n.file ?? '';
  const link = n.link ?? '';

  let body = n.body ?? '';
  if (body.length > MAX_BODY_LENGTH) {
    body = `${body.substring(0, MAX_BODY_LENGTH)}...`;
  }

  const branch = branchHead && branchBase ? `${branchHead} → ${branchBase}` : branchHead || branchBase;

  /* The action renders a fetched commit list here. The Lambda holds no GitHub
     token, so it shows the payload's commit count instead. */
  const commits = n.commits === undefined ? '' : `${n.commits}`;

  const fields: Record<FieldKey, string> = {
    title: title && `📝 Title: ${title}`,
    author: actor && `👤 Author: ${actor}`,
    requester: actor && `👤 Requester: ${actor}`,
    review_by: actor && `👤 Reviewer: ${actor}`,
    reviewer: reviewer && `🔎 Reviewer: ${reviewer}`,
    branch: branch && `🌿 Branch: ${branch}`,
    file: file && `📄 File: ${file}`,
    body: body && `💭 Comment: ${body}`,
    repository: `📦 Repository: ${n.repository}`,
    link_pr: link && `🔗 Pull request: ${link}`,
    commits: commits && `📋 Commits: ${commits}`,
  };

  const lines = LAYOUT[n.eventType].map((key) => fields[key]).filter(Boolean);
  return `${header(n)}\n\n${lines.join('\n')}`;
}

export function buildGitHubMessage(event: string, payload: GitHubWebhookPayload): string | null {
  const notification = toPrNotification(event, payload);
  return notification ? formatPrNotification(notification) : null;
}
