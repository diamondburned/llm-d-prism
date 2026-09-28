import yaml from 'js-yaml';
import { parseReportV02, stageToEntry, detectMissingUnitWarnings } from './benchmarkReportV02Parser.js';
import { normalizeModelName, normalizeHardware } from './dataParser.js';
import { PrismResultPayloadSchema } from '../../server/results/api.ts';


export function validateFormat(fileContent, filename) {
    let parsedDoc;
    try {
        if (filename.endsWith('.json')) {
            parsedDoc = JSON.parse(fileContent);
        } else {
            parsedDoc = yaml.load(fileContent);
        }
    } catch {
        return { format: false, error: "Invalid YAML/JSON format" };
    }

    if (!parsedDoc) {
        return { format: false, error: "Empty document" };
    }

    const ver = String(parsedDoc.version || '').trim();
    if (ver === "0.2" || ver.startsWith("0.2.") || ver === "v0.2" || ver.startsWith("v0.2.") || parsedDoc.schema === "v0.2" || (parsedDoc.run && parsedDoc.scenario && (parsedDoc.metrics || parsedDoc.results))) {
        return { format: "brv02", parsedData: parsedDoc };
    }

    if (parsedDoc.model && (parsedDoc.throughput || parsedDoc.latency || parsedDoc.metrics)) {
        return { format: "inference-perf", parsedData: parsedDoc };
    }
    
    return { format: false, error: "Unrecognized benchmark format" };
}

export function validateHardware(parsedData) {
    let hasHardware = false;
    
    if (parsedData.scenario && parsedData.scenario.stack) {
        hasHardware = parsedData.scenario.stack.some(component => 
            component.config?.accelerator?.model || component.config?.machine?.type
        );
    }
    
    return hasHardware;
}

export function validateStageMetrics({
    stageIndex,
    filename,
    throughput,
    latencyVal,
    ttftVal,
    tpotVal,
    failures,
    totalRequests
}) {
    const errors = [];
    const warnings = [];
    const fieldErrors = {};

    const stageLabel = filename ? `Stage ${stageIndex} (${filename})` : `Stage ${stageIndex}`;

    // 1. Request failures check: 100% failed is an error; >0% and <100% failed is a warning
    const hasFailures = typeof failures === 'number' && failures > 0;
    const isMissingMetrics = throughput === null || throughput === undefined || latencyVal === null || latencyVal === undefined;
    const isAllFailed = hasFailures && (
        (typeof totalRequests === 'number' && totalRequests > 0)
            ? failures >= totalRequests
            : isMissingMetrics
    );
    if (hasFailures) {
        const failRatio = (typeof totalRequests === 'number' && totalRequests > 0)
            ? `(${failures}/${totalRequests} failed)`
            : `(${failures} failed)`;
        if (isAllFailed) {
            const msg = `${stageLabel} recorded ${failures} request failure${failures === 1 ? '' : 's'} ${failRatio}. Stages with 100% failed requests cannot be submitted.`;
            errors.push(msg);
            fieldErrors[`entries.${stageIndex}.failures`] = { message: msg, severity: 'error' };
        } else {
            const msg = `${stageLabel} recorded ${failures} request failure${failures === 1 ? '' : 's'} ${failRatio}. Partial request failures may skew latency and throughput metrics.`;
            warnings.push(msg);
            fieldErrors[`entries.${stageIndex}.failures`] = { message: msg, severity: 'warning' };
        }
    }

    // 2. Missing required throughput or latency metrics (only when not already flagged for 100% request failures)
    if (!isAllFailed && isMissingMetrics) {
        const msg = `${stageLabel} is missing required throughput or latency metrics.`;
        errors.push(msg);
        fieldErrors[`entries.${stageIndex}.metrics`] = { message: msg, severity: 'error' };
    }

    // 3. Negative metrics check
    const isNegativeMetrics = (typeof throughput === 'number' && throughput < 0) || (typeof latencyVal === 'number' && latencyVal < 0);
    if (isNegativeMetrics) {
        const msg = `${stageLabel} has negative metrics.`;
        errors.push(msg);
        fieldErrors[`entries.${stageIndex}.metrics`] = { message: msg, severity: 'error' };
    }

    // 4. Unusually high latency warnings (e.g. emitted in ms or ns without declaring units)
    const e2eSec = typeof latencyVal === 'number' && latencyVal !== null ? latencyVal / 1000 : 0;
    if (e2eSec > 3600) {
        const msg = `${stageLabel}: E2E latency is unusually high (${e2eSec.toFixed(1)}s > 1 hour). Verify that latency units were not emitted in milliseconds or nanoseconds without declaring units.`;
        warnings.push(msg);
        fieldErrors[`entries.${stageIndex}.latency`] = { message: msg, severity: 'warning' };
    }

    const ttftSec = typeof ttftVal === 'number' && ttftVal !== null ? ttftVal / 1000 : 0;
    if (ttftSec > 600) {
        const msg = `${stageLabel}: TTFT is unusually high (${ttftSec.toFixed(1)}s > 10 minutes). Verify that latency units were not emitted in milliseconds or nanoseconds without declaring units.`;
        warnings.push(msg);
        fieldErrors[`entries.${stageIndex}.ttft`] = { message: msg, severity: 'warning' };
    }

    const tpotSec = typeof tpotVal === 'number' && tpotVal !== null ? tpotVal / 1000 : 0;
    if (tpotSec > 60) {
        const msg = `${stageLabel}: TPOT is unusually high (${tpotSec.toFixed(1)}s > 60 seconds per token). Verify that latency units were not emitted in milliseconds or nanoseconds without declaring units.`;
        warnings.push(msg);
        fieldErrors[`entries.${stageIndex}.tpot`] = { message: msg, severity: 'warning' };
    }

    return { errors, warnings, fieldErrors };
}

