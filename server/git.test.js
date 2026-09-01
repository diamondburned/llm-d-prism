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
import { parseGitCommit } from './git.js';

describe('server git version resolver', () => {
    it('returns null when env variable is not provided or empty', () => {
        expect(parseGitCommit(undefined)).toBeNull();
        expect(parseGitCommit(null)).toBeNull();
        expect(parseGitCommit('')).toBeNull();
        expect(parseGitCommit('   ')).toBeNull();
    });

    it('formats 40-character full commit SHA from deploy.sh to a 7-character display', () => {
        const fullSha = '1c4b0b329437198a1234567890abcdef12345678';
        expect(parseGitCommit(fullSha)).toEqual({
            commit: fullSha,
            display: '1c4b0b3'
        });
    });

    it('parses dirty tag from local development (e.g. 1c4b0b3-dirty)', () => {
        expect(parseGitCommit('1c4b0b3-dirty')).toEqual({
            commit: '1c4b0b3',
            display: '1c4b0b3-dirty'
        });
    });

    it('parses clean short tag from local development', () => {
        expect(parseGitCommit('1c4b0b3')).toEqual({
            commit: '1c4b0b3',
            display: '1c4b0b3'
        });
    });

    it('parses tagged describe strings with dirty flag', () => {
        expect(parseGitCommit('v0.1.0-4-g1c4b0b3-dirty')).toEqual({
            commit: '1c4b0b3',
            display: 'v0.1.0-4-g1c4b0b3-dirty'
        });
    });
});
