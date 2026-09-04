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
    FILTER_KEYS_MAP,
    RESULTS_STORE_EXTRA_PARAM_KEYS,
    clearResultsStoreParams,
    clearSrcParams,
    syncResultsStoreParams
} from './urlParams';

describe('urlParams utils', () => {
    describe('clearResultsStoreParams', () => {
        it('clears all f_* filter parameters while preserving unrelated parameters', () => {
            const params = new URLSearchParams('view=inference-scheduling&f_models=gemma-4-31b-it&f_hw=H100&other=val');
            const changed = clearResultsStoreParams(params);

            expect(changed).toBe(true);
            expect(params.get('view')).toBe('inference-scheduling');
            expect(params.get('other')).toBe('val');
            expect(params.has('f_models')).toBe(false);
            expect(params.has('f_hw')).toBe(false);
        });

        it('clears all Results Store extra params (status, own, q, unlisted, communityOnly)', () => {
            const params = new URLSearchParams('view=home&status=approved&own=true&q=llama&unlisted=1&communityOnly=1&benchmarks=abc');
            const changed = clearResultsStoreParams(params);

            expect(changed).toBe(true);
            expect(params.get('view')).toBe('home');
            expect(params.has('status')).toBe(false);
            expect(params.has('own')).toBe(false);
            expect(params.has('q')).toBe(false);
            expect(params.has('unlisted')).toBe(false);
            expect(params.has('communityOnly')).toBe(false);
            expect(params.has('benchmarks')).toBe(false);
        });

        it('returns false if no Results Store params exist', () => {
            const params = new URLSearchParams('view=inference-scheduling&intent=test');
            const changed = clearResultsStoreParams(params);

            expect(changed).toBe(false);
            expect(params.toString()).toBe('view=inference-scheduling&intent=test');
        });
    });

    describe('clearSrcParams', () => {
        it('removes ?src= when present', () => {
            const params = new URLSearchParams('view=home&src=local&src=llmd_drive');
            const changed = clearSrcParams(params);

            expect(changed).toBe(true);
            expect(params.has('src')).toBe(false);
            expect(params.get('view')).toBe('home');
        });

        it('returns false when ?src= is not present', () => {
            const params = new URLSearchParams('view=home');
            const changed = clearSrcParams(params);

            expect(changed).toBe(false);
            expect(params.toString()).toBe('view=home');
        });
    });

    describe('syncResultsStoreParams', () => {
        it('synchronizes filters, status, search, and flags into URL params', () => {
            const params = new URLSearchParams('view=results-store&src=local');
            const activeFilters = {
                models: new Set(['gemma-4-31b-it']),
                hardware: new Set(['H100', 'B200']),
                tp: new Set(['8'])
            };

            syncResultsStoreParams(params, {
                kpiFilter: 'approved',
                includeUnlisted: true,
                communityOnly: false,
                searchTerm: 'llama',
                activeFilters
            });

            expect(params.get('view')).toBe('results-store');
            expect(params.has('src')).toBe(false);
            expect(params.get('status')).toBe('approved');
            expect(params.get('own')).toBe('true');
            expect(params.get('unlisted')).toBe('1');
            expect(params.has('communityOnly')).toBe(false);
            expect(params.get('q')).toBe('llama');
            expect(params.getAll('f_models')).toEqual(['gemma-4-31b-it']);
            expect(params.getAll('f_hw')).toEqual(['H100', 'B200']);
            expect(params.getAll('f_tp')).toEqual(['8']);
        });

        it('removes parameters when values are cleared', () => {
            const params = new URLSearchParams('view=results-store&status=approved&own=true&unlisted=1&q=test&f_models=gemma');
            syncResultsStoreParams(params, {
                kpiFilter: null,
                includeUnlisted: false,
                communityOnly: false,
                searchTerm: '',
                activeFilters: { models: new Set() }
            });

            expect(params.has('status')).toBe(false);
            expect(params.has('own')).toBe(false);
            expect(params.has('unlisted')).toBe(false);
            expect(params.has('q')).toBe(false);
            expect(params.has('f_models')).toBe(false);
            expect(params.has('src')).toBe(false);
        });
    });
});
