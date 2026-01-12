'use client';

import React, { useState, useCallback } from 'react';
import {
  Upload,
  FileText,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronRight,
  ChevronDown,
  Eye,
  Send,
  RotateCcw,
  Loader2,
  Lightbulb,
  Square,
  CornerDownRight,
  Building2,
  Zap,
  AlertCircle,
} from 'lucide-react';

type Status = 'pass' | 'warning' | 'fail' | 'pending' | 'skipped';

interface CheckItem {
  id: string;
  label: string;
  status: Status;
  notes: string;
  page?: number;
}

interface AnalysisResults {
  overallStatus: Status;
  summary: string;
  criticalIssues: CheckItem[];
  warnings: CheckItem[];
  passed: CheckItem[];
  manualReview: CheckItem[];
  projectType: {
    isBacklit: boolean;
    hasCutouts: boolean;
    hasCorners: boolean;
    hasLogos: boolean;
  };
  extractedInfo: {
    projectName: string;
    location: string;
    version: string;
    drawnBy: string;
    pageCount: number;
  };
}

interface ProjectAnswers {
  isBacklit: boolean;
  hasCutouts: boolean;
  hasCorners: boolean;
  hasLogos: boolean;
}

const QUESTIONS = [
  { id: 'isBacklit', label: 'Is this a backlit wall?', icon: Lightbulb, desc: 'LEDs behind the panels' },
  { id: 'hasCutouts', label: 'Does it have cutouts?', icon: Square, desc: 'TV openings, pass-throughs' },
  { id: 'hasCorners', label: 'Inside or outside corners?', icon: CornerDownRight, desc: 'Wall wraps around' },
  { id: 'hasLogos', label: 'Logos or inlays?', icon: Building2, desc: 'Custom engravings' },
];

