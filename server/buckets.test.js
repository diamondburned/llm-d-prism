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
    getConfiguredBucketEntries,
    getConfiguredBucketNames,
    DEFAULT_RESULTS_STORE_BUCKET,
    DEFAULT_RESULTS_BUCKETS
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
        expect(getResultsStoreBucket('', '')).toBe('llm-d-benchmarks');
        expect(getResultsStoreBucket('custom-results-bucket', '')).toBe('custom-results-bucket');
        expect(getResultsStoreBucket('gs://custom-results-bucket/', '')).toBe('custom-results-bucket');
        expect(getResultsStoreBucket('gs://custom-results-bucket/subpath', '')).toBe('custom-results-bucket');
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
