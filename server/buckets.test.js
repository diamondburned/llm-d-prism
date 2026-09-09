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

import { describe, it, expect } from 'vitest';
import {
    parseBucketEntry,
    getResultsStoreBucket,
    getResultsStoreTarget,
    getResultsStorePrefix,
    getResultsStoreUploadPath,
    getResultsStoreObjectPath,
    getConfiguredBucketEntries,
    getConfiguredBucketNames,
    DEFAULT_RESULTS_STORE_BUCKET,
    DEFAULT_RESULTS_BUCKETS,
    DEFAULT_RESULTS_STORE_PREFIX
} from './buckets.js';

describe('buckets configuration & parsing', () => {
    it('parses bare bucket names correctly with parseBucketEntry', () => {
        expect(parseBucketEntry('my-bucket')).toEqual({ bucket: 'my-bucket', prefix: '' });
        expect(parseBucketEntry(' my-bucket ')).toEqual({ bucket: 'my-bucket', prefix: '' });
        expect(parseBucketEntry('gs://my-bucket/')).toEqual({ bucket: 'my-bucket', prefix: '' });
        expect(parseBucketEntry('')).toEqual({ bucket: '', prefix: '' });
        expect(parseBucketEntry(null)).toEqual({ bucket: '', prefix: '' });
    });

    it('parses path-scoped bucket entries with trailing-slash prefix', () => {
        expect(parseBucketEntry('my-bucket/team-a')).toEqual({ bucket: 'my-bucket', prefix: 'team-a/' });
        expect(parseBucketEntry('my-bucket/team-a/results/')).toEqual({ bucket: 'my-bucket', prefix: 'team-a/results/' });
        expect(parseBucketEntry('gs://my-bucket/team-a/')).toEqual({ bucket: 'my-bucket', prefix: 'team-a/' });
        expect(parseBucketEntry('my-bucket//team-a//')).toEqual({ bucket: 'my-bucket', prefix: 'team-a/' });
    });

    it('resolves Results Store bucket with default and custom values', () => {
        expect(DEFAULT_RESULTS_STORE_BUCKET).toBe('llm-d-benchmarks');
        expect(DEFAULT_RESULTS_STORE_PREFIX).toBe('prism-results-store/');
        expect(getResultsStoreBucket('', '')).toBe('llm-d-benchmarks');
        expect(getResultsStoreBucket('custom-results-bucket', '')).toBe('custom-results-bucket');
        expect(getResultsStoreBucket('gs://custom-results-bucket/', '')).toBe('custom-results-bucket');
        expect(getResultsStoreBucket('gs://custom-results-bucket/subpath', '')).toBe('custom-results-bucket');
    });

    it('resolves Results Store target and upload path with default and custom folder prefixes', () => {
        // RESULTS_STORE_BUCKET=bucket_name (resolves to bucket_name/prism-results-store)
        expect(getResultsStoreTarget('bucket_name')).toEqual({
            bucket: 'bucket_name',
            prefix: 'prism-results-store/'
        });
        expect(getResultsStoreUploadPath('bucket_name')).toBe('bucket_name/prism-results-store');
        expect(getResultsStorePrefix('bucket_name')).toBe('prism-results-store/');
        expect(getResultsStoreObjectPath('test-run-123', 'bucket_name')).toBe('prism-results-store/test-run-123.v1.json');

        // RESULTS_STORE_BUCKET=bucket_name/folder_a/folder_b (resolves to bucket_name/folder_a/folder_b)
        expect(getResultsStoreTarget('bucket_name/folder_a/folder_b')).toEqual({
            bucket: 'bucket_name',
            prefix: 'folder_a/folder_b/'
        });
        expect(getResultsStoreUploadPath('bucket_name/folder_a/folder_b')).toBe('bucket_name/folder_a/folder_b');
        expect(getResultsStorePrefix('bucket_name/folder_a/folder_b')).toBe('folder_a/folder_b/');
        expect(getResultsStoreObjectPath('test-run-123', 'bucket_name/folder_a/folder_b')).toBe('folder_a/folder_b/test-run-123.v1.json');

        // Scheme prefix (gs://) and trailing slashes
        expect(getResultsStoreUploadPath('gs://bucket_name/')).toBe('bucket_name/prism-results-store');
        expect(getResultsStoreUploadPath('gs://bucket_name/folder_a/folder_b/')).toBe('bucket_name/folder_a/folder_b');

        // slabe-prism deployment case (slabe-bucket/prism-upload)
        expect(getResultsStoreUploadPath('slabe-bucket/prism-upload')).toBe('slabe-bucket/prism-upload');
        expect(getResultsStoreTarget('slabe-bucket/prism-upload')).toEqual({
            bucket: 'slabe-bucket',
            prefix: 'prism-upload/'
        });
        expect(getResultsStoreObjectPath('abc-uuid', 'slabe-bucket/prism-upload')).toBe('prism-upload/abc-uuid.v1.json');

        // Fallbacks when RESULTS_STORE_BUCKET is empty
        expect(getResultsStoreUploadPath('', 'fallback-bucket')).toBe('fallback-bucket/prism-results-store');
        expect(getResultsStoreUploadPath('', 'fallback-bucket/custom-dir')).toBe('fallback-bucket/custom-dir');
        expect(getResultsStoreUploadPath('', '')).toBe('llm-d-benchmarks/prism-results-store');
    });

    it('handles development configuration (staging & production buckets)', () => {
        expect(
            getConfiguredBucketEntries('llm-d-benchmarks,llm-d-benchmarks-staging', 'llm-d-benchmarks')
        ).toEqual(['llm-d-benchmarks', 'llm-d-benchmarks-staging']);

        expect(
            getConfiguredBucketNames('llm-d-benchmarks,llm-d-benchmarks-staging', 'llm-d-benchmarks')
        ).toEqual(['llm-d-benchmarks', 'llm-d-benchmarks-staging']);
    });

    it('handles production configuration with single results bucket', () => {
        expect(
            getConfiguredBucketEntries('llm-d-benchmarks', 'llm-d-benchmarks')
        ).toEqual(['llm-d-benchmarks']);

        expect(
            getConfiguredBucketNames('llm-d-benchmarks', 'llm-d-benchmarks')
        ).toEqual(['llm-d-benchmarks']);
    });

    it('retains path-scoped DEFAULT_BUCKETS entries', () => {
        expect(
            getConfiguredBucketEntries('llm-d-benchmarks/team-a,llm-d-benchmarks-staging/team-b', 'llm-d-benchmarks')
        ).toEqual(['llm-d-benchmarks/team-a', 'llm-d-benchmarks-staging/team-b']);

        expect(
            getConfiguredBucketNames('llm-d-benchmarks/team-a,llm-d-benchmarks-staging/team-b', 'llm-d-benchmarks')
        ).toEqual(['llm-d-benchmarks', 'llm-d-benchmarks-staging']);
    });

    it('passes through custom buckets cleanly', () => {
        expect(
            getConfiguredBucketEntries('bucket-a, bucket-b/sub/dir ,,', 'llm-d-benchmarks')
        ).toEqual(['bucket-a', 'bucket-b/sub/dir']);

        expect(
            getConfiguredBucketNames('bucket-a, bucket-b/sub/dir ,,', 'llm-d-benchmarks')
        ).toEqual(['bucket-a', 'bucket-b']);
    });

    it('treats multiple prefixes of the same bucket as independent entries', () => {
        expect(
            getConfiguredBucketEntries('b1/p1,b1/p2,b2/p3', 'llm-d-benchmarks')
        ).toEqual(['b1/p1', 'b1/p2', 'b2/p3']);

        expect(
            getConfiguredBucketNames('b1/p1,b1/p2,b2/p3', 'llm-d-benchmarks')
        ).toEqual(['b1', 'b1', 'b2']);
    });

    it('falls back to DEFAULT_BUCKETS[0] when RESULTS_STORE_BUCKET is not set', () => {
        expect(getResultsStoreBucket('', 'custom-bucket,other-bucket')).toBe('custom-bucket');
        expect(getResultsStoreBucket('', 'gs://scoped-bucket/sub/path, other-bucket')).toBe('scoped-bucket');
        expect(getConfiguredBucketEntries('b1,b2', '')).toEqual(['b1', 'b2']);
        expect(getConfiguredBucketNames('b1/p1,b2/p2', '')).toEqual(['b1', 'b2']);
    });

    it('falls back to default results bucket when all args are empty', () => {
        expect(getConfiguredBucketEntries('', 'llm-d-benchmarks')).toEqual(['llm-d-benchmarks']);
        expect(getConfiguredBucketNames('', 'llm-d-benchmarks')).toEqual(['llm-d-benchmarks']);
    });
});
