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

import yaml from 'js-yaml';
import { zipSync, strToU8 } from 'fflate';
import { PrismResultPayload } from './api.ts';

/**
 * Sanitizes a string for safe filename and directory usage while preserving commas.
 */
export function sanitizeFilename(name: string): string {
    if (!name || typeof name !== 'string') return 'benchmark_report';
    return name
        .replace(/[^a-zA-Z0-9._,-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .substring(0, 100);
}

/**
 * Returns canonical BRV0.2 filename for a given stage index.
 */
export function getBRV02StageFilename(stageIndex: number): string {
    const stageNum = typeof stageIndex === 'number' && !isNaN(stageIndex) ? stageIndex : 0;
    return `benchmark_report_v0.2,_stage_${stageNum}_lifecycle_metrics.json.yaml`;
}

/**
 * Resolves a human-friendly run label from PrismResultPayload,
 * ignoring internal synthetic keys (e.g. "brv02:...", "results-store:...").
 */
export function resolvePayloadRunLabel(payload: PrismResultPayload): string {
    const firstReport = (payload.entries?.[0]?.raw_report || {}) as Record<string, any>;
    const rawStack = Array.isArray(firstReport.scenario?.stack) ? firstReport.scenario.stack : [];
    const stackModel = rawStack.find((c: any) => c?.standardized?.model?.name)?.standardized?.model?.name;
    const modelName = payload.model_name || stackModel || '';

    const candidates = [
        payload.runLabel,
        firstReport.run?.description,
        firstReport.run?.label,
        firstReport.scenario?.model,
    ];

    // Priority 1: Pick first non-empty, non-synthetic label that isn't the model name or generic string
    for (const c of candidates) {
        if (c && typeof c === 'string') {
            const trimmed = c.trim();
            if (
                trimmed &&
                !trimmed.startsWith('brv02:') &&
                !trimmed.startsWith('results-store:') &&
                !trimmed.startsWith('file:') &&
                trimmed.toLowerCase() !== 'custom model' &&
                trimmed.toLowerCase() !== 'unknown' &&
                trimmed.toLowerCase() !== 'unknown model' &&
                (modelName ? trimmed.toLowerCase() !== modelName.toLowerCase() : true)
            ) {
                return trimmed;
            }
        }
    }

    // Priority 2: Fallback to any valid non-synthetic candidate or modelName
    for (const c of candidates) {
        if (c && typeof c === 'string') {
            const trimmed = c.trim();
            if (
                trimmed &&
                !trimmed.startsWith('brv02:') &&
                !trimmed.startsWith('results-store:') &&
                !trimmed.startsWith('file:')
            ) {
                return trimmed;
            }
        }
    }

    return modelName || 'benchmark_run';
}

/**
 * Serializes a raw BRV0.2 report object into a clean YAML string.
 */
export function serializeRawReportToYaml(rawReport: unknown): string {
    if (!rawReport) return '';
    if (typeof rawReport === 'string') return rawReport;
    return yaml.dump(rawReport, {
        noRefs: true,
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false,
    });
}

/**
 * Packs all constituent stage entries of a PrismResultPayload into a ZIP buffer containing BRV0.2 .yaml files.
 */
export function createRunZipBuffer(payload: PrismResultPayload): { buffer: Buffer; filename: string } {
    const rawLabel = resolvePayloadRunLabel(payload);
    const runLabel = sanitizeFilename(rawLabel);
    const rawRunId = payload.runId || '';
    const shortRunId = rawRunId ? (rawRunId.split('-')[0] || rawRunId.substring(0, 8)) : '';
    const archiveName = shortRunId ? `${runLabel}-${shortRunId}` : runLabel;
    const zipFiles: Record<string, Uint8Array> = {};

    const entries = payload.entries || [];
    entries.forEach((entry, idx) => {
        const rawYaml = serializeRawReportToYaml(entry.raw_report);
        const stageNum = entry.prism_stage_index ?? idx;
        const cleanStageName = getBRV02StageFilename(stageNum);
        const fullPath = `${archiveName}/${cleanStageName}`;
        zipFiles[fullPath] = strToU8(rawYaml);
    });

    const zipped = zipSync(zipFiles);
    return {
        buffer: Buffer.from(zipped),
        filename: `${archiveName}.zip`,
    };
}
