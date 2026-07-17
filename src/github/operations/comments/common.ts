import { GITHUB_SERVER_URL } from "../../api/config";

export const SPINNER_HTML =
  '<img src="https://raw.githubusercontent.com/xuwenhao/kimi-code-action/main/docs/media/moon-spinner.gif" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />';

export function createJobRunLink(
  owner: string,
  repo: string,
  runId: string,
): string {
  const jobRunUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${runId}`;
  return `[View job run](${jobRunUrl})`;
}

export function createBranchLink(
  owner: string,
  repo: string,
  branchName: string,
): string {
  const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${branchName}`;
  return `\n[View branch](${branchUrl})`;
}

export function createCommentBody(
  jobRunLink: string,
  branchLink: string = "",
): string {
  return `Kimi Code is working… ${SPINNER_HTML}

I'll analyze this and get back to you.

${jobRunLink}${branchLink}`;
}