export function validateBenchmark(fileContent, filename) {
    const result = {
        format: false,
        hasHardware: false,
        errors: [],
        warnings: [],
        entries: []
    };

    const formatCheck = validateFormat(fileContent, filename);
    
    if (!formatCheck.format) {
        result.errors.push(formatCheck.error || "File does not match supported formats.");
        return result;
    }
    
    result.format = formatCheck.format;
    const parsedData = formatCheck.parsedData;
    result.parsedData = parsedData;
    
    if (result.format === "brv02") {
        try {
            const stage = parseReportV02(fileContent, filename);
            if (stage) {
                if (Array.isArray(stage.warnings) && stage.warnings.length > 0) {
                    result.warnings.push(...stage.warnings);
                }
                const entries = [];
                
                const entry = stageToEntry(stage);
                const latencyVal = entry.latency && typeof entry.latency === 'object' ? entry.latency.mean : entry.latency;
                const ttftVal = entry.ttft && typeof entry.ttft === 'object' ? entry.ttft.mean : entry.ttft;
                const tpotVal = entry.tpot ?? null;

                const stageMetricsCheck = validateStageMetrics({
                    stageIndex: stage.stageIndex ?? 0,
                    filename: null,
                    throughput: entry.throughput,
                    latencyVal,
                    ttftVal,
                    tpotVal,
                    failures: stage.performance?.failures ?? null,
                    totalRequests: stage.performance?.totalRequests ?? null
                });
                result.errors.push(...stageMetricsCheck.errors);
                result.warnings.push(...stageMetricsCheck.warnings);

                entries.push({
                    model_name: entry.model_name,
                    stage: stage.stageIndex
                });
                
                result.entries = entries;
                
                result.hasHardware = validateHardware(parsedData);
                if (!result.hasHardware) {
                    result.warnings.push("Hardware metadata is missing or incomplete.");
                }
            } else {
                result.errors.push("No valid stages parsed from BRV02 file.");
            }
        } catch (e) {
            result.errors.push(`Error parsing BRV02: ${e.message}`);
        }
    } else if (result.format === "inference-perf") {
        try {
            const parsed = parsedData;
            const modelName = parsed.model || "";
            const throughput = parsed.throughput ?? parsed.metrics?.throughput ?? null;
            
            let latencyVal = null;
            if (typeof parsed.latency === 'number') {
                latencyVal = parsed.latency;
            } else if (parsed.latency && typeof parsed.latency === 'object') {
                latencyVal = parsed.latency.mean ?? parsed.latency.request_latency?.mean ?? null;
            } else if (parsed.metrics?.latency !== undefined && parsed.metrics?.latency !== null) {
                latencyVal = typeof parsed.metrics.latency === 'number' ? parsed.metrics.latency : (parsed.metrics.latency?.mean ?? null);
            }

            const failuresVal = parsed.failures ?? parsed.metrics?.failures ?? parsed.requests?.failures ?? null;
            const totalReqsVal = parsed.total_requests ?? parsed.metrics?.total_requests ?? parsed.requests?.total ?? null;

            const stageMatch = filename.match(/stage_?(\d+)/i);
            const stageIndex = stageMatch ? parseInt(stageMatch[1], 10) : 0;

            const stageMetricsCheck = validateStageMetrics({
                stageIndex,
                filename,
                throughput,
                latencyVal,
                ttftVal: null,
                tpotVal: null,
                failures: failuresVal,
                totalRequests: totalReqsVal
            });
            result.errors.push(...stageMetricsCheck.errors);
            result.warnings.push(...stageMetricsCheck.warnings);

            result.entries = [{
                model_name: modelName,
                stage: stageIndex
            }];
            result.hasHardware = !!(parsed.hardware || parsed.accelerator || (parsed.scenario?.stack && parsed.scenario.stack.some(c => c.config?.accelerator?.model)));
            
            const dirParts = filename.split('/');
            if (dirParts.length > 1) dirParts.pop();
            const runId = dirParts.join('/');

            result.prism_cloud = {
                run_id: runId || 'inference-perf-run',
                original_uid: filename,
                filepath: filename,
                label: filename.split('/').pop() || 'stage'
            };
        } catch (e) {
            result.errors.push(`Error parsing inference-perf: ${e.message}`);
        }
    }

    return result;
}

