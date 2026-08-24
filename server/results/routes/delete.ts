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

import { Request, Response } from 'express';
import { validateGitHubToken } from '../../oauth.ts';
import { isPlaygroundMode } from '../../iam.ts';
import { readResultMetadata, deleteResult } from '../gcs.ts';

export interface DeleteResultsResponse {
    success: boolean;
    message: string;
}

/**
 * DELETE /api/results/:runId
 *
 * Permanently deletes a benchmark result run bundle from the GCS Results Store.
 *
 * - **Headers:** `X-Prism-Github-Token: <access_token>` (required, optional in playground mode)
 * - **Authorization Rules:**
 *     - **Playground Mode:** Full access to delete any benchmark in RESULTS_STORE_BUCKET anonymously.
 *     - **Admin:** Full access, provided benchmark submission state is `unlisted` or `rejected`.
 *     - **Owner:** Full access if benchmark submission state is `unlisted`.
 *     - **Non-Admin Users / Guests:** `403 Forbidden`.
 * - **Benchmark Checks:**
 *     - `runId` must be a valid UUID.
 *     - Benchmark must exist in the GCS Results Store.
 */
export async function deleteResultsHandler(
    req: Request<{ runId: string }, DeleteResultsResponse | { error: string; details?: unknown }>,
    res: Response<DeleteResultsResponse | { error: string; details?: unknown }>
) {
    const { runId } = req.params;

    // Validate UUID format of runId to prevent path traversal
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(runId)) {
        return res.status(400).json({ error: 'Invalid runId format. Must be a UUID.' });
    }

    // 1. Authenticate user
    const token = req.headers['x-prism-github-token'] as string | undefined;
    let username = '';
    let permission = 'none';

    if (isPlaygroundMode()) {
        permission = 'admin';
        if (token) {
            try {
                const authResult = await validateGitHubToken(token);
                username = authResult.username;
            } catch {
                // Ignore token errors in playground mode
            }
        }
    } else {
        if (!token) {
            return res.status(401).json({ error: 'Authentication required. Missing session token.' });
        }

        try {
            const authResult = await validateGitHubToken(token);
            username = authResult.username;
            permission = authResult.permission;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return res.status(401).json({ error: 'Invalid or expired session token.', details: msg });
        }
    }

    try {
        // 2. Fetch GCS metadata context to check submission status/state & author
        const metadata = await readResultMetadata(runId);
        if (!metadata) {
            return res.status(404).json({ error: 'Result not found.' });
        }

        const { user: itemUser, state: itemState } = metadata;
        const isOwner = !!(username && itemUser.toLowerCase() === username.toLowerCase());

        let allowed = false;
        if (isPlaygroundMode()) {
            allowed = true;
        } else if (isOwner && itemState === 'unlisted') {
            allowed = true;
        } else if (permission === 'admin' && (itemState === 'unlisted' || itemState === 'rejected')) {
            allowed = true;
        }

        if (!allowed) {
            return res.status(403).json({
                error: 'Forbidden. Benchmark can only be deleted if it is unlisted (by owner or admin) or rejected (by admin).'
            });
        }

        // 3. Delete object from GCS Results Store
        await deleteResult(runId);

        return res.json({
            success: true,
            message: `Benchmark ${runId} successfully deleted.`
        });
    } catch (error: unknown) {
        console.error('[Results Delete API Error]', error);
        const msg = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: 'Failed to delete benchmark result', details: msg });
    }
}
