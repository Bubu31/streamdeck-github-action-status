import * as https from 'https';
import { GitHubActionsResponse, WorkflowStatusResult, WorkflowStatus } from './types';

export async function fetchWorkflowStatus(
  token: string,
  owner: string,
  repo: string,
  workflow?: string
): Promise<WorkflowStatusResult> {
  try {
    const runs = await getWorkflowRuns(token, owner, repo, workflow);

    if (runs.total_count === 0 || runs.workflow_runs.length === 0) {
      return {
        status: 'unknown',
        name: workflow || 'No runs',
        url: `https://github.com/${owner}/${repo}/actions`,
        branch: '',
        error: 'No workflow runs found'
      };
    }

    const latestRun = runs.workflow_runs[0];
    const status = mapGitHubStatus(latestRun.status, latestRun.conclusion);

    return {
      status,
      name: latestRun.name,
      url: latestRun.html_url,
      branch: latestRun.head_branch
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      status: 'unknown',
      name: 'Error',
      url: `https://github.com/${owner}/${repo}/actions`,
      branch: '',
      error: errorMessage
    };
  }
}

function getWorkflowRuns(
  token: string,
  owner: string,
  repo: string,
  workflow?: string
): Promise<GitHubActionsResponse> {
  return new Promise((resolve, reject) => {
    let path = `/repos/${owner}/${repo}/actions/runs?per_page=1`;

    if (workflow) {
      path = `/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?per_page=1`;
    }

    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'StreamDeck-GitHub-Action-Status'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data) as GitHubActionsResponse;
            resolve(parsed);
          } catch {
            reject(new Error('Failed to parse GitHub response'));
          }
        } else if (res.statusCode === 401) {
          reject(new Error('Invalid GitHub token'));
        } else if (res.statusCode === 404) {
          reject(new Error('Repository or workflow not found'));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

function mapGitHubStatus(status: string, conclusion: string | null): WorkflowStatus {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return 'success';
      case 'failure':
      case 'cancelled':
      case 'timed_out':
        return 'failure';
      default:
        return 'unknown';
    }
  } else if (status === 'in_progress' || status === 'queued' || status === 'pending' || status === 'waiting') {
    return 'pending';
  }

  return 'unknown';
}
