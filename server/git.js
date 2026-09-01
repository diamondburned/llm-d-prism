// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Parses the GIT_COMMIT environment variable provided by deploy.sh or docker-compose.yaml.
 * If the environment variable is not available, returns null without executing any git commands.
 *
 * @param {string | undefined} envCommit
 * @returns {{ commit: string, display: string } | null}
 */
export function parseGitCommit(envCommit) {
    if (!envCommit || typeof envCommit !== 'string') return null;
    const trimmed = envCommit.trim();
    if (!trimmed) return null;

    const clean = trimmed.replace(/-dirty$/, '');
    const hashMatch = clean.match(/-g([0-9a-fA-F]+)$/);
    const commit = hashMatch ? hashMatch[1] : clean;

    const isFullSha = /^[0-9a-fA-F]{40}$/.test(trimmed);
    const display = isFullSha ? trimmed.slice(0, 7) : trimmed;

    return {
        commit,
        display
    };
}
