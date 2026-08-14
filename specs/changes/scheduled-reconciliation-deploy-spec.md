# Spec: Scheduled Reconciliation Deployment for Cloud Run

- **Status**: Implemented
- **Author**: diamondburned, Jetski
- **Date**: August 13, 2026
- **Feature Name**: `scheduled-reconciliation-deploy`

## Objective & Problem Statement

Pull requests merged via Prow's `/lgtm` auto-merge workflow ([`.github/workflows/prow-pr-automerge.yml`](../../.github/workflows/prow-pr-automerge.yml)) rely on the default GitHub Actions `GITHUB_TOKEN`. By design, GitHub suppresses downstream `on: push` workflow triggers from actions executed with `GITHUB_TOKEN` to prevent recursive workflow loops.

As a result, production Prism deployments to Cloud Run ([`.github/workflows/deploy-cloud-run.yaml`](../../.github/workflows/deploy-cloud-run.yaml)) were only triggered when maintainers manually merged PRs through the GitHub web UI or CLI, leaving the live service commits behind `main` whenever Prow performed automated merges.

## Evaluated Solutions

1. **GitHub App Installation Token**: Configure a GitHub App in the `llm-d` organization to generate ephemeral bot tokens for Prow merges. Triggers immediate pushes, but requires org-level administration and updates across reusable workflows in `llm-d/llm-d-infra`.
2. **Personal Access Token (PAT)**: Store a maintainer or bot PAT in repository secrets. Fragile and high-maintenance due to token expiration and coupling to personal user accounts.
3. **Scheduled Reconciliation with Commit Diffing (Selected)**: Run the deployment workflow on a periodic schedule (every 30 minutes) alongside existing `push` and `workflow_dispatch` triggers, with an idempotent pre-check comparing `HEAD` against the deployed Cloud Run revision label.

## Technical Implementation Details

### 1. Cloud Run Commit Labeling in `deploy.sh`

Updated [`deploy.sh`](../../deploy.sh) to accept a `-k` / `--commit <SHA>` argument (falling back to auto-detecting `git rev-parse HEAD` if inside a git repository):

```bash
# Auto-detect commit SHA from git if not explicitly passed
if [ -z "$COMMIT_SHA" ]; then
    COMMIT_SHA=$(git rev-parse HEAD || echo "")
fi

# Attach commit label to Cloud Run revision
[ -n "$COMMIT_SHA" ] && DEPLOY_ARGS+=(--update-labels "git-commit=$COMMIT_SHA")
```

### 2. Idempotent Workflow Reconciliation in `deploy-cloud-run.yaml`

Updated [`.github/workflows/deploy-cloud-run.yaml`](../../.github/workflows/deploy-cloud-run.yaml) to:
- Run on a 30-minute cron schedule (`*/30 * * * *`) in addition to `push` and `workflow_dispatch`.
- Add a `check-diff` step before invoking `./deploy.sh`:
  - Retrieves the `git-commit` label from the live Cloud Run service via `gcloud run services describe "$SERVICE_NAME" --format='value(metadata.labels["git-commit"])'`.
  - Compares the deployed SHA with `${{ github.sha }}`.
  - If they match (and the run is not a manual `workflow_dispatch`), sets `skip_deploy=true` to skip Cloud Build and deployment steps.
  - If they differ (or on manual dispatch), proceeds with building and deploying the new commit.

```yaml
on:
  push:
    branches:
      - main
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:
```

## Success Criteria

1. **Self-Healing Sync**: Any commit merged into `main` (whether by Prow auto-merge, API, or human merge) is deployed to production Cloud Run within at most 30 minutes.
2. **Zero Wasted Cloud Build Quota**: Scheduled runs where no new commits were merged exit cleanly in seconds without triggering Cloud Build.
3. **Manual Overrides Preserved**: `workflow_dispatch` always forces a fresh deployment regardless of whether commit SHAs match.
