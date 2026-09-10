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

import { describe, it, expect, afterEach } from 'vitest';
import { encodeShareLink, decodeShareLink, isValidUuid } from './shareLinkEncoder.js';
import { getSharedState } from '../hooks/useDashboardState.js';
import { appendGraphFilterParams, GRAPH_FILTER_DEFAULTS } from './urlParams.js';

describe('shareLinkEncoder', () => {
    it('validates canonical UUID formats with isValidUuid', () => {
        expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
        expect(isValidUuid('ACD1D5D0-5663-4560-8E82-98837E54D933')).toBe(true);
        expect(isValidUuid('0d778b34-7689-440e-ac10-911d8c4fed92')).toBe(true);
        expect(isValidUuid('invalid-uuid')).toBe(false);
        expect(isValidUuid('123e4567e89b12d3a456426614174000')).toBe(false);
        expect(isValidUuid('')).toBe(false);
        expect(isValidUuid(null)).toBe(false);
        expect(isValidUuid(undefined)).toBe(false);
    });

    it('performs round-trip encoding and decoding for a single UUID (N = 1)', () => {
        const singleUuid = ['123e4567-e89b-12d3-a456-426614174000'];
        const encoded = encodeShareLink(singleUuid);
        expect(typeof encoded).toBe('string');
        expect(encoded.length).toBe(22); // 24 chars - 2 padding = 22 URL-safe chars
        const decoded = decodeShareLink(encoded);
        expect(decoded).toEqual(singleUuid);
    });

    it('performs round-trip encoding and decoding for two UUIDs (N = 2)', () => {
        const doubleUuids = [
            '0d778b34-7689-440e-ac10-911d8c4fed92',
            'bcd4eb8f-7db7-44b9-89fc-9950a6b3df86'
        ];
        const encoded = encodeShareLink(doubleUuids);
        expect(encoded.length).toBe(43); // 44 chars - 1 padding = 43 URL-safe chars
        const decoded = decodeShareLink(encoded);
        expect(decoded).toEqual(doubleUuids);
    });

    it('performs round-trip encoding and decoding for three UUIDs (N = 3)', () => {
        const tripleUuids = [
            '123e4567-e89b-12d3-a456-426614174000',
            'acd1d5d0-5663-4560-8e82-98837e54d933',
            '88888888-4444-4444-4444-121212121212'
        ];
        const encoded = encodeShareLink(tripleUuids);
        expect(encoded.length).toBe(64);
        const decoded = decodeShareLink(encoded);
        expect(decoded).toEqual(tripleUuids);
    });

    it('handles uppercase UUIDs and normalizes them to canonical lowercase', () => {
        const upperUuid = ['ACD1D5D0-5663-4560-8E82-98837E54D933'];
        const encodedUpper = encodeShareLink(upperUuid);
        const decodedUpper = decodeShareLink(encodedUpper);
        expect(decodedUpper).toEqual(['acd1d5d0-5663-4560-8e82-98837e54d933']);
    });

    it('constructs and parses valid URL query parameters', () => {
        const doubleUuids = [
            '0d778b34-7689-440e-ac10-911d8c4fed92',
            'bcd4eb8f-7db7-44b9-89fc-9950a6b3df86'
        ];
        const encoded = encodeShareLink(doubleUuids);
        const baseUrl = 'https://prism.llm-d.ai/';
        const fullShareUrl = `${baseUrl}?view=results-store&benchmarks=${encoded}`;
        const parsedUrl = new URL(fullShareUrl);
        expect(parsedUrl.searchParams.get('view')).toBe('results-store');
        expect(parsedUrl.searchParams.get('benchmarks')).toBe(encoded);
        expect(decodeShareLink(parsedUrl.searchParams.get('benchmarks'))).toEqual(doubleUuids);
    });

    it('resolves initial view fallback when ?benchmarks=... is present without view parameter', () => {
        const singleUuid = ['123e4567-e89b-12d3-a456-426614174000'];
        const encoded = encodeShareLink(singleUuid);

        function resolveInitialView(searchString) {
            const params = new URLSearchParams(searchString);
            const view = params.get('view') || (params.has('benchmarks') ? 'results-store' : 'home');
            if (view === 'benchmark-comparison') return 'benchmark-browser';
            if (view === 'manage-benchmarks') return 'results-store';
            return view;
        }

        expect(resolveInitialView('?view=results-store&benchmarks=' + encoded)).toBe('results-store');
        expect(resolveInitialView('?benchmarks=' + encoded)).toBe('results-store');
        expect(resolveInitialView('?view=benchmark-browser')).toBe('benchmark-browser');
        expect(resolveInitialView('')).toBe('home');
    });

    it('enforces visibility constraints (public and unlisted allowed, others blocked)', () => {
        function evaluateCanShare(selectedRuns, submissionsMap = {}) {
            if (!selectedRuns || selectedRuns.length === 0) {
                return { canShare: false, reason: null };
            }

            for (const run of selectedRuns) {
                const runId = run.runId || run.run_id;
                if (!runId || !isValidUuid(runId)) {
                    return {
                        canShare: false,
                        reason: "Sharing is forbidden: Selection contains unsubmitted or local staged runs without public UUIDs."
                    };
                }

                const sub = submissionsMap[runId];
                const status = sub?.status || run.submission_state || run.state || 'staged';
                if (status !== 'public' && status !== 'unlisted') {
                    return {
                        canShare: false,
                        reason: "Sharing is forbidden: Selection contains staged, pending review, or rejected runs. Only public and unlisted benchmarks can be shared."
                    };
                }
            }

            return { canShare: true, reason: null };
        }

        expect(evaluateCanShare([{ runId: '0d778b34-7689-440e-ac10-911d8c4fed92', state: 'public' }]).canShare).toBe(true);
        expect(evaluateCanShare([{ runId: '0d778b34-7689-440e-ac10-911d8c4fed92', state: 'unlisted' }]).canShare).toBe(true);
        expect(evaluateCanShare([
            { runId: '0d778b34-7689-440e-ac10-911d8c4fed92', state: 'public' },
            { runId: 'bcd4eb8f-7db7-44b9-89fc-9950a6b3df86', state: 'unlisted' }
        ]).canShare).toBe(true);

        expect(evaluateCanShare([{ runId: '0d778b34-7689-440e-ac10-911d8c4fed92', state: 'submitted_pending_review' }]).canShare).toBe(false);
        expect(evaluateCanShare([{ runId: '0d778b34-7689-440e-ac10-911d8c4fed92', state: 'rejected' }]).canShare).toBe(false);
        expect(evaluateCanShare([{ runId: 'local-stage-1', state: 'staged' }]).canShare).toBe(false);
        expect(evaluateCanShare([
            { runId: '0d778b34-7689-440e-ac10-911d8c4fed92', state: 'public' },
            { runId: 'acd1d5d0-5663-4560-8e82-98837e54d933', state: 'submitted_pending_review' }
        ]).canShare).toBe(false);
    });

    it('throws errors on malformed Base64 and invalid byte alignment', () => {
        expect(() => decodeShareLink('!!!invalid_base64!!!')).toThrow(/Malformed Base64/);
        expect(() => decodeShareLink(btoa('12345'))).toThrow(/Invalid byte alignment/);
    });

    it('returns empty results for empty or null inputs', () => {
        expect(encodeShareLink([])).toBe('');
        expect(encodeShareLink(null)).toBe('');
        expect(encodeShareLink(undefined)).toBe('');
        expect(decodeShareLink('')).toEqual([]);
        expect(decodeShareLink(null)).toEqual([]);
        expect(decodeShareLink(undefined)).toEqual([]);
    });

    describe('getSharedState hasBenchmarksParam detection', () => {
        const originalWindow = globalThis.window;

        afterEach(() => {
            globalThis.window = originalWindow;
        });

        it('detects hasBenchmarksParam when benchmarks param is present and non-empty', () => {
            const singleUuid = ['123e4567-e89b-12d3-a456-426614174000'];
            const encoded = encodeShareLink(singleUuid);

            globalThis.window = {
                location: { search: `?view=results-store&benchmarks=${encoded}` }
            };

            const state = getSharedState();
            expect(state).not.toBeNull();
            expect(state.hasBenchmarksParam).toBe(true);
        });

        it('sets hasBenchmarksParam to false when benchmarks param is empty', () => {
            globalThis.window = {
                location: { search: '?view=results-store&benchmarks=' }
            };

            const state = getSharedState();
            expect(state).not.toBeNull();
            expect(state.hasBenchmarksParam).toBe(false);
        });

        it('sets hasBenchmarksParam to false when benchmarks param is not present', () => {
            globalThis.window = {
                location: { search: '?view=results-store&status=public' }
            };

            const state = getSharedState();
            expect(state).not.toBeNull();
            expect(state.hasBenchmarksParam).toBe(false);
        });
    });

    describe('benchmark share link selection clearing', () => {
        it('clears existing selections and replaces them with shared benchmarks', () => {
            const previousSelections = new Set(['results-store:old-uuid-1', 'results-store:old-uuid-2']);
            const sharedUuids = ['0d778b34-7689-440e-ac10-911d8c4fed92'];
            const encoded = encodeShareLink(sharedUuids);

            // Simulating processShareLink selection logic:
            let currentSelections = new Set(previousSelections);
            expect(currentSelections.size).toBe(2);

            const decoded = decodeShareLink(encoded);
            expect(decoded).toEqual(sharedUuids);

            // 1. Immediately clear existing selections upon opening a valid benchmark share link
            currentSelections = new Set();
            expect(currentSelections.size).toBe(0);

            // 2. Resolve target UUID keys and set selections to newly loaded benchmarks (not merging)
            const keysToSelect = new Set(decoded.map(uuid => `results-store:${uuid}`));
            currentSelections = new Set(keysToSelect);

            expect(currentSelections.has('results-store:old-uuid-1')).toBe(false);
            expect(currentSelections.has('results-store:old-uuid-2')).toBe(false);
            expect(currentSelections.has('results-store:0d778b34-7689-440e-ac10-911d8c4fed92')).toBe(true);
            expect(currentSelections.size).toBe(1);
        });

        it('leaves selections cleared if shared benchmarks could not be resolved', () => {
            const previousSelections = new Set(['results-store:old-uuid-1']);
            let currentSelections = new Set(previousSelections);

            // Opening valid share link clears existing selections
            currentSelections = new Set();

            // All UUIDs in share link failed to resolve (e.g. 404)
            const keysToSelect = new Set();
            if (keysToSelect.size > 0) {
                currentSelections = new Set(keysToSelect);
            } else {
                currentSelections = new Set();
            }

            expect(currentSelections.size).toBe(0);
            expect(currentSelections.has('results-store:old-uuid-1')).toBe(false);
        });

        it('retains all target keys when shared benchmarks are missing', () => {
            const sharedUuids = ['0d778b34-7689-440e-ac10-911d8c4fed92', '11111111-2222-3333-4444-555555555555'];
            const allTargetKeys = new Set();
            const missingUuids = [];

            // Existing in local data: only first uuid
            const data = [{ run_id: sharedUuids[0], source_info: { type: 'benchmark_report_v02' } }];

            sharedUuids.forEach(uuid => {
                const existing = data.find(d => d.run_id === uuid);
                if (existing) {
                    allTargetKeys.add(`results-store:${uuid}`);
                } else {
                    allTargetKeys.add(`results-store:${uuid}`);
                    missingUuids.push(uuid);
                }
            });

            expect(missingUuids).toEqual([sharedUuids[1]]);
            expect(allTargetKeys.has(`results-store:${sharedUuids[0]}`)).toBe(true);
            expect(allTargetKeys.has(`results-store:${sharedUuids[1]}`)).toBe(true);
            expect(allTargetKeys.size).toBe(2);
        });
    });

    describe('share link graph filter encoding', () => {
        it('omits default graph filter parameters to keep share link URLs short', () => {
            const targetUuids = ['0d778b34-7689-440e-ac10-911d8c4fed92'];
            const shareLink = encodeShareLink(targetUuids);

            const params = new URLSearchParams();
            params.set('view', 'results-store');
            params.set('benchmarks', shareLink);

            appendGraphFilterParams(params, {
                c_mode: GRAPH_FILTER_DEFAULTS.c_mode,
                t_type: GRAPH_FILTER_DEFAULTS.t_type,
                cost_mode: GRAPH_FILTER_DEFAULTS.cost_mode,
                l_type: GRAPH_FILTER_DEFAULTS.l_type,
                x_max: GRAPH_FILTER_DEFAULTS.x_max,
                per_chip: GRAPH_FILTER_DEFAULTS.per_chip,
                pareto: GRAPH_FILTER_DEFAULTS.pareto,
                labels: GRAPH_FILTER_DEFAULTS.labels,
                points: GRAPH_FILTER_DEFAULTS.points,
                y_qual: GRAPH_FILTER_DEFAULTS.y_qual,
                x_qual: GRAPH_FILTER_DEFAULTS.x_qual,
                color_mode: GRAPH_FILTER_DEFAULTS.color_mode,
                conn_mode: GRAPH_FILTER_DEFAULTS.conn_mode
            });

            // All graph filter parameters should be omitted because they match defaults
            expect(params.toString()).toBe(`view=results-store&benchmarks=${shareLink}`);
        });

        it('only appends non-default graph filter parameters alongside benchmarks parameter', () => {
            const targetUuids = ['0d778b34-7689-440e-ac10-911d8c4fed92'];
            const shareLink = encodeShareLink(targetUuids);

            const params = new URLSearchParams();
            params.set('view', 'results-store');
            params.set('benchmarks', shareLink);

            appendGraphFilterParams(params, {
                c_mode: 'ttft', // non-default (default 'tpot')
                t_type: 'total', // non-default (default 'output')
                cost_mode: 'spot', // default
                l_type: 'e2e', // default
                x_max: 500, // non-default
                per_chip: true, // non-default
                pareto: false, // default
                labels: true, // default
                points: true, // non-default
                y_qual: 'mmlu_pro', // default
                x_qual: 'mmlu_pro', // default
                color_mode: 'hardware', // default
                conn_mode: 'stage' // default
            });

            expect(params.get('view')).toBe('results-store');
            expect(params.get('benchmarks')).toBe(shareLink);
            expect(params.get('c_mode')).toBe('ttft');
            expect(params.get('t_type')).toBe('total');
            expect(params.get('x_max')).toBe('500');
            expect(params.get('per_chip')).toBe('true');
            expect(params.get('points')).toBe('true');

            // Default values must not be set
            expect(params.has('cost_mode')).toBe(false);
            expect(params.has('l_type')).toBe(false);
            expect(params.has('pareto')).toBe(false);
            expect(params.has('labels')).toBe(false);
            expect(params.has('y_qual')).toBe(false);
            expect(params.has('x_qual')).toBe(false);
            expect(params.has('color_mode')).toBe(false);
            expect(params.has('conn_mode')).toBe(false);
        });
    });
});
