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

export const DEFAULT_RESULTS_STORE_BUCKET = 'llm-d-benchmarks';
export const DEFAULT_RESULTS_BUCKETS = 'llm-d-benchmarks';

/**
 * Returns the canonical bucket name used for the Prism Results Store (and IAM allowlists).
 * Reads from RESULTS_STORE_BUCKET if configured; otherwise falls back to the first bucket
 * in DEFAULT_BUCKETS (or DEFAULT_RESULTS_STORE_BUCKET).
 *
 * @param {string|undefined} [rawResultsBucket=process.env.RESULTS_STORE_BUCKET]
 * @param {string|undefined} [rawDefaultBuckets=process.env.DEFAULT_BUCKETS]
 * @returns {string}
 */
export function getResultsStoreBucket(
    rawResultsBucket = process.env.RESULTS_STORE_BUCKET,
    rawDefaultBuckets = process.env.DEFAULT_BUCKETS
) {
    if (rawResultsBucket) {
        const parsed = parseBucketEntry(rawResultsBucket).bucket;
        if (parsed) return parsed;
    }
    if (rawDefaultBuckets) {
        const firstEntry = rawDefaultBuckets.split(',').map(e => e.trim()).filter(Boolean)[0];
        if (firstEntry) {
            const parsed = parseBucketEntry(firstEntry).bucket;
            if (parsed) return parsed;
        }
    }
    return DEFAULT_RESULTS_STORE_BUCKET;
}

/**
 * Parses a single DEFAULT_BUCKETS or RESULTS_STORE_BUCKET entry of the form "bucket" or
 * "bucket/path/to/dir" (optionally scheme-prefixed) into its bucket name
 * and normalized object prefix ("" or "path/to/dir/").
 *
 * @param {string} entry
 * @returns {{ bucket: string, prefix: string }}
 */
export function parseBucketEntry(entry) {
    const cleaned = String(entry || '')
        .trim()
        .replace(/^(gs|s3|https?):\/\//i, '')
        .replace(/\/+$/, '');
    const slashIdx = cleaned.indexOf('/');
    if (slashIdx === -1) {
        return { bucket: cleaned, prefix: '' };
    }
    const pathParts = cleaned.slice(slashIdx + 1).split('/').filter(Boolean);
    return {
        bucket: cleaned.slice(0, slashIdx),
        prefix: pathParts.length ? `${pathParts.join('/')}/` : ''
    };
}

/**
 * Returns the raw (trimmed) entries configured via DEFAULT_BUCKETS.
 * If DEFAULT_BUCKETS is not set, falls back to RESULTS_STORE_BUCKET
 * or DEFAULT_RESULTS_BUCKETS.
 *
 * @param {string|undefined} [rawBuckets=process.env.DEFAULT_BUCKETS]
 * @param {string|undefined} [rawResultsStoreBucket=process.env.RESULTS_STORE_BUCKET]
 * @returns {string[]}
 */
export function getConfiguredBucketEntries(
    rawBuckets = process.env.DEFAULT_BUCKETS,
    rawResultsStoreBucket = process.env.RESULTS_STORE_BUCKET
) {
    const defaultFallback = rawResultsStoreBucket || DEFAULT_RESULTS_BUCKETS;
    const raw = rawBuckets !== undefined && rawBuckets !== ''
        ? rawBuckets
        : (process.env.DEFAULT_BUCKETS || defaultFallback);
    return raw
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);
}

/**
 * Returns the bucket names configured via DEFAULT_BUCKETS with any
 * "/path" scoping suffixes stripped.
 *
 * @param {string|undefined} [rawBuckets=process.env.DEFAULT_BUCKETS]
 * @param {string|undefined} [rawResultsStoreBucket=process.env.RESULTS_STORE_BUCKET]
 * @returns {string[]}
 */
export function getConfiguredBucketNames(
    rawBuckets = process.env.DEFAULT_BUCKETS,
    rawResultsStoreBucket = process.env.RESULTS_STORE_BUCKET
) {
    return getConfiguredBucketEntries(rawBuckets, rawResultsStoreBucket)
        .map(e => parseBucketEntry(e).bucket)
        .filter(Boolean);
}
