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
 * Share Link Binary Base64 Encoder / Decoder for Prism Results Store
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(uuid) {
    return typeof uuid === 'string' && UUID_REGEX.test(uuid);
}

/**
 * Encodes an array of 36-character canonical UUID strings into a compact Base64 URL-safe string.
 * @param {string[]} uuids Array of UUID strings (format: 8-4-4-4-12)
 * @returns {string} URL-safe Base64 encoded binary string
 */
export function encodeShareLink(uuids) {
    if (!Array.isArray(uuids) || uuids.length === 0) {
        return '';
    }

    const byteArrays = [];

    for (const uuid of uuids) {
        if (!isValidUuid(uuid)) {
            throw new Error(`Invalid UUID format: ${uuid}`);
        }

        const hex = uuid.replace(/-/g, '');
        if (hex.length !== 32) {
            throw new Error(`Invalid UUID length after hyphen removal: ${uuid}`);
        }

        const bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
            bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        byteArrays.push(bytes);
    }

    // Concatenate all 16-byte arrays into contiguous Uint8Array (length 16 * N)
    const totalBytes = new Uint8Array(16 * byteArrays.length);
    byteArrays.forEach((arr, idx) => {
        totalBytes.set(arr, idx * 16);
    });

    // Convert Uint8Array to binary string for btoa
    let binary = '';
    for (let i = 0; i < totalBytes.length; i++) {
        binary += String.fromCharCode(totalBytes[i]);
    }

    let base64;
    if (typeof btoa === 'function') {
        base64 = btoa(binary);
    } else if (typeof globalThis !== 'undefined' && globalThis.Buffer) {
        base64 = globalThis.Buffer.from(totalBytes).toString('base64');
    } else {
        throw new Error("Base64 encoding not supported in this environment");
    }

    // Make URL-safe: replace '+' with '-', '/' with '_', trim padding '='
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a compact Base64 URL-safe string into an array of 36-character canonical UUID strings.
 * @param {string} base64Str URL-safe Base64 encoded binary string
 * @returns {string[]} Array of UUID strings (format: 8-4-4-4-12)
 */
export function decodeShareLink(base64Str) {
    if (!base64Str || typeof base64Str !== 'string') {
        return [];
    }

    // Restore standard Base64 characters and padding
    let base64 = base64Str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
        base64 += '=';
    }

    let binary;
    try {
        if (typeof atob === 'function') {
            binary = atob(base64);
        } else if (typeof globalThis !== 'undefined' && globalThis.Buffer) {
            binary = globalThis.Buffer.from(base64, 'base64').toString('binary');
        } else {
            throw new Error("Base64 decoding not supported in this environment");
        }
    } catch {
        throw new Error("Malformed Base64 parameter");
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    // Validation: bytes.length > 0 and byte length must be a multiple of 16
    if (bytes.length === 0 || bytes.length % 16 !== 0) {
        throw new Error("Invalid byte alignment. Length must be a positive multiple of 16.");
    }

    const uuids = [];
    for (let i = 0; i < bytes.length; i += 16) {
        const chunk = bytes.subarray(i, i + 16);
        let hex = '';
        for (let j = 0; j < 16; j++) {
            hex += chunk[j].toString(16).padStart(2, '0');
        }

        const uuid = `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
        uuids.push(uuid.toLowerCase());
    }

    return uuids;
}
