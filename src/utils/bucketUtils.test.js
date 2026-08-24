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
import { getCanonicalBucketName, getBucketAlias, dedupeBucketConfigs, getBucketBaseName, getBucketPrefix } from './bucketUtils.js';

describe('bucketUtils', () => {
    it('canonicalizes bucket names with getCanonicalBucketName', () => {
        expect(getCanonicalBucketName('gs://slabe-bucket')).toBe('slabe-bucket');
        expect(getCanonicalBucketName('gs://slabe-bucket/')).toBe('slabe-bucket');
        expect(getCanonicalBucketName('slabe-bucket')).toBe('slabe-bucket');
        expect(getCanonicalBucketName('s3://my-aws-bucket/')).toBe('my-aws-bucket');
        expect(getCanonicalBucketName({ bucket: 'gs://slabe-bucket/', alias: 'slabe' })).toBe('slabe-bucket');
        expect(getCanonicalBucketName(null)).toBe('');
    });

    it('extracts bucket aliases with getBucketAlias', () => {
        expect(getBucketAlias({ bucket: 'slabe-bucket', alias: 'slabe' })).toBe('slabe');
        expect(getBucketAlias('slabe-bucket')).toBe(null);
        expect(getBucketAlias({ bucket: 'slabe-bucket' })).toBe(null);
    });

    it('deduplicates bucket configs and retains alias info', () => {
        const sampleInput = [
            { bucket: 'slabe-bucket', alias: 'slabe' },
            'slabe-bucket',
            'gs://slabe-bucket',
            'gs://slabe-bucket/',
            { bucket: 'gs://slabe-bucket/', alias: 'slabe' },
            'other-bucket',
            { bucket: 'other-bucket', alias: 'Other' }
        ];

        const result = dedupeBucketConfigs(sampleInput);
        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ bucket: 'slabe-bucket', alias: 'slabe' });
        expect(result[1]).toEqual({ bucket: 'other-bucket', alias: 'Other' });
    });

    it('upgrades simple string when followed by aliased object in deduplication', () => {
        const sampleOrder2 = [
            'gs://slabe-bucket',
            { bucket: 'slabe-bucket', alias: 'slabe' }
        ];
        const result2 = dedupeBucketConfigs(sampleOrder2);
        expect(result2.length).toBe(1);
        expect(result2[0]).toEqual({ bucket: 'slabe-bucket', alias: 'slabe' });
    });

    it('retains path scoping as identity in canonical bucket name', () => {
        expect(getCanonicalBucketName('gs://slabe-bucket/team-a/results/')).toBe('slabe-bucket/team-a/results');
        expect(getCanonicalBucketName({ bucket: 'slabe-bucket/team-a' })).toBe('slabe-bucket/team-a');
    });

    it('strips path scoping with getBucketBaseName', () => {
        expect(getBucketBaseName('slabe-bucket')).toBe('slabe-bucket');
        expect(getBucketBaseName('gs://slabe-bucket/team-a/results/')).toBe('slabe-bucket');
        expect(getBucketBaseName({ bucket: 'gs://slabe-bucket/team-a', alias: 'slabe' })).toBe('slabe-bucket');
        expect(getBucketBaseName(null)).toBe('');
    });

    it('extracts normalized trailing-slash prefixes with getBucketPrefix', () => {
        expect(getBucketPrefix('slabe-bucket')).toBe('');
        expect(getBucketPrefix('slabe-bucket/team-a')).toBe('team-a/');
        expect(getBucketPrefix('gs://slabe-bucket/team-a/results/')).toBe('team-a/results/');
        expect(getBucketPrefix('slabe-bucket//team-a//')).toBe('team-a/');
        expect(getBucketPrefix({ bucket: 'slabe-bucket/team-a', alias: 'slabe' })).toBe('team-a/');
        expect(getBucketPrefix(null)).toBe('');
    });

    it('treats different prefixes of the same bucket as distinct sources during deduplication', () => {
        const scopedInput = [
            'slabe-bucket/team-a',
            'gs://slabe-bucket/team-a/',
            'slabe-bucket/team-b',
            'slabe-bucket'
        ];
        const scopedResult = dedupeBucketConfigs(scopedInput);
        expect(scopedResult.length).toBe(3);
        expect(scopedResult).toEqual(['slabe-bucket/team-a', 'slabe-bucket/team-b', 'slabe-bucket']);
    });
});
