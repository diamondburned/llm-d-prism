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

export const FILTER_KEYS_MAP = {
    hardware: 'f_hw',
    machines: 'f_mach',
    tp: 'f_tp',
    precisions: 'f_prec',
    isl: 'f_isl',
    osl: 'f_osl',
    ratio: 'f_ratio',
    pdRatio: 'f_pd_ratio',
    modelServer: 'f_ms',
    servingStack: 'f_ss',
    origins: 'f_origin',
    acc_count: 'f_acc',
    useCase: 'f_uc',
    optimizations: 'f_opt',
    components: 'f_comp',
    models: 'f_models'
};

export const RESULTS_STORE_EXTRA_PARAM_KEYS = [
    'status',
    'kpiFilter',
    'own',
    'unlisted',
    'includeUnlisted',
    'communityOnly',
    'community_only',
    'community',
    'q',
    'search',
    'benchmarks'
];

/**
 * Removes all Results Store filter params (f_*) and extra params from a URLSearchParams object.
 * @param {URLSearchParams} params
 * @returns {boolean} Whether any params were removed
 */
export const clearResultsStoreParams = (params) => {
    let changed = false;
    const keys = Array.from(params.keys());
    for (const key of keys) {
        if (key.startsWith('f_')) {
            params.delete(key);
            changed = true;
        }
    }
    for (const key of RESULTS_STORE_EXTRA_PARAM_KEYS) {
        if (params.has(key)) {
            params.delete(key);
            changed = true;
        }
    }
    return changed;
};

/**
 * Removes the ?src= parameter from a URLSearchParams object.
 * @param {URLSearchParams} params
 * @returns {boolean} Whether ?src= was present and removed
 */
export const clearSrcParams = (params) => {
    if (params.has('src')) {
        params.delete('src');
        return true;
    }
    return false;
};

/**
 * Synchronizes Results Store state (kpiFilter, includeUnlisted, communityOnly, searchTerm, activeFilters)
 * into a URLSearchParams object, ensuring ?src= is also stripped.
 * @param {URLSearchParams} params
 * @param {Object} state
 */
export const syncResultsStoreParams = (params, { kpiFilter, includeUnlisted, communityOnly, searchTerm, activeFilters }) => {
    if (kpiFilter) {
        params.set('status', kpiFilter);
        params.set('kpiFilter', kpiFilter);
        if (['my-submissions', 'staged', 'unlisted', 'processing', 'in_review', 'approved', 'action'].includes(kpiFilter)) {
            params.set('own', 'true');
        } else {
            params.delete('own');
        }
    } else {
        params.delete('status');
        params.delete('kpiFilter');
        params.delete('own');
    }

    if (includeUnlisted) {
        params.set('unlisted', '1');
        params.set('includeUnlisted', '1');
    } else {
        params.delete('unlisted');
        params.delete('includeUnlisted');
    }

    if (communityOnly) {
        params.set('communityOnly', '1');
    } else {
        params.delete('communityOnly');
        params.delete('community_only');
        params.delete('community');
    }

    if (searchTerm) {
        params.set('q', searchTerm);
    } else {
        params.delete('q');
        params.delete('search');
    }

    // Clear and sync activeFilters
    Object.values(FILTER_KEYS_MAP).forEach(paramKey => params.delete(paramKey));
    if (activeFilters) {
        Object.entries(FILTER_KEYS_MAP).forEach(([filterKey, paramKey]) => {
            const setVal = activeFilters[filterKey];
            if (setVal && setVal.size > 0) {
                Array.from(setVal).forEach(val => params.append(paramKey, val));
            }
        });
    }

    // Always ensure src is not in URL
    params.delete('src');
};