/**
 * Formats a Zod issue path array into a readable object path string.
 * Examples:
 * - ['entries', 0, 'run_id'] -> 'entries[0].run_id'
 * - ['hardware', 'hardware_name'] -> 'hardware.hardware_name'
 * - ['manifests', 'deployment.yaml'] -> 'manifests["deployment.yaml"]'
 *
 * @param {Array<string|number>} path
 * @returns {string}
 */
export function formatZodIssuePath(path) {
    if (!path || !Array.isArray(path) || path.length === 0) {
        return '';
    }
    return path.reduce((acc, seg) => {
        if (typeof seg === 'number' || /^\d+$/.test(String(seg))) {
            return `${acc}[${seg}]`;
        }
        const segStr = String(seg);
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segStr)) {
            return acc ? `${acc}.${segStr}` : segStr;
        }
        return acc ? `${acc}["${segStr}"]` : `["${segStr}"]`;
    }, '');
}

/**
 * Validate the complete Prism Run Upload Structure.
 * Rejects runs if any of its stages contain mismatching info (model, hardware).
 * Isomorphic/shared function called by both frontend and backend.
 */
export function validatePrismUploadStructure(uploadData, options = {}) {
    const { isUpload = false } = options;
    const errors = [];
    const warnings = [];
    const fieldErrors = {};

    if (!uploadData) {
        return { isValid: false, errors: ["Missing upload data"], warnings, fieldErrors };
    }

    const { model_name, hardware, entries, format } = uploadData;

    // Run Zod schema validation for format === 'brv02'
    if (format === 'brv02') {
        const parsedResult = PrismResultPayloadSchema.safeParse(uploadData);
        if (!parsedResult.success) {
            for (const issue of parsedResult.error.issues) {
                const dotPath = issue.path.join('.');
                const formattedPath = formatZodIssuePath(issue.path);
                const prefix = formattedPath ? `${formattedPath}: ` : '';
                const detailedMessage = (formattedPath && !issue.message.startsWith(prefix) && !issue.message.startsWith(`${formattedPath} `))
                    ? `${formattedPath}: ${issue.message}`
                    : issue.message;

                errors.push(detailedMessage);

                const errorEntry = { message: detailedMessage, severity: 'error' };
                if (dotPath) {
                    fieldErrors[dotPath] = errorEntry;
                }
                if (formattedPath && formattedPath !== dotPath) {
                    fieldErrors[formattedPath] = errorEntry;
                }
            }
        }
    } else {
        // Manual validation for format !== 'brv02' (inference-perf)
        if (!format || format !== 'inference-perf') {
            errors.push(`Format must be 'brv02' or 'inference-perf', found '${format || 'unknown'}'`);
        }
        if (!uploadData.runLabel || !uploadData.runLabel.trim()) {
            const msg = "Missing benchmark run name.";
            errors.push(msg);
            fieldErrors['runLabel'] = { message: msg, severity: 'error' };
        }
        if (!model_name || !model_name.trim()) {
            const msg = "Missing model name.";
            errors.push(msg);
            fieldErrors['model_name'] = { message: msg, severity: 'error' };
        }
        if (!hardware || !hardware.hardware_name || !hardware.hardware_name.trim() || hardware.hardware_name === 'Unknown' || hardware.hardware_name === 'Unknown Hardware') {
            const msg = "Missing hardware specification.";
            errors.push(msg);
            fieldErrors['hardware.hardware_name'] = { message: msg, severity: 'error' };
        }
        if (!hardware || hardware.accelerator_count === null || hardware.accelerator_count === undefined || hardware.accelerator_count <= 0) {
            const msg = "Missing accelerator chip count.";
            errors.push(msg);
            fieldErrors['hardware.accelerator_count'] = { message: msg, severity: 'error' };
        }
    }

    // Check optional manifests and evidence for warnings
    const hasManifests = (uploadData.manifests && Object.keys(uploadData.manifests).length > 0) || (options.attachedManifests && options.attachedManifests.length > 0);
    if (!hasManifests) {
        const msg = "Missing attached manifests & configs specification.";
        warnings.push(msg);
        fieldErrors['manifests'] = { message: msg, severity: 'warning' };
    }

    const hasEvidence = (uploadData.evidence && Object.keys(uploadData.evidence).length > 0) || (options.attachedEvidence && options.attachedEvidence.length > 0);
    if (!hasEvidence) {
        const msg = "Missing evidence logs & verifications specification.";
        warnings.push(msg);
        fieldErrors['evidence'] = { message: msg, severity: 'warning' };
    }

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
        errors.push("Missing or empty entries array in upload structure");
        return { isValid: false, errors, warnings, fieldErrors };
    }

    // Check each entry (stage)
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const stageContent = entry.raw_report || entry.content;
        if (!stageContent) {
            errors.push(`Entry for file ${entry.filename || 'unknown'} is missing raw_report or content`);
            continue;
        }

        try {
            let parsedStage;
            let normalizedEntry;
            let stageIndex = 0;

            if (format === 'inference-perf') {
                try {
                    const parsed = entry.filename?.endsWith('.json') ? JSON.parse(stageContent) : yaml.load(stageContent);
                    parsedStage = parsed;
                    
                    const throughput = parsed.throughput ?? parsed.metrics?.throughput ?? null;
                    let latencyVal = null;
                    if (typeof parsed.latency === 'number') {
                        latencyVal = parsed.latency;
                    } else if (parsed.latency && typeof parsed.latency === 'object') {
                        latencyVal = parsed.latency.mean ?? parsed.latency.request_latency?.mean ?? null;
                    } else if (parsed.metrics?.latency !== undefined && parsed.metrics?.latency !== null) {
                        latencyVal = typeof parsed.metrics.latency === 'number' ? parsed.metrics.latency : (parsed.metrics.latency?.mean ?? null);
                    }

                    const failuresVal = parsed.failures ?? parsed.metrics?.failures ?? parsed.requests?.failures ?? null;
                    const totalReqsVal = parsed.total_requests ?? parsed.metrics?.total_requests ?? parsed.requests?.total ?? null;

                    const stageMatch = entry.filename?.match(/stage_?(\d+)/i);
                    stageIndex = entry.prism_stage_index ?? (stageMatch ? parseInt(stageMatch[1], 10) : (entry.stage ?? i));

                    normalizedEntry = {
                        model_name: parsed.model || "",
                        hardware: parsed.hardware || parsed.accelerator || "",
                        inference_tool: (parsed.inference_tool && parsed.inference_tool !== 'unknown') ? parsed.inference_tool : "",
                        benchmark_harness: (parsed.benchmark_harness && parsed.benchmark_harness !== 'unknown') ? parsed.benchmark_harness : "",
                        throughput,
                        latency: latencyVal,
                        failures: failuresVal,
                        total_requests: totalReqsVal
                    };
                } catch (e) {
                    errors.push(`File ${entry.filename || 'unknown'} could not be parsed as valid inference-perf JSON/YAML: ${e.message}`);
                    continue;
                }
            } else {
                parsedStage = parseReportV02(stageContent, entry.filename);
                if (!parsedStage) {
                    errors.push(`File ${entry.filename || 'unknown'} could not be parsed as a valid BRV02 stage`);
                    continue;
                }
                parsedStage.model_name = uploadData.model_name || null;
                parsedStage.hardware = uploadData.hardware || null;
                parsedStage.config = uploadData.config || null;
                normalizedEntry = stageToEntry(parsedStage);
                stageIndex = entry.prism_stage_index ?? parsedStage.stageIndex ?? entry.stage ?? i;

                const rawReport = entry.raw_report || entry.rawReport || parsedStage.rawReport;
                const missingUnitWarnings = detectMissingUnitWarnings(rawReport, entry.filename);
                for (const w of missingUnitWarnings) {
                    warnings.push(w);
                    fieldErrors[`entries.${stageIndex}.missing_units`] = { message: w, severity: 'warning' };
                }
            }

            // 1. Verify model name matches root $.model_name
            if (normalizeModelName(normalizedEntry.model_name) !== normalizeModelName(model_name)) {
                const msg = `Stage ${stageIndex} (${entry.filename}) has mismatching model name: expected '${model_name}', but found '${normalizedEntry.model_name}'`;
                errors.push(msg);
                fieldErrors['model_name'] = { message: msg, severity: 'error' };
            }

            // 2. Verify hardware matches root $.hardware.hardware_name
            const rootHw = hardware ? hardware.hardware_name : '';
            if (normalizeHardware(normalizedEntry.hardware) !== normalizeHardware(rootHw) && normalizedEntry.hardware !== '' && normalizedEntry.hardware !== 'Unknown') {
                const msg = `Stage ${stageIndex} (${entry.filename}) has mismatching hardware: expected '${rootHw}', but found '${normalizedEntry.hardware}'`;
                if (isUpload) {
                    errors.push(msg);
                    fieldErrors['hardware.hardware_name'] = { message: msg, severity: 'error' };
                } else {
                    warnings.push(msg);
                    fieldErrors['hardware.hardware_name'] = { message: msg, severity: 'warning' };
                }
            }

            // 2b. Verify serving stack tool matches root $.inference_tool
            const rootTool = uploadData.inference_tool || '';
            const stageTool = normalizedEntry.inference_tool || parsedStage?.scenario?.inferenceTool || '';
            if (rootTool && stageTool && rootTool.toLowerCase() !== stageTool.toLowerCase()) {
                const msg = `Stage ${stageIndex} (${entry.filename}) has mismatching serving stack: expected '${rootTool}', but found '${stageTool}'`;
                if (isUpload) {
                    errors.push(msg);
                    fieldErrors['inference_tool'] = { message: msg, severity: 'error' };
                } else {
                    warnings.push(msg);
                    fieldErrors['inference_tool'] = { message: msg, severity: 'warning' };
                }
            }

            // 2c. Verify benchmark harness tool matches root $.benchmark_harness
            const rootHarness = uploadData.benchmark_harness || '';
            const stageHarness = normalizedEntry.benchmark_harness || parsedStage?.scenario?.harness || '';
            if (rootHarness && stageHarness && rootHarness.toLowerCase() !== stageHarness.toLowerCase()) {
                const msg = `Stage ${stageIndex} (${entry.filename}) has mismatching benchmark harness: expected '${rootHarness}', but found '${stageHarness}'`;
                if (isUpload) {
                    errors.push(msg);
                    fieldErrors['benchmark_harness'] = { message: msg, severity: 'error' };
                } else {
                    warnings.push(msg);
                    fieldErrors['benchmark_harness'] = { message: msg, severity: 'warning' };
                }
            }

            // 3. Verify entry run_id is present (must be generated by Prism)
            if (!entry.run_id) {
                errors.push(`Stage ${stageIndex} (${entry.filename}) is missing a generated run_id`);
            }

            // 3b. Verify entry run_description matches uploadData.runLabel if present
            if (entry.run_description && entry.run_description !== uploadData.runLabel) {
                const msg = `Stage ${stageIndex} (${entry.filename}) has mismatching run description: expected '${uploadData.runLabel}', but found '${entry.run_description}'`;
                if (isUpload) {
                    errors.push(msg);
                } else {
                    warnings.push(msg);
                }
            }

            // 4. Validate stage metrics (request failures, missing/negative metrics, high latency warnings)
            const latencyVal = normalizedEntry.latency && typeof normalizedEntry.latency === 'object' ? normalizedEntry.latency.mean : normalizedEntry.latency;
            const ttftVal = normalizedEntry.ttft && typeof normalizedEntry.ttft === 'object' ? normalizedEntry.ttft.mean : normalizedEntry.ttft;
            const tpotVal = normalizedEntry.tpot ?? null;
            const stageMetricsCheck = validateStageMetrics({
                stageIndex,
                filename: entry.filename || 'unknown',
                throughput: normalizedEntry.throughput,
                latencyVal,
                ttftVal,
                tpotVal,
                failures: normalizedEntry.failures ?? parsedStage?.performance?.failures ?? null,
                totalRequests: normalizedEntry.total_requests ?? parsedStage?.performance?.totalRequests ?? null
            });
            errors.push(...stageMetricsCheck.errors);
            warnings.push(...stageMetricsCheck.warnings);
            Object.assign(fieldErrors, stageMetricsCheck.fieldErrors);

        } catch (e) {
            errors.push(`Error validating stage file ${entry.filename || 'unknown'}: ${e.message}`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        fieldErrors
    };
}

