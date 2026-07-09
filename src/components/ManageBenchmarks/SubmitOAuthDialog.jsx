// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed5 to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, { useState, useMemo } from 'react';
import { X, Github, CheckCircle, AlertCircle, Loader, LogOut, ArrowRight, Shield, ChevronDown, ChevronRight, Check, ArrowLeft, Scale } from 'lucide-react';
import { useGitHubAuth } from '../../hooks/useGitHubAuth.js';
import { validatePrismUploadStructure } from '../../utils/benchmarkValidator';
import { stageToEntry } from '../../utils/benchmarkReportV02Parser.js';

export function SubmitOAuthDialog({ isOpen, onClose, selectedBenchmarks, modelStats, brv02Runs, removeBrv02Run, promoteStagedRunId, loadAllData, addToast }) {
    const { isAuthenticated, isConfigured, user, login, logout, accessToken, isLoading: authLoading } = useGitHubAuth();
    const [step, setStep] = useState(1); // 1 = Review & Validation, 2 = DCO Agreement
    const [agreedToDCO, setAgreedToDCO] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitErrors, setSubmitErrors] = useState([]);
    const [expandedRunId, setExpandedRunId] = useState(null);

    // Find all selected runs that are locally staged (start with brv02:)
    const selectedStagedRuns = useMemo(() => {
        if (!selectedBenchmarks || selectedBenchmarks.size === 0) return [];
        
        const staged = [];
        selectedBenchmarks.forEach(key => {
            const stat = modelStats.find(s => s.benchmarkKey === key);
            if (stat) {
                const benchmarkData = stat.data || [];
                const sourceStr = benchmarkData[0]?.source || '';
                if (sourceStr.startsWith('brv02:')) {
                    const runId = sourceStr.replace('brv02:', '');
                    const runObj = brv02Runs.find(r => r.runId === runId);
                    if (runObj) {
                        staged.push(runObj);
                    }
                }
            }
        });
        return staged;
    }, [selectedBenchmarks, modelStats, brv02Runs]);

    // Build the PrismResultPayload for a run to submit
    const buildPayloadFromRun = (run) => {
        let inferenceTool = "";
        let inferenceToolVersion = "";
        const otherTools = {};
        
        const firstStage = run.stages?.[0];
        if (firstStage) {
            const rawReport = firstStage.rawReport || {};
            const stack = rawReport?.scenario?.stack || [];
            const inferenceEngine = stack.find(c => 
                c.standardized?.kind === 'inference_engine' || 
                c.standardized?.role === 'decode' || 
                c.standardized?.role === 'prefill' ||
                c.standardized?.role === 'aggregate'
            ) || stack.find(c => 
                ['vllm', 'tgi', 'tensorrt', 'tensorrt_llm', 'sglang', 'ollama'].includes(String(c.standardized?.tool || '').toLowerCase())
            );
            if (inferenceEngine) {
                inferenceTool = inferenceEngine.standardized?.tool || "";
                inferenceToolVersion = inferenceEngine.standardized?.tool_version || "";
            } else if (rawReport?.scenario?.load?.standardized?.tool) {
                inferenceTool = rawReport.scenario.load.standardized.tool || "";
                inferenceToolVersion = rawReport.scenario.load.standardized.tool_version || "";
            }

            const loadTool = rawReport?.scenario?.load?.standardized?.tool;
            const loadVer = rawReport?.scenario?.load?.standardized?.tool_version || "unknown";
            if (loadTool && loadTool !== 'unknown' && loadTool.toLowerCase() !== inferenceTool.toLowerCase()) {
                otherTools[loadTool] = loadVer;
            }

            stack.forEach(c => {
                if (c === inferenceEngine) return;
                const tool = c.standardized?.tool;
                const version = c.standardized?.tool_version || "unknown";
                if (tool && tool !== 'unknown' && tool !== 'service' && tool.toLowerCase() !== inferenceTool.toLowerCase()) {
                    otherTools[tool] = version;
                }
            });
        }

        const firstParsedStage = firstStage;
        let resolvedModel = 'Unknown';
        let resolvedHw = 'Unknown';
        if (firstParsedStage) {
            const normalized = stageToEntry(firstParsedStage);
            resolvedModel = normalized.model_name;
            resolvedHw = normalized.hardware;
        }

        const payloadEntries = run.stages.map(stage => ({
            run_id: stage.runUid || crypto.randomUUID(),
            run_description: run.runLabel,
            filename: stage.filename,
            raw_report: stage.rawReport
        }));

        return {
            runId: run.runId,
            runLabel: run.runLabel,
            model_name: resolvedModel,
            hardware: {
                hardware_name: resolvedHw
            },
            attribution: run.attribution || null,
            manifests: run.manifests || {},
            evidence: run.evidence || {},
            format: "brv02",
            run_metadata: run.run_metadata || {},
            entries: payloadEntries,
            well_lit_path: run.wellLitPath || null,
            metadata: run.metadata || {},
            inference_tool: inferenceTool,
            inference_tool_version: inferenceToolVersion,
            other_tools: otherTools
        };
    };

    // Calculate validations and warnings for each staged run
    const runValidations = useMemo(() => {
        return selectedStagedRuns.map(run => {
            const payload = buildPayloadFromRun(run);
            const validation = validatePrismUploadStructure(payload, { isUpload: true });
            
            const warnings = [...validation.warnings];
            
            // Check other optional criteria for warnings (removed missing attribution field check)
            if (!payload.well_lit_path) {
                warnings.push("Well-lit path category is not set.");
            }
            if (!payload.evidence || Object.keys(payload.evidence).length === 0) {
                warnings.push("No evidence files (reproducibility logs) are linked.");
            }
            if (!payload.manifests || Object.keys(payload.manifests).length === 0) {
                warnings.push("No deployment manifests (Kubernetes configs) are linked.");
            }

            return {
                runId: run.runId,
                runLabel: run.runLabel,
                payload,
                isValid: validation.isValid,
                errors: validation.errors,
                warnings,
                stagesCount: run.stages.length
            };
        });
    }, [selectedStagedRuns]);

    const hasValidationErrors = useMemo(() => {
        return runValidations.some(v => !v.isValid);
    }, [runValidations]);

    const handleSubmission = async () => {
        if (runValidations.length === 0 || hasValidationErrors || !agreedToDCO) return;
        setIsSubmitting(true);
        setSubmitErrors([]);

        const errors = [];
        let successCount = 0;

        for (const validationInfo of runValidations) {
            try {
                const res = await fetch('/api/results', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Prism-Github-Token': accessToken
                    },
                    body: JSON.stringify(validationInfo.payload)
                });

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Server responded with ${res.status}`);
                }

                const responseData = await res.json();
                successCount++;
                
                // Promote staged run ID to the server-assigned UUID in local storage mappings
                if (promoteStagedRunId && responseData.runId) {
                    promoteStagedRunId(validationInfo.runId, responseData.runId);
                } else if (removeBrv02Run) {
                    removeBrv02Run(validationInfo.runId);
                }
            } catch (err) {
                errors.push(`Run "${validationInfo.runLabel}": ${err.message}`);
            }
        }

        setIsSubmitting(false);

        if (successCount > 0) {
            addToast(`Successfully submitted ${successCount} run${successCount === 1 ? '' : 's'} to Prism.`, 'success');
            if (loadAllData) {
                loadAllData(null, true);
            }
        }

        if (errors.length > 0) {
            setSubmitErrors(errors);
            addToast(`Failed to submit ${errors.length} runs.`, 'error');
            // Jump back to step 1 so they can see submission errors
            setStep(1);
        } else {
            handleClose();
        }
    };

    const toggleExpandRun = (runId) => {
        setExpandedRunId(prev => prev === runId ? null : runId);
    };

    const handleClose = () => {
        setStep(1);
        setAgreedToDCO(false);
        onClose();
    };

    if (!isOpen) return null;

    const hasUnauthorizedRole = user && user.permission !== 'user' && user.permission !== 'admin';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col border border-slate-800 overflow-hidden text-slate-100">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Github size={20} className="text-white" /> Submit to Prism
                        <span className="text-xs font-normal text-slate-400">
                            (Step {step} of 2)
                        </span>
                    </h3>
                    <button onClick={handleClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 flex-1 overflow-y-auto space-y-5 flex flex-col min-h-0">
                    {authLoading ? (
                        <div className="py-12 flex-1 flex flex-col items-center justify-center gap-3">
                            <Loader size={28} className="animate-spin text-cyan-500" />
                            <span className="text-sm text-slate-400">Verifying session...</span>
                        </div>
                    ) : !isConfigured ? (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-3 text-sm text-red-200">
                            <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
                            <div>
                                <h4 className="font-semibold text-white">OAuth Not Configured</h4>
                                <p className="mt-1 text-xs opacity-90">GitHub Single Sign-On is not configured on this Prism server. Please check environment variables GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.</p>
                            </div>
                        </div>
                    ) : !isAuthenticated ? (
                        <div className="flex-1 flex flex-col items-center justify-center space-y-4 max-w-sm mx-auto text-center">
                            <Github size={48} className="text-slate-500 mb-2 opacity-50" />
                            <h4 className="text-lg font-bold text-white">Authentication Required</h4>
                            <p className="text-sm text-slate-400">
                                Prism requires GitHub authentication to submit benchmark runs for public review.
                            </p>
                            <button
                                onClick={login}
                                className="w-full py-2.5 px-4 bg-white text-slate-950 font-semibold rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 text-sm shadow-md"
                            >
                                <Github size={18} /> Sign in with GitHub
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* User Profile Bar */}
                            <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-lg flex items-center justify-between gap-3 text-sm shrink-0">
                                <div className="flex items-center gap-3 min-w-0">
                                    {user.avatarUrl ? (
                                        <img 
                                            src={user.avatarUrl} 
                                            alt={user.username} 
                                            className="w-10 h-10 rounded-full shrink-0 border border-slate-700 object-cover"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-white shrink-0 border border-slate-700">
                                            {user.username ? user.username.substring(0, 2).toUpperCase() : 'GH'}
                                        </div>
                                    )}
                                    <div className="truncate">
                                        <h4 className="font-semibold text-white truncate">{user.username}</h4>
                                        <span className="text-xs text-slate-400 flex items-center gap-1">
                                            <Shield size={12} className="text-cyan-400" /> Role: {user.permission}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={logout}
                                    title="Sign out"
                                    className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                                >
                                    <LogOut size={16} />
                                </button>
                            </div>

                            {hasUnauthorizedRole ? (
                                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-3 text-sm text-red-200">
                                    <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
                                    <div>
                                        <h4 className="font-semibold text-white">Access Restricted</h4>
                                        <p className="mt-1 text-xs opacity-90">Your GitHub account is not authorized to submit benchmarks. Please contact your Prism administrator to request to be allowlisted.</p>
                                    </div>
                                </div>
                            ) : step === 1 ? (
                                /* STEP 1: REVIEW STAGE */
                                <div className="flex-1 flex flex-col min-h-0 space-y-3">
                                    <div className="flex justify-between items-center shrink-0">
                                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Staged Runs for Submission</h4>
                                        <span className="text-xs font-bold text-slate-500">
                                            {selectedStagedRuns.length} selected
                                        </span>
                                    </div>

                                    {selectedStagedRuns.length === 0 ? (
                                        <div className="flex-1 border border-slate-800 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center text-slate-500">
                                            <AlertCircle size={32} className="opacity-20 mb-3" />
                                            <h5 className="font-semibold text-slate-350">No Staged Runs Selected</h5>
                                            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                                                Please go back, navigate to the "Benchmark Explorer" tab, and select the checkbox of the staged runs you want to submit.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex-1 overflow-y-auto space-y-3 border border-slate-800 p-2 rounded-lg bg-slate-950/20 divide-y divide-slate-800">
                                            {runValidations.map(validationInfo => {
                                                const isExpanded = expandedRunId === validationInfo.runId;
                                                const payload = validationInfo.payload;
                                                
                                                return (
                                                    <div key={validationInfo.runId} className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/50">
                                                        <div 
                                                            className="flex items-center justify-between px-3 py-3 cursor-pointer hover:bg-slate-800/30"
                                                            onClick={() => toggleExpandRun(validationInfo.runId)}
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                {!validationInfo.isValid ? (
                                                                    <AlertCircle size={18} className="text-red-500 shrink-0" />
                                                                ) : validationInfo.warnings.length > 0 ? (
                                                                    <AlertCircle size={18} className="text-amber-500 shrink-0" />
                                                                ) : (
                                                                    <CheckCircle size={18} className="text-emerald-500 shrink-0" />
                                                                )}
                                                                <div className="flex flex-col min-w-0">
                                                                    <span className="text-sm font-bold text-white truncate">{validationInfo.runLabel}</span>
                                                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                                                        {/* Model Name Tag */}
                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
                                                                            Model: {payload.model_name || 'Unknown'}
                                                                        </span>

                                                                        {/* Hardware Check Tag */}
                                                                        {payload.hardware?.hardware_name && payload.hardware.hardware_name !== 'Unknown' && payload.hardware.hardware_name !== 'Unknown Hardware' ? (
                                                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                                                                                Hardware: {payload.hardware.hardware_name}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-500/10 text-red-400 px-2 py-0.5 rounded border border-red-500/20">
                                                                                Hardware: Missing
                                                                            </span>
                                                                        )}

                                                                        {/* Readiness Badge */}
                                                                        {!validationInfo.isValid ? (
                                                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-500/20 text-red-300 px-2 py-0.5 rounded border border-red-500/30">
                                                                                <X size={10} className="shrink-0 text-red-400" /> Invalid (Blocked)
                                                                            </span>
                                                                        ) : validationInfo.warnings.length > 0 ? (
                                                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                                                                                <AlertCircle size={10} className="shrink-0 text-amber-400" /> {validationInfo.warnings.length} Warning{validationInfo.warnings.length === 1 ? '' : 's'}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                                                                                <Check size={10} className="shrink-0 text-emerald-400" /> Ready
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[10px] text-slate-400 shrink-0">({validationInfo.stagesCount} stage{validationInfo.stagesCount === 1 ? '' : 's'})</span>
                                                                {isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                                                            </div>
                                                        </div>

                                                        {isExpanded && (
                                                            <div className="p-4 border-t border-slate-800 bg-slate-950/20 text-xs space-y-3">
                                                                {/* Errors List */}
                                                                {validationInfo.errors.length > 0 && (
                                                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-200 space-y-1">
                                                                        <h5 className="font-bold text-red-300 flex items-center gap-1">
                                                                            <AlertCircle size={14} /> Validation Errors (Must resolve to submit):
                                                                        </h5>
                                                                        <ul className="list-disc pl-5 space-y-0.5">
                                                                            {validationInfo.errors.map((err, idx) => <li key={idx}>{err}</li>)}
                                                                        </ul>
                                                                    </div>
                                                                )}

                                                                {/* Warnings List */}
                                                                {validationInfo.warnings.length > 0 && (
                                                                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-200 space-y-1">
                                                                        <h5 className="font-bold text-amber-300 flex items-center gap-1">
                                                                            <AlertCircle size={14} /> Optimization Warnings:
                                                                        </h5>
                                                                        <ul className="list-disc pl-5 space-y-0.5">
                                                                            {validationInfo.warnings.map((warn, idx) => <li key={idx}>{warn}</li>)}
                                                                        </ul>
                                                                    </div>
                                                                )}

                                                                {/* Run Info Table */}
                                                                <div className="overflow-hidden border border-slate-800 rounded-lg bg-slate-900/50">
                                                                    <table className="w-full text-left text-[11px] border-collapse">
                                                                        <tbody className="divide-y divide-slate-800">
                                                                            <tr className="hover:bg-slate-800/10">
                                                                                <td className="px-3 py-1.5 w-1/4 font-semibold text-slate-400 border-r border-slate-800 bg-slate-900/20">Well-Lit Path</td>
                                                                                <td className="px-3 py-1.5 text-slate-200">{payload.well_lit_path || <span className="text-slate-500 font-medium">None</span>}</td>
                                                                            </tr>
                                                                            <tr className="hover:bg-slate-800/10">
                                                                                <td className="px-3 py-1.5 w-1/4 font-semibold text-slate-400 border-r border-slate-800 bg-slate-900/20">Inference Tool</td>
                                                                                <td className="px-3 py-1.5 text-slate-200">
                                                                                    {payload.inference_tool ? `${payload.inference_tool} (${payload.inference_tool_version || 'unknown'})` : <span className="text-slate-500">unknown</span>}
                                                                                </td>
                                                                            </tr>
                                                                            <tr className="hover:bg-slate-800/10">
                                                                                <td className="px-3 py-1.5 w-1/4 font-semibold text-slate-400 border-r border-slate-800 bg-slate-900/20">Manifests</td>
                                                                                <td className="px-3 py-1.5 text-slate-200 font-mono">
                                                                                    {Object.keys(payload.manifests).length > 0 ? (
                                                                                        Object.entries(payload.manifests).map(([name, url]) => (
                                                                                            <div key={name} className="truncate">{name}: <a href={url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">{url}</a></div>
                                                                                        ))
                                                                                    ) : (
                                                                                        <span className="text-slate-500">None linked</span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                            <tr className="hover:bg-slate-800/10">
                                                                                <td className="px-3 py-1.5 w-1/4 font-semibold text-slate-400 border-r border-slate-800 bg-slate-900/20">Evidence Logs</td>
                                                                                <td className="px-3 py-1.5 text-slate-200 font-mono">
                                                                                    {Object.keys(payload.evidence).length > 0 ? (
                                                                                        Object.entries(payload.evidence).map(([name, url]) => (
                                                                                            <div key={name} className="truncate">{name}: <span className="text-slate-350">{url}</span></div>
                                                                                        ))
                                                                                    ) : (
                                                                                        <span className="text-slate-500">None linked</span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {submitErrors.length > 0 && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs space-y-1 shrink-0">
                                            <h5 className="font-bold text-red-300">Errors during submission:</h5>
                                            <ul className="list-disc pl-4 space-y-0.5 text-red-200 font-mono">
                                                {submitErrors.map((err, idx) => <li key={idx}>{err}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* STEP 2: DCO AGREEMENT STAGE */
                                <div className="flex-1 flex flex-col min-h-0 space-y-4">
                                    <div className="flex-1 flex flex-col min-h-0 space-y-3">
                                        <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm shrink-0">
                                            <Scale size={20} />
                                            <span>Developer Certificate of Origin & Terms of Publication</span>
                                        </div>
                                        
                                        <div className="flex-1 min-h-0 p-5 bg-slate-950/40 border border-slate-800 rounded-lg text-sm space-y-3 text-slate-350 leading-relaxed font-sans overflow-y-auto shadow-inner">
                                            <h5 className="font-bold text-white mb-1">1. Developer Certificate of Origin (DCO)</h5>
                                            <p className="text-slate-400 mb-2">By submitting this benchmark data, I certify that:</p>
                                            <ol className="list-decimal pl-5 space-y-1.5 text-slate-350">
                                                <li>
                                                    The contribution was created in whole or in part by me and I have the right under the repository license to submit it; or
                                                </li>
                                                <li>
                                                    The contribution is based upon previous work that is covered under appropriate open source licenses and I have the right to submit it; or
                                                </li>
                                                <li>
                                                    The contribution was provided directly to me by another person who certified (1) or (2), and I have not modified it.
                                                </li>
                                            </ol>

                                            <h5 className="font-bold text-white mt-4 mb-1">2. llm-d Submission Policy Agreements</h5>
                                            <p className="text-slate-400 mb-2">I understand and agree to the following terms from the results store policy:</p>
                                            <ul className="list-disc pl-5 space-y-2 text-slate-350">
                                                <li>
                                                    <span className="font-semibold text-slate-200">Mandatory Attribution:</span> Submissions cannot be anonymous. This run will be permanently associated with my GitHub identity (<span className="font-mono text-cyan-400">@{user.username}</span>) and my staged organization name.
                                                </li>
                                                <li>
                                                    <span className="font-semibold text-slate-200">Separation of Data and Narrative Claims:</span> The results store strictly records objective numerical data and configs. The review process verifies validity and reproducibility only; it does not endorse narrative marketing claims or comparison conclusions.
                                                </li>
                                                <li>
                                                    <span className="font-semibold text-slate-200">Storage Tiers & Public Access:</span> Benchmark payloads will be uploaded to cloud storage staging buckets (<span className="font-mono text-slate-300">gs://llm-d-benchmarks-staging/</span>) for Tier 1 review, and promoted to the public production storage bucket (<span className="font-mono text-slate-300">gs://llm-d-benchmarks/</span>) upon successful core maintainer validation.
                                                </li>
                                                <li>
                                                    <span className="font-semibold text-slate-200">Verifiability & Logs:</span> Linked artifacts (e.g. inference engine logs, hardware configs, deployment manifests) will be stored and made queryable to allow the community to replicate and audit performance claims.
                                                </li>
                                            </ul>

                                            <div className="pt-3 border-t border-slate-800 text-slate-400">
                                                For the complete policy guidelines, read the official <a href="https://github.com/llm-d/llm-d-benchmark/blob/main/llmdbenchmark/results_store/SUBMISSION_POLICY.md" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">llm-d Results Store Submission Policy</a>.
                                            </div>
                                        </div>
                                    </div>

                                    {/* Agreement Checkbox */}
                                    <label className="flex items-start gap-3 p-4 bg-slate-950/20 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-950/30 transition-colors select-none shrink-0">
                                        <input 
                                            type="checkbox"
                                            checked={agreedToDCO}
                                            onChange={(e) => setAgreedToDCO(e.target.checked)}
                                            className="mt-1 rounded border-slate-700 bg-slate-850 text-cyan-500 focus:ring-cyan-500 h-4.5 w-4.5 shrink-0"
                                        />
                                        <div className="text-xs text-slate-350 leading-relaxed font-medium">
                                            <span className="font-semibold text-white block">I accept the terms & certify the origin of this submission</span>
                                            I agree to permanently publish this data under my GitHub username <span className="font-mono text-cyan-400">@{user.username}</span>.
                                        </div>
                                    </label>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {isAuthenticated && !hasUnauthorizedRole && (
                    <div className="p-4 border-t border-slate-800 bg-slate-900/30 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
                        {step === 1 ? (
                            /* Step 1 Footer */
                            <>
                                {hasValidationErrors ? (
                                    <span className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
                                        <AlertCircle size={16} /> Blocked: Some selected staged runs contain validation errors.
                                    </span>
                                ) : (
                                    <span className="text-xs text-slate-400">
                                        All runs are validated and ready to review agreement.
                                    </span>
                                )}

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={handleClose}
                                        className="px-4 py-2 bg-slate-800 text-slate-200 font-semibold rounded-lg hover:bg-slate-750 transition-colors text-sm border border-slate-700/50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => setStep(2)}
                                        disabled={selectedStagedRuns.length === 0 || hasValidationErrors}
                                        className={`py-2 px-5 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                                            selectedStagedRuns.length === 0 || hasValidationErrors
                                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-transparent'
                                                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                                        }`}
                                    >
                                        Next: Review Agreement <ArrowRight size={16} />
                                    </button>
                                </div>
                            </>
                        ) : (
                            /* Step 2 Footer */
                            <>
                                <span className="text-xs text-slate-400 flex items-center gap-1.5">
                                    <Scale size={16} className="text-cyan-400 shrink-0" /> Checked DCO must be agreed to submit.
                                </span>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => setStep(1)}
                                        disabled={isSubmitting}
                                        className="px-4 py-2 bg-slate-800 text-slate-200 font-semibold rounded-lg hover:bg-slate-750 transition-colors text-sm border border-slate-700/50 flex items-center gap-1.5"
                                    >
                                        <ArrowLeft size={16} /> Back
                                    </button>
                                    <button
                                        onClick={handleSubmission}
                                        disabled={!agreedToDCO || isSubmitting}
                                        className={`py-2 px-5 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                                            !agreedToDCO || isSubmitting
                                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-transparent'
                                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                                        }`}
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader size={16} className="animate-spin" /> Submitting...
                                            </>
                                        ) : (
                                            <>
                                                Agree & Submit <ArrowRight size={16} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
