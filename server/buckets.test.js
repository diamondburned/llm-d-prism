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

import {
    parseBucketEntry,
    getResultsStoreBucket,
    getConfiguredBucketEntries,
    getConfiguredBucketNames,
    DEFAULT_RESULTS_STORE_BUCKET,
    DEFAULT_RESULTS_BUCKETS
} from './buckets.js';
import assert from 'node:assert';

console.log('Running buckets unit tests...');

// 1. parseBucketEntry: bare bucket names
assert.deepStrictEqual(parseBucketEntry('my-bucket'), { bucket: 'my-bucket', prefix: '' });
assert.deepStrictEqual(parseBucketEntry(' my-bucket '), { bucket: 'my-bucket', prefix: '' });
assert.deepStrictEqual(parseBucketEntry('gs://my-bucket/'), { bucket: 'my-bucket', prefix: '' });
assert.deepStrictEqual(parseBucketEntry(''), { bucket: '', prefix: '' });
assert.deepStrictEqual(parseBucketEntry(null), { bucket: '', prefix: '' });

// 2. parseBucketEntry: path-scoped entries yield a normalized trailing-slash prefix
assert.deepStrictEqual(parseBucketEntry('my-bucket/team-a'), { bucket: 'my-bucket', prefix: 'team-a/' });
assert.deepStrictEqual(parseBucketEntry('my-bucket/team-a/results/'), { bucket: 'my-bucket', prefix: 'team-a/results/' });
assert.deepStrictEqual(parseBucketEntry('gs://my-bucket/team-a/'), { bucket: 'my-bucket', prefix: 'team-a/' });
assert.deepStrictEqual(parseBucketEntry('my-bucket//team-a//'), { bucket: 'my-bucket', prefix: 'team-a/' });

// 3. getResultsStoreBucket: default and custom values
assert.strictEqual(DEFAULT_RESULTS_STORE_BUCKET, 'llm-d-benchmarks');
assert.strictEqual(getResultsStoreBucket(undefined), 'llm-d-benchmarks');
assert.strictEqual(getResultsStoreBucket(''), 'llm-d-benchmarks');
assert.strictEqual(getResultsStoreBucket('custom-results-bucket'), 'custom-results-bucket');
assert.strictEqual(getResultsStoreBucket('gs://custom-results-bucket/'), 'custom-results-bucket');
assert.strictEqual(getResultsStoreBucket('gs://custom-results-bucket/subpath'), 'custom-results-bucket');

// 4. Dev config: RESULTS_STORE_BUCKET=llm-d-benchmarks, DEFAULT_BUCKETS=llm-d-benchmarks,llm-d-benchmarks-staging
assert.deepStrictEqual(
    getConfiguredBucketEntries('llm-d-benchmarks,llm-d-benchmarks-staging', 'llm-d-benchmarks'),
    ['llm-d-benchmarks', 'llm-d-benchmarks-staging']
);
assert.deepStrictEqual(
    getConfiguredBucketNames('llm-d-benchmarks,llm-d-benchmarks-staging', 'llm-d-benchmarks'),
    ['llm-d-benchmarks', 'llm-d-benchmarks-staging']
);

// 5. Prod config: RESULTS_STORE_BUCKET=llm-d-benchmarks, DEFAULT_BUCKETS=llm-d-benchmarks
assert.deepStrictEqual(
    getConfiguredBucketEntries('llm-d-benchmarks', 'llm-d-benchmarks'),
    ['llm-d-benchmarks']
);
assert.deepStrictEqual(
    getConfiguredBucketNames('llm-d-benchmarks', 'llm-d-benchmarks'),
    ['llm-d-benchmarks']
);

// 6. Path-scoped DEFAULT_BUCKETS are retained
assert.deepStrictEqual(
    getConfiguredBucketEntries('llm-d-benchmarks/team-a,llm-d-benchmarks-staging/team-b', 'llm-d-benchmarks'),
    ['llm-d-benchmarks/team-a', 'llm-d-benchmarks-staging/team-b']
);
assert.deepStrictEqual(
    getConfiguredBucketNames('llm-d-benchmarks/team-a,llm-d-benchmarks-staging/team-b', 'llm-d-benchmarks'),
    ['llm-d-benchmarks', 'llm-d-benchmarks-staging']
);

// 7. Custom buckets pass through
assert.deepStrictEqual(
    getConfiguredBucketEntries('bucket-a, bucket-b/sub/dir ,,', 'llm-d-benchmarks'),
    ['bucket-a', 'bucket-b/sub/dir']
);
assert.deepStrictEqual(
    getConfiguredBucketNames('bucket-a, bucket-b/sub/dir ,,', 'llm-d-benchmarks'),
    ['bucket-a', 'bucket-b']
);

// 8. Multiple prefixes of the same bucket are independent entries
assert.deepStrictEqual(
    getConfiguredBucketEntries('b1/p1,b1/p2,b2/p3', 'llm-d-benchmarks'),
    ['b1/p1', 'b1/p2', 'b2/p3']
);
assert.deepStrictEqual(
    getConfiguredBucketNames('b1/p1,b1/p2,b2/p3', 'llm-d-benchmarks'),
    ['b1', 'b1', 'b2']
);

// 9. Fallback to DEFAULT_BUCKETS[0] when RESULTS_STORE_BUCKET is not set
assert.strictEqual(getResultsStoreBucket(undefined, 'custom-bucket,other-bucket'), 'custom-bucket');
assert.strictEqual(getResultsStoreBucket('', 'custom-bucket,other-bucket'), 'custom-bucket');
assert.strictEqual(getResultsStoreBucket(undefined, 'gs://scoped-bucket/sub/path, other-bucket'), 'scoped-bucket');
assert.deepStrictEqual(getConfiguredBucketEntries('b1,b2', undefined), ['b1', 'b2']);
assert.deepStrictEqual(getConfiguredBucketNames('b1/p1,b2/p2', undefined), ['b1', 'b2']);

// 10. Default fallback with no args: DEFAULT_RESULTS_BUCKETS ('llm-d-benchmarks')
assert.deepStrictEqual(getConfiguredBucketEntries(undefined, undefined), ['llm-d-benchmarks']);
assert.deepStrictEqual(getConfiguredBucketNames(undefined, undefined), ['llm-d-benchmarks']);
assert.deepStrictEqual(getConfiguredBucketNames('', undefined), ['llm-d-benchmarks']);

console.log('All buckets unit tests passed successfully!');