/**
 * Parses a single validation error or warning string to identify if it belongs
 * to a repeatable per-stage or per-file error category.
 *
 * @param {string} rawMessage
 * @param {object} [options]
 * @param {Array<object>} [options.entries]
 * @returns {{ groupKey: string, summary: string, item: string, raw: string, meta?: object }}
 */
function parseRepeatableValidationMessage(rawMessage, options = {}) {
    const msg = String(rawMessage || '').trim();

    // 1. Request failures: "Stage X (filename) recorded Y request failure(s) (Y/Z failed). Benchmarks must have 0 failed requests."
    const failureMatch = msg.match(
        /^(Stage\s+\d+(?:\s+\(.+\))?)\s+recorded\s+(\d+\s+request\s+failures?(?:\s+\(([^)]+)\))?)\.\s*(.+)$/i
    );
    if (failureMatch) {
        const stageLabel = failureMatch[1];
        const failDetail = failureMatch[3] || failureMatch[2];
        const summary = failureMatch[4];
        return {
            groupKey: `stage_failures:${summary}`,
            summary,
            item: `${stageLabel} — ${failDetail}`,
            raw: msg
        };
    }

    // 2. Stage mismatch: "Stage X (filename) has mismatching <field>: expected 'A', but found 'B'"
    const mismatchMatch = msg.match(
        /^(Stage\s+\d+(?:\s+\(.+\))?)\s+has\s+mismatching\s+([^:]+):\s*expected\s+('[^']*'),\s*but\s+found\s+('[^']*')$/i
    );
    if (mismatchMatch) {
        const stageLabel = mismatchMatch[1];
        const fieldLabel = mismatchMatch[2].trim();
        const expectedVal = mismatchMatch[3];
        const actualVal = mismatchMatch[4];
        return {
            groupKey: `stage_mismatch:${fieldLabel.toLowerCase()}:${expectedVal}`,
            summary: `Stage has mismatching ${fieldLabel}: expected ${expectedVal}, but found ${actualVal}`,
            item: stageLabel,
            raw: msg,
            meta: { type: 'mismatch', stageLabel, fieldLabel, expectedVal, actualVal }
        };
    }

    // 3. General stage error/warning: "Stage X (filename) is/has ..." or "Stage X (filename): ..."
    const stageGeneralMatch = msg.match(
        /^(Stage\s+\d+(?:\s+\(.+\))?)(?::\s+|\s+(?=(?:is|has)\s+))(.+)$/i
    );
    if (stageGeneralMatch) {
        const stageLabel = stageGeneralMatch[1];
        const rest = stageGeneralMatch[2].trim();
        const summary = /^(?:is|has)\s+/i.test(rest) ? `Stage ${rest}` : rest;
        return {
            groupKey: `stage_general:${summary}`,
            summary,
            item: stageLabel,
            raw: msg
        };
    }

    // 4. Bracketed file prefix: "[filename] <message>"
    const bracketFileMatch = msg.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (bracketFileMatch) {
        const filename = bracketFileMatch[1].trim();
        const summary = bracketFileMatch[2].trim();
        return {
            groupKey: `file_bracket:${summary}`,
            summary,
            item: filename,
            raw: msg
        };
    }

    // 5. File-level stage parse/validation errors
    const entryMissingMatch = msg.match(/^Entry for file (\S+)\s+(is missing .+)$/i);
    if (entryMissingMatch) {
        const filename = entryMissingMatch[1];
        const summary = `Entry ${entryMissingMatch[2]}`;
        return {
            groupKey: `file_entry:${summary}`,
            summary,
            item: filename,
            raw: msg
        };
    }

    const fileParseMatch = msg.match(/^File (\S+)\s+(could not be parsed as .+)$/i);
    if (fileParseMatch) {
        const filename = fileParseMatch[1];
        const summary = `File ${fileParseMatch[2]}`;
        return {
            groupKey: `file_parse:${summary}`,
            summary,
            item: filename,
            raw: msg
        };
    }

    const fileValidateMatch = msg.match(/^Error validating stage file ([^:]+):\s*(.+)$/i);
    if (fileValidateMatch) {
        const filename = fileValidateMatch[1].trim();
        const summary = `Error validating stage file: ${fileValidateMatch[2].trim()}`;
        return {
            groupKey: `file_validate:${summary}`,
            summary,
            item: filename,
            raw: msg
        };
    }

    // 6. Zod array entry schema errors: "entries[0].field: <message>"
    const zodEntryMatch = msg.match(/^entries\[(\d+)\]([^:]*):\s*(.+)$/);
    if (zodEntryMatch) {
        const entryIdx = parseInt(zodEntryMatch[1], 10);
        const subPath = zodEntryMatch[2] || '';
        const zodMsg = zodEntryMatch[3].trim();
        const summary = `entries[*]${subPath}: ${zodMsg}`;
        const entryObj = Array.isArray(options.entries) ? options.entries[entryIdx] : null;
        const stageIdx = entryObj?.prism_stage_index ?? entryIdx;
        const item = entryObj?.filename
            ? `Stage ${stageIdx} (${entryObj.filename})`
            : `Stage ${stageIdx} (entries[${entryIdx}]${subPath})`;
        return {
            groupKey: `zod_entries:${subPath}:${zodMsg}`,
            summary,
            item,
            raw: msg
        };
    }

    // Fallback: unique message
    return {
        groupKey: `single:${msg}`,
        summary: msg,
        item: msg,
        raw: msg
    };
}

