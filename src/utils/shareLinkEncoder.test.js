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

import { encodeShareLink, decodeShareLink, isValidUuid } from './shareLinkEncoder.js';
import assert from 'node:assert';

console.log('Running shareLinkEncoder unit tests...');

// 1. isValidUuid
assert.strictEqual(isValidUuid('123e4567-e89b-12d3-a456-426614174000'), true);
assert.strictEqual(isValidUuid('ACD1D5D0-5663-4560-8E82-98837E54D933'), true);
assert.strictEqual(isValidUuid('invalid-uuid'), false);
assert.strictEqual(isValidUuid('123e4567e89b12d3a456426614174000'), false);

// 2. Round-trip encoding and decoding (N = 1)
const singleUuid = ['123e4567-e89b-12d3-a456-426614174000'];
const encoded1 = encodeShareLink(singleUuid);
assert.strictEqual(typeof encoded1, 'string');
assert.strictEqual(encoded1.length, 22); // 24 chars - 2 padding = 22 URL-safe chars
const decoded1 = decodeShareLink(encoded1);
assert.deepStrictEqual(decoded1, singleUuid);

// 3. Round-trip encoding and decoding (N = 3)
const tripleUuids = [
    '123e4567-e89b-12d3-a456-426614174000',
    'acd1d5d0-5663-4560-8e82-98837e54d933',
    '88888888-4444-4444-4444-121212121212'
];
const encoded3 = encodeShareLink(tripleUuids);
assert.strictEqual(encoded3.length, 64);
const decoded3 = decodeShareLink(encoded3);
assert.deepStrictEqual(decoded3, tripleUuids);

// 4. Invalid decoding handling
assert.throws(() => decodeShareLink('!!!invalid_base64!!!'), /Malformed Base64/);
assert.throws(() => decodeShareLink(btoa('12345')), /Invalid byte alignment/); // 5 bytes, not multiple of 16

// 5. Empty inputs
assert.strictEqual(encodeShareLink([]), '');
assert.deepStrictEqual(decodeShareLink(''), []);

console.log('All shareLinkEncoder unit tests passed successfully!');