function StatusBadge({ status, critical }: { status: Status; critical?: boolean }) {
  const configs = {
    pass: { icon: CheckCircle, bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Pass' },
    warning: { icon: AlertTriangle, bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Review' },
    fail: { icon: XCircle, bg: critical ? 'bg-red-600/30' : 'bg-red-500/20', text: 'text-red-400', label: critical ? 'FAIL' : 'Fail' },
    pending: { icon: Eye, bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Manual' },
    skipped: { icon: ChevronRight, bg: 'bg-slate-700/50', text: 'text-slate-500', label: 'N/A' },
  };
  const config = configs[status] || configs.pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}

export default function ShopDrawingQC() {
  const [step, setStep] = useState<'upload' | 'questions' | 'analyzing' | 'results'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [projectAnswers, setProjectAnswers] = useState<ProjectAnswers>({
    isBacklit: false,
    hasCutouts: false,
    hasCorners: false,
    hasLogos: false,
  });
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile && uploadedFile.type === 'application/pdf') {
      setFile(uploadedFile);
      setError(null);
    } else {
      setError('Please upload a PDF file');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      setError(null);
    } else {
      setError('Please upload a PDF file');
    }
  }, []);

  const toggleAnswer = (questionId: keyof ProjectAnswers) => {
    setProjectAnswers((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const runAnalysis = async () => {
    if (!file) return;
    setStep('analyzing');
    setProgress(0);
    setError(null);

    const progressSteps = [
      { p: 10, s: 'Uploading PDF...' },
      { p: 25, s: 'Extracting pages...' },
      { p: 45, s: 'Analyzing with Claude AI...' },
      { p: 70, s: 'Checking spelling & formatting...' },
      { p: 85, s: 'Validating requirements...' },
      { p: 95, s: 'Generating report...' },
    ];

    let stepIndex = 0;
    const progressInterval = setInterval(() => {
      if (stepIndex < progressSteps.length) {
        setProgress(progressSteps[stepIndex].p);
        setStatusText(progressSteps[stepIndex].s);
        stepIndex++;
      }
    }, 1200);

    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('projectType', JSON.stringify(projectAnswers));

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Analysis failed');
      }

      const data = await response.json();
      setResults(data.results);
      setProgress(100);
      setStep('results');
    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setStep('upload');
    }
  };

  const reset = () => {
    setStep('upload');
    setFile(null);
    setResults(null);
    setError(null);
    setProgress(0);
    setProjectAnswers({ isBacklit: false, hasCutouts: false, hasCorners: false, hasLogos: false });
  };

  // ==================== UPLOAD STEP ====================
  if (step === 'upload') {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-2xl flex items-center justify-center font-bold text-2xl text-slate-900 shadow-lg shadow-cyan-500/25">
                M|R
              </div>
              <div className="text-left">
                <h1 className="text-3xl font-bold">Shop Drawing QC</h1>
                <p className="text-slate-400">Pre-flight check before Carlo</p>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 text-red-400">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-2xl p-16 text-center transition-all cursor-pointer ${
              file ? 'border-cyan-500 bg-cyan-500/5' : 'border-slate-600 hover:border-cyan-500/50 hover:bg-slate-800/30'
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <input id="fileInput" type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" />

            {file ? (
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto bg-cyan-500/20 rounded-2xl flex items-center justify-center">
                  <FileText className="text-cyan-400" size={40} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-white">{file.name}</p>
                  <p className="text-sm text-slate-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto bg-slate-700/50 rounded-2xl flex items-center justify-center">
                  <Upload className="text-slate-400" size={40} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-white">Drop your Shop Drawing PDF here</p>
                  <p className="text-slate-400 mt-2">or click to browse</p>
                </div>
              </div>
            )}
          </div>

          {/* Continue Button */}
          {file && (
            <button
              onClick={() => setStep('questions')}
              className="w-full mt-6 py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              Continue
              <ChevronRight size={22} />
            </button>
          )}

          {/* Features */}
          <div className="mt-10 flex items-center justify-center gap-8 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <FileText size={16} />
              <span>PDF Analysis</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye size={16} />
              <span>AI Vision</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap size={16} />
              <span>~30 seconds</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== QUESTIONS STEP ====================
  if (step === 'questions') {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Project Details</h2>
            <p className="text-slate-400">Select all that apply to enable relevant checks</p>
          </div>

          <div className="space-y-3 mb-8">
            {QUESTIONS.map((q) => {
              const Icon = q.icon;
              const isSelected = projectAnswers[q.id as keyof ProjectAnswers];
              return (
                <button
                  key={q.id}
                  onClick={() => toggleAnswer(q.id as keyof ProjectAnswers)}
                  className={`w-full p-5 rounded-xl border-2 transition-all flex items-center gap-4 text-left ${
                    isSelected ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  }`}
                >
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${isSelected ? 'bg-cyan-500/20' : 'bg-slate-700/50'}`}>
                    <Icon className={isSelected ? 'text-cyan-400' : 'text-slate-400'} size={28} />
                  </div>
                  <div className="flex-1">
                    <span className={`font-semibold text-lg ${isSelected ? 'text-white' : 'text-slate-300'}`}>{q.label}</span>
                    <p className="text-sm text-slate-500">{q.desc}</p>
                  </div>
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-cyan-500 bg-cyan-500' : 'border-slate-600'}`}>
                    {isSelected && <CheckCircle className="text-slate-900" size={18} />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep('upload')} className="px-8 py-4 border border-slate-600 text-slate-300 font-medium rounded-xl hover:bg-slate-800 transition-colors">
              Back
            </button>
            <button onClick={runAnalysis} className="flex-1 py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2">
              <Zap size={22} />
              Run Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== ANALYZING STEP ====================
  if (step === 'analyzing') {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-md text-center space-y-8">
          <div className="w-28 h-28 mx-auto bg-cyan-500/20 rounded-3xl flex items-center justify-center">
            <Loader2 className="text-cyan-400 animate-spin" size={56} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Analyzing Drawing</h2>
            <p className="text-slate-400 text-lg">{statusText}</p>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-slate-500">{progress}%</p>
        </div>
      </div>
    );
  }

  // ==================== RESULTS STEP ====================
  if (step === 'results' && results) {
    const totalIssues = results.criticalIssues?.length || 0;
    const totalWarnings = results.warnings?.length || 0;
    const totalPassed = results.passed?.length || 0;
    const totalManual = results.manualReview?.length || 0;

    return (
      <div className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          {/* Summary Header */}
          <div className="mb-8 p-6 bg-slate-800/50 rounded-2xl border border-slate-700">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">{file?.name}</h2>
                <p className="text-slate-400">
                  {results.extractedInfo?.projectName || 'Shop Drawing'} • {results.extractedInfo?.location || ''} •{' '}
                  {results.projectType?.isBacklit ? '💡 Backlit' : 'Standard'}
                </p>
              </div>
              <button onClick={reset} className="px-4 py-2 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2">
                <RotateCcw size={16} />
                New Check
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-emerald-500/10 rounded-xl">
                <div className="text-4xl font-bold text-emerald-400">{totalPassed}</div>
                <div className="text-sm text-emerald-400/70 mt-1">Passed</div>
              </div>
              <div className="text-center p-4 bg-amber-500/10 rounded-xl">
                <div className="text-4xl font-bold text-amber-400">{totalWarnings}</div>
                <div className="text-sm text-amber-400/70 mt-1">Warnings</div>
              </div>
              <div className="text-center p-4 bg-red-500/10 rounded-xl">
                <div className="text-4xl font-bold text-red-400">{totalIssues}</div>
                <div className="text-sm text-red-400/70 mt-1">Critical</div>
              </div>
              <div className="text-center p-4 bg-slate-700/50 rounded-xl">
                <div className="text-4xl font-bold text-slate-300">{totalManual}</div>
                <div className="text-sm text-slate-400 mt-1">Manual</div>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-slate-900/50 rounded-xl mb-6">
              <p className="text-slate-300">{results.summary}</p>
            </div>

            {/* Overall Status */}
            <div className="pt-6 border-t border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {totalIssues > 0 ? (
                  <>
                    <XCircle className="text-red-400" size={28} />
                    <span className="font-semibold text-lg text-red-400">{totalIssues} critical issue{totalIssues > 1 ? 's' : ''} must be fixed</span>
                  </>
                ) : totalWarnings > 0 ? (
                  <>
                    <AlertTriangle className="text-amber-400" size={28} />
                    <span className="font-semibold text-lg text-amber-400">{totalWarnings} item{totalWarnings > 1 ? 's' : ''} need review</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="text-emerald-400" size={28} />
                    <span className="font-semibold text-lg text-emerald-400">All checks passed!</span>
                  </>
                )}
              </div>
              <button
                disabled={totalIssues > 0}
                className={`px-8 py-3 rounded-xl font-bold text-lg flex items-center gap-2 transition-colors ${
                  totalIssues > 0 ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-cyan-500 hover:bg-cyan-400 text-slate-900'
                }`}
              >
                <Send size={20} />
                Ready for Carlo
              </button>
            </div>
          </div>

          {/* Critical Issues */}
          {results.criticalIssues && results.criticalIssues.length > 0 && (
            <div className="mb-4 border border-red-500/30 rounded-xl overflow-hidden">
              <div className="p-4 bg-red-500/10 border-b border-red-500/30">
                <h3 className="font-bold text-lg text-red-400 flex items-center gap-2">
                  <XCircle size={20} />
                  Critical Issues ({results.criticalIssues.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-700/50">
                {results.criticalIssues.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4 bg-red-500/5">
                    <StatusBadge status="fail" critical />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-red-400 mt-1">{item.notes}</div>
                      {item.page && <div className="text-xs text-slate-500 mt-2">Page {item.page}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {results.warnings && results.warnings.length > 0 && (
            <div className="mb-4 border border-amber-500/30 rounded-xl overflow-hidden">
              <div className="p-4 bg-amber-500/10 border-b border-amber-500/30">
                <h3 className="font-bold text-lg text-amber-400 flex items-center gap-2">
                  <AlertTriangle size={20} />
                  Warnings ({results.warnings.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-700/50">
                {results.warnings.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4 bg-amber-500/5">
                    <StatusBadge status="warning" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-amber-400 mt-1">{item.notes}</div>
                      {item.page && <div className="text-xs text-slate-500 mt-2">Page {item.page}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Passed */}
          {results.passed && results.passed.length > 0 && (
            <div className="mb-4 border border-slate-700 rounded-xl overflow-hidden">
              <div className="p-4 bg-slate-800/50 border-b border-slate-700">
                <h3 className="font-bold text-lg text-emerald-400 flex items-center gap-2">
                  <CheckCircle size={20} />
                  Passed ({results.passed.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-700/50">
                {results.passed.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4">
                    <StatusBadge status="pass" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-slate-400 mt-1">{item.notes}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual Review */}
          {results.manualReview && results.manualReview.length > 0 && (
            <div className="mb-4 border border-slate-700 rounded-xl overflow-hidden">
              <div className="p-4 bg-slate-800/50 border-b border-slate-700">
                <h3 className="font-bold text-lg text-slate-400 flex items-center gap-2">
                  <Eye size={20} />
                  Manual Review ({results.manualReview.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-700/50">
                {results.manualReview.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4">
                    <StatusBadge status="pending" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-slate-400 mt-1">{item.notes}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-10 text-center text-sm text-slate-500">
            Powered by Claude AI • M|R Walls Shop Drawing QC
          </div>
        </div>
      </div>
    );
  }

  return null;
}