/**
 * Coalesces repetitive validation errors or warnings into grouped items when
 * multiple stages/files fail with the same error category.
 *
 * Single occurrences remain `{ type: 'single', key, message }`.
 * Multiple occurrences (count > 1) become `{ type: 'group', key, count, summary, items, rawMessages }`.
 *
 * @param {Array<string>} messages
 * @param {object} [options]
 * @param {Array<object>} [options.entries]
 * @returns {Array<{ type: 'single', key: string, message: string } | { type: 'group', key: string, count: number, summary: string, items: Array<string>, rawMessages: Array<string> }>}
 */
export function coalesceValidationMessages(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return [];
    }

    const uniqueMessages = [...new Set(messages.filter(Boolean))];
    const groupsMap = new Map();

    for (const rawMsg of uniqueMessages) {
        const parsed = parseRepeatableValidationMessage(rawMsg, options);
        if (!groupsMap.has(parsed.groupKey)) {
            groupsMap.set(parsed.groupKey, []);
        }
        groupsMap.get(parsed.groupKey).push(parsed);
    }

    const result = [];
    for (const [groupKey, groupItems] of groupsMap.entries()) {
        if (groupItems.length === 1) {
            result.push({
                type: 'single',
                key: groupKey,
                message: groupItems[0].raw
            });
            continue;
        }

        let summary = groupItems[0].summary;
        let items = groupItems.map(it => it.item);

        // Special handling if mismatching stages found different values across stages
        if (groupItems[0].meta?.type === 'mismatch') {
            const uniqueActuals = new Set(groupItems.map(it => it.meta.actualVal));
            const { fieldLabel, expectedVal } = groupItems[0].meta;
            if (uniqueActuals.size > 1) {
                summary = `Stage has mismatching ${fieldLabel} (expected ${expectedVal}).`;
                items = groupItems.map(it => `${it.meta.stageLabel} — found ${it.meta.actualVal}`);
            }
        }

        result.push({
            type: 'group',
            key: groupKey,
            count: groupItems.length,
            summary,
            items,
            rawMessages: groupItems.map(it => it.raw)
        });
    }

    return result;
}

