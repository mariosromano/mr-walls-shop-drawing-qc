'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import { upload } from '@vercel/blob/client';
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
  Smile,
  User,
} from 'lucide-react';

const REVIEWERS = ['Carlo', 'Kamila', 'Samantha'];

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
  isBacklit: boolean | null;
  hasCutouts: boolean | null;
  hasCorners: boolean | null;
  hasLogos: boolean | null;
}

// Target compression size (25MB) - try to compress anything over this
const TARGET_SIZE = 25 * 1024 * 1024;
// Maximum file size in bytes (32MB) - Anthropic's limit for PDFs
const MAX_FILE_SIZE = 32 * 1024 * 1024;

const QUESTIONS = [
  { id: 'isBacklit', label: 'Is this a backlit wall?', icon: Lightbulb, desc: 'LEDs behind the panels' },
  { id: 'hasCutouts', label: 'Does it have cutouts?', icon: Square, desc: 'TV openings, pass-throughs' },
  { id: 'hasCorners', label: 'Inside or outside corners?', icon: CornerDownRight, desc: 'Wall wraps around' },
  { id: 'hasLogos', label: 'Logos or inlays?', icon: Building2, desc: 'Custom engravings' },
];

async function compressPDF(file: File): Promise<{ compressedFile: File; originalSize: number; compressedSize: number }> {
  const originalSize = file.size;
  const arrayBuffer = await file.arrayBuffer();

  // Load the PDF
  const pdfDoc = await PDFDocument.load(arrayBuffer);

  // Remove metadata to reduce size
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');

  // Save with object streams enabled for better compression
  const compressedBytes = await pdfDoc.save({
    useObjectStreams: true,
  });

  // Convert Uint8Array to ArrayBuffer then to File
  const outputBuffer = compressedBytes.buffer.slice(
    compressedBytes.byteOffset,
    compressedBytes.byteOffset + compressedBytes.byteLength
  ) as ArrayBuffer;
  const compressedFile = new File([outputBuffer], file.name, { type: 'application/pdf' });

  return {
    compressedFile,
    originalSize,
    compressedSize: compressedFile.size,
  };
}

function StatusBadge({ status, critical }: { status: Status; critical?: boolean }) {
  const configs = {
    pass: { icon: CheckCircle, bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Pass' },
    warning: { icon: AlertTriangle, bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Review' },
    fail: { icon: XCircle, bg: critical ? 'bg-pink-600/30' : 'bg-pink-500/20', text: 'text-pink-400', label: critical ? 'FAIL' : 'Fail' },
    pending: { icon: Eye, bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Manual' },
    skipped: { icon: ChevronRight, bg: 'bg-gray-700/50', text: 'text-gray-500', label: 'N/A' },
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
    isBacklit: null,
    hasCutouts: null,
    hasCorners: null,
    hasLogos: null,
  });
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionResult, setCompressionResult] = useState<{ original: number; compressed: number } | null>(null);
  const [showReviewerPicker, setShowReviewerPicker] = useState(false);
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);
  const [projectNameOverride, setProjectNameOverride] = useState('');
  const [backlitAnswered, setBacklitAnswered] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [designerNotes, setDesignerNotes] = useState('');
  const [renderUrl, setRenderUrl] = useState<string | null | undefined>(undefined); // undefined=not checked, null=none found, string=url
  const [renderUrlConfirmed, setRenderUrlConfirmed] = useState(false);
  const [newRenderUrl, setNewRenderUrl] = useState('');
  const [checkingProject, setCheckingProject] = useState(false);
  const [overrideIssues, setOverrideIssues] = useState(false);
  const [noRendersNeeded, setNoRendersNeeded] = useState(false);
  const reviewerPickerRef = useRef<HTMLDivElement>(null);

  // Auto-check project in Airtable whenever project name changes (debounced)
  useEffect(() => {
    const name = projectNameOverride.trim();
    if (!name || step !== 'results') return;
    setRenderUrl(undefined);
    setRenderUrlConfirmed(false);
    setNoRendersNeeded(false);
    const timer = setTimeout(async () => {
      setCheckingProject(true);
      try {
        const res = await fetch(`/api/check-project?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        if (data.found) {
          if (data.noRendersNeeded) {
            setNoRendersNeeded(true);
            setRenderUrl(undefined);
          } else {
            setRenderUrl(data.renderUrl || null);
          }
        } else {
          setRenderUrl(null);
        }
      } catch { setRenderUrl(null); }
      finally { setCheckingProject(false); }
    }, 600);
    return () => clearTimeout(timer);
  }, [projectNameOverride, step]);

  // Close reviewer picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (reviewerPickerRef.current && !reviewerPickerRef.current.contains(event.target as Node)) {
        setShowReviewerPicker(false);
      }
    }
    if (showReviewerPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showReviewerPicker]);

  const validateFile = (uploadedFile: File): string | null => {
    if (uploadedFile.type !== 'application/pdf') {
      return 'Please upload a PDF file';
    }
    return null;
  };

  const processFile = async (uploadedFile: File) => {
    const validationError = validateFile(uploadedFile);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }

    // If file is larger than target size, compress it
    if (uploadedFile.size > TARGET_SIZE) {
      setIsCompressing(true);
      setError(null);
      setCompressionResult(null);

      try {
        const result = await compressPDF(uploadedFile);
        setCompressionResult({
          original: result.originalSize,
          compressed: result.compressedSize,
        });

        // Check if compressed file is still too large
        if (result.compressedFile.size > MAX_FILE_SIZE) {
          const sizeMB = (result.compressedFile.size / 1024 / 1024).toFixed(1);
          setError(`PDF is still ${sizeMB}MB after compression. Please compress manually: Adobe Acrobat → File → Save As Other → Reduced Size PDF`);
          setFile(null);
        } else {
          setFile(result.compressedFile);
          setError(null);
        }
      } catch (err) {
        console.error('Compression error:', err);
        setError('Failed to compress PDF. Please try compressing manually at smallpdf.com');
        setFile(null);
      } finally {
        setIsCompressing(false);
      }
    } else {
      setFile(uploadedFile);
      setError(null);
      setCompressionResult(null);
    }
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile) {
      processFile(uploadedFile);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  }, []);

  const setAnswer = (questionId: keyof ProjectAnswers, value: boolean) => {
    if (questionId === 'isBacklit') setBacklitAnswered(true);
    setProjectAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const allAnswered = Object.values(projectAnswers).every((v) => v !== null);

  const runAnalysis = async () => {
    if (!file) return;

    setStep('analyzing');
    setProgress(0);
    setError(null);
    setStatusText('Uploading PDF to storage...');

    try {
      // Step 1: Upload directly to Vercel Blob (client-side, bypasses body limit)
      setProgress(10);

      const blob = await upload(file.name, file, {
        // Store blob URL for submit step
        access: 'public',
        handleUploadUrl: '/api/upload',
      });

      setProgress(30);
      setStatusText('Analyzing with Claude AI...');

      // Step 2: Analyze using blob URL
      const analyzeResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: blob.url,
          filename: file.name,
          projectType: {
            isBacklit: projectAnswers.isBacklit === true,
            hasCutouts: projectAnswers.hasCutouts === true,
            hasCorners: projectAnswers.hasCorners === true,
            hasLogos: projectAnswers.hasLogos === true,
          },
        }),
      });

      setProgress(70);
      setStatusText('Processing results...');

      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json();
        throw new Error(errorData.error || 'Analysis failed');
      }

      const data = await analyzeResponse.json();
      setResults(data.results);
      setProjectNameOverride(data.results?.extractedInfo?.projectName || '');
      setPdfBlobUrl(blob.url);
      setProgress(100);
      setStep('results');
    } catch (err) {
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
    setProjectAnswers({ isBacklit: null, hasCutouts: null, hasCorners: null, hasLogos: null });
    setBacklitAnswered(false);
    setCompressionResult(null);
    setShowReviewerPicker(false);
    setSubmittedTo(null);
    setProjectNameOverride('');
    setSubmitError(null);
    setIsSubmitting(false);
    setPdfBlobUrl(null);
    setDesignerNotes('');
    setRenderUrl(undefined);
    setRenderUrlConfirmed(false);
    setNewRenderUrl('');
    setCheckingProject(false);
    setOverrideIssues(false);
  };

  const formatSize = (bytes: number): string => {
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  };

  // ==================== UPLOAD STEP ====================
  if (step === 'upload') {
    return (
      <div className="min-h-screen bg-black p-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-pink-500 rounded-2xl flex items-center justify-center font-bold text-2xl text-black shadow-lg shadow-orange-500/25">
                M|R
              </div>
              <div className="text-left">
                <h1 className="text-3xl font-bold text-white">Shop Drawing Checker</h1>
                <p className="text-gray-400">Self-Review Aid</p>
                <p className="text-gray-500 text-xs mt-0.5">Updated June 2, 2026</p>
              </div>
              <div className="ml-2">
                <Smile className="text-pink-400" size={32} />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-400">
              <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
              <div>
                <span>{error}</span>
                {error.includes('compress') && (
                  <div className="mt-2 text-sm">
                    <a href="https://smallpdf.com/compress-pdf" target="_blank" rel="noopener noreferrer" className="underline hover:text-red-300">
                      → Open SmallPDF Compressor
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compression Status */}
          {isCompressing && (
            <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl flex items-center gap-3 text-orange-400">
              <Loader2 size={20} className="animate-spin" />
              <span>Compressing PDF...</span>
            </div>
          )}

          {/* Compression Result */}
          {compressionResult && !error && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3 text-emerald-400">
              <CheckCircle size={20} />
              <span>
                Compressed: {formatSize(compressionResult.original)} → {formatSize(compressionResult.compressed)}
              </span>
            </div>
          )}

          {/* File Size & Compression Guidelines */}
          <div className="mb-6 p-4 bg-gray-900/50 border border-gray-800 rounded-xl text-sm text-gray-400 space-y-2">
            <div className="flex items-center gap-2">
              <strong className="text-orange-400">Recommended: Under 15MB</strong>
              <span className="text-gray-500">|</span>
              <span>Max upload: 32MB</span>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p><strong className="text-gray-400">If upload fails:</strong> Compress your PDF before uploading</p>
              <p><strong className="text-gray-400">Adobe Acrobat:</strong> File → Save As Other → Reduced Size PDF</p>
              <p><strong className="text-gray-400">Online:</strong> smallpdf.com or ilovepdf.com</p>
            </div>
          </div>

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-2xl p-16 text-center transition-all cursor-pointer ${
              file ? 'border-orange-500 bg-orange-500/5' : isCompressing ? 'border-orange-500/50 bg-orange-500/5' : 'border-gray-700 hover:border-orange-500/50 hover:bg-gray-900/50'
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !isCompressing && document.getElementById('fileInput')?.click()}
          >
            <input id="fileInput" type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" disabled={isCompressing} />
            {isCompressing ? (
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto bg-orange-500/20 rounded-2xl flex items-center justify-center">
                  <Loader2 className="text-orange-400 animate-spin" size={40} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-white">Compressing PDF...</p>
                  <p className="text-sm text-gray-400 mt-1">This may take a moment</p>
                </div>
              </div>
            ) : file ? (
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto bg-orange-500/20 rounded-2xl flex items-center justify-center">
                  <FileText className="text-orange-400" size={40} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-white">{file.name}</p>
                  <p className="text-sm text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto bg-gray-800/50 rounded-2xl flex items-center justify-center">
                  <Upload className="text-gray-400" size={40} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-white">Drop your Shop Drawing PDF here</p>
                  <p className="text-gray-400 mt-2">or click to browse</p>
                </div>
              </div>
            )}
          </div>

          {/* Continue Button */}
          {file && !isCompressing && (
            <button
              onClick={() => setStep('questions')}
              className="w-full mt-6 py-4 bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-400 hover:to-pink-400 text-black font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              Continue <ChevronRight size={22} />
            </button>
          )}

          {/* Features */}
          <div className="mt-10 flex items-center justify-center gap-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-orange-500" />
              <span>PDF Analysis</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye size={16} className="text-pink-500" />
              <span>AI Vision</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-orange-500" />
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
      <div className="min-h-screen bg-black p-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Project Details</h2>
            <p className="text-gray-400">All questions are required before running analysis</p>
          </div>

          <div className="space-y-4 mb-8">
            {QUESTIONS.map((q) => {
              const Icon = q.icon;
              const val = projectAnswers[q.id as keyof ProjectAnswers];
              return (
                <div
                  key={q.id}
                  className="p-5 rounded-xl border-2 border-gray-800 bg-gray-900/50"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-800/50 flex items-center justify-center">
                      <Icon className="text-gray-400" size={24} />
                    </div>
                    <div>
                      <span className="font-semibold text-white">{q.label}</span>
                      <p className="text-sm text-gray-500">{q.desc}</p>
                    </div>
                    {val === null && <span className="ml-auto text-xs text-orange-400 font-medium">Required</span>}
                    {val !== null && <CheckCircle className="ml-auto text-emerald-400" size={20} />}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setAnswer(q.id as keyof ProjectAnswers, true)}
                      className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                        val === true ? 'bg-orange-500 text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setAnswer(q.id as keyof ProjectAnswers, false)}
                      className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                        val === false ? 'bg-gray-400 text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 block">Designer Notes <span className="text-pink-500 font-normal normal-case">*required</span></label>
            <textarea
              value={designerNotes}
              onChange={(e) => setDesignerNotes(e.target.value)}
              placeholder="Any additional information that the sales team needs to relay to the client?"
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

                    <div className="flex gap-4">
            <button onClick={() => setStep('upload')} className="px-8 py-4 border border-gray-700 text-gray-300 font-medium rounded-xl hover:bg-gray-900 transition-colors">
              Back
            </button>
            <button
              onClick={runAnalysis}
              disabled={!allAnswered}
              className={`flex-1 py-4 font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2 ${
                allAnswered
                  ? 'bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-400 hover:to-pink-400 text-black'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
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
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="w-full max-w-md text-center space-y-8">
          <div className="w-28 h-28 mx-auto bg-gradient-to-br from-orange-500/20 to-pink-500/20 rounded-3xl flex items-center justify-center">
            <Loader2 className="text-orange-400 animate-spin" size={56} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Analyzing Drawing</h2>
            <p className="text-gray-400 text-lg">{statusText}</p>
          </div>
        </div>
      </div>
    );
  }

  // ==================== RESULTS STEP ====================
  if (step === 'results' && results) {
    const totalIssues = results.criticalIssues?.length || 0;
    const hasFilenameError = results.criticalIssues?.some((i: {id: string}) => i.id === 'filename') || false;
    const canOverride = totalIssues > 0 && !hasFilenameError;
    const totalWarnings = results.warnings?.length || 0;
    const totalPassed = results.passed?.length || 0;
    const totalManual = results.manualReview?.length || 0;

    return (
      <div className="min-h-screen bg-black p-8">
        <div className="max-w-4xl mx-auto">
          {/* Summary Header */}
          <div className="mb-8 p-6 bg-gray-900/50 rounded-2xl border border-gray-800">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">{file?.name}</h2>
                <p className="text-gray-400">
                  {results.extractedInfo?.projectName || 'Shop Drawing'} • {results.extractedInfo?.location || ''} •{' '}
                  {results.projectType?.isBacklit ? '💡 Backlit' : 'Standard'}
                </p>
              </div>
              <button onClick={reset} className="px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2">
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
              <div className="text-center p-4 bg-orange-500/10 rounded-xl">
                <div className="text-4xl font-bold text-orange-400">{totalWarnings}</div>
                <div className="text-sm text-orange-400/70 mt-1">Warnings</div>
              </div>
              <div className="text-center p-4 bg-pink-500/10 rounded-xl">
                <div className="text-4xl font-bold text-pink-400">{totalIssues}</div>
                <div className="text-sm text-pink-400/70 mt-1">Critical</div>
              </div>
              <div className="text-center p-4 bg-gray-800/50 rounded-xl">
                <div className="text-4xl font-bold text-gray-300">{totalManual}</div>
                <div className="text-sm text-gray-400 mt-1">Manual</div>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-black/50 rounded-xl mb-6">
              <p className="text-gray-300">{results.summary}</p>
            </div>

            {/* Overall Status */}
            <div className="pt-6 border-t border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {totalIssues > 0 ? (
                  <>
                    <XCircle className="text-pink-400" size={28} />
                    <div>
                      <span className="font-semibold text-lg text-pink-400">{totalIssues} critical issue{totalIssues > 1 ? 's' : ''} found</span>
                      {!overrideIssues && canOverride && (
                        <button
                          onClick={() => setOverrideIssues(true)}
                          className="ml-3 text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
                        >
                          Submit anyway
                        </button>
                      )}
                      {hasFilenameError && (
                        <p className="text-xs text-red-400 mt-1">PDF filename format must be fixed before submitting.</p>
                      )}
                      {overrideIssues && (
                        <p className="text-xs text-yellow-400 mt-1">⚠️ The manager will review the critical issues.</p>
                      )}
                    </div>
                  </>
                ) : totalWarnings > 0 ? (
                  <>
                    <AlertTriangle className="text-orange-400" size={28} />
                    <span className="font-semibold text-lg text-orange-400">{totalWarnings} item{totalWarnings > 1 ? 's' : ''} need review</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="text-emerald-400" size={28} />
                    <span className="font-semibold text-lg text-emerald-400">All checks passed!</span>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-3 w-full max-w-sm">
                {submittedTo ? (
                  <div className="px-6 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-2">
                    <CheckCircle size={20} className="text-emerald-400" />
                    <span className="font-bold text-emerald-400">Posted to #{submittedTo}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-400 font-medium">Project name (confirm before submitting)</label>
                      <input
                        type="text"
                        value={projectNameOverride}
                        onChange={(e) => {
                          setProjectNameOverride(e.target.value);
                        }}
                        placeholder="e.g. 848P - Rosero Garage"
                        className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>

                    {/* Render URL check */}
                    {checkingProject && (
                      <p className="text-xs text-gray-500">Checking render folder...</p>
                    )}
                    {!checkingProject && renderUrl && !renderUrlConfirmed && (
                      <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                        <p className="text-xs text-yellow-400 font-medium mb-2">📁 Render folder found — is it up to date?</p>
                        <a href={renderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 underline block mb-2 truncate">{renderUrl}</a>
                        <button
                          onClick={() => setRenderUrlConfirmed(true)}
                          className="text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          ✓ Yes, render folder is current
                        </button>
                      </div>
                    )}
                    {!checkingProject && renderUrl && renderUrlConfirmed && (
                      <p className="text-xs text-green-400">✅ Render folder confirmed</p>
                    )}
                    {!checkingProject && renderUrl === null && (
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                        <p className="text-xs text-red-400 font-medium mb-2">⚠️ No render folder found — add a link to continue</p>
                        <input
                          type="url"
                          value={newRenderUrl}
                          onChange={(e) => setNewRenderUrl(e.target.value)}
                          placeholder="https://photos.app.goo.gl/..."
                          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-xs focus:outline-none focus:border-orange-500 mb-2"
                        />
                        <button
                          disabled={!newRenderUrl.trim()}
                          onClick={async () => {
                            if (!newRenderUrl.trim()) return;
                            setRenderUrl(newRenderUrl.trim());
                            setRenderUrlConfirmed(true);
                          }}
                          className="text-xs bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Save render link
                        </button>
                      </div>
                    )}

                    {submitError && (
                      <p className="text-sm text-pink-400">{submitError}</p>
                    )}
                    <button
                      disabled={(totalIssues > 0 && (!overrideIssues || hasFilenameError)) || !projectNameOverride.trim() || !designerNotes.trim() || isSubmitting || checkingProject || (!noRendersNeeded && renderUrl !== undefined && !renderUrlConfirmed)}
                      onClick={async () => {
                        // useEffect handles the project check automatically; just guard against in-flight
                        if (checkingProject) return;
                        setIsSubmitting(true);
                        setSubmitError(null);
                        try {
                          const res = await fetch('/api/submit', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              projectName: projectNameOverride.trim(),
                              filename: file?.name || '',
                              results,
                              pdfBlobUrl,
                              designerNotes,
                              renderUrl: newRenderUrl || renderUrl,
                              overrideIssues,
                              criticalIssues: overrideIssues ? results.criticalIssues : [],
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            setSubmitError(data.error || 'Submission failed');
                          } else {
                            setSubmittedTo(data.project || projectNameOverride);
                          }
                        } catch {
                          setSubmitError('Network error — please try again');
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className={`px-8 py-3 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-colors ${
                        (totalIssues > 0 && (!overrideIssues || hasFilenameError)) || !projectNameOverride.trim() || !designerNotes.trim() || isSubmitting || checkingProject || (!noRendersNeeded && renderUrl !== undefined && !renderUrlConfirmed)
                          ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-400 hover:to-pink-400 text-black'
                      }`}
                    >
                      {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                      {isSubmitting ? 'Submitting...' : 'Submit for Review'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Critical Issues */}
          {results.criticalIssues && results.criticalIssues.length > 0 && (
            <div className="mb-4 border border-pink-500/30 rounded-xl overflow-hidden">
              <div className="p-4 bg-pink-500/10 border-b border-pink-500/30">
                <h3 className="font-bold text-lg text-pink-400 flex items-center gap-2">
                  <XCircle size={20} />
                  Critical Issues ({results.criticalIssues.length})
                </h3>
              </div>
              <div className="divide-y divide-gray-800/50">
                {results.criticalIssues.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4 bg-pink-500/5">
                    <StatusBadge status="fail" critical />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-pink-400 mt-1">{item.notes}</div>
                      {item.page && <div className="text-xs text-gray-500 mt-2">Page {item.page}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {results.warnings && results.warnings.length > 0 && (
            <div className="mb-4 border border-orange-500/30 rounded-xl overflow-hidden">
              <div className="p-4 bg-orange-500/10 border-b border-orange-500/30">
                <h3 className="font-bold text-lg text-orange-400 flex items-center gap-2">
                  <AlertTriangle size={20} />
                  Warnings ({results.warnings.length})
                </h3>
              </div>
              <div className="divide-y divide-gray-800/50">
                {results.warnings.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4 bg-orange-500/5">
                    <StatusBadge status="warning" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-orange-400 mt-1">{item.notes}</div>
                      {item.page && <div className="text-xs text-gray-500 mt-2">Page {item.page}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Passed */}
          {results.passed && results.passed.length > 0 && (
            <div className="mb-4 border border-gray-800 rounded-xl overflow-hidden">
              <div className="p-4 bg-gray-900/50 border-b border-gray-800">
                <h3 className="font-bold text-lg text-emerald-400 flex items-center gap-2">
                  <CheckCircle size={20} />
                  Passed ({results.passed.length})
                </h3>
              </div>
              <div className="divide-y divide-gray-800/50">
                {results.passed.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4">
                    <StatusBadge status="pass" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-gray-400 mt-1">{item.notes}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual Review */}
          {results.manualReview && results.manualReview.length > 0 && (
            <div className="mb-4 border border-gray-800 rounded-xl overflow-hidden">
              <div className="p-4 bg-gray-900/50 border-b border-gray-800">
                <h3 className="font-bold text-lg text-gray-400 flex items-center gap-2">
                  <Eye size={20} />
                  Manual Review ({results.manualReview.length})
                </h3>
              </div>
              <div className="divide-y divide-gray-800/50">
                {results.manualReview.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-4">
                    <StatusBadge status="pending" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-gray-400 mt-1">{item.notes}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-10 text-center text-sm text-gray-500">
            Powered by Claude AI • M|R Walls Shop Drawing QC
          </div>
        </div>
      </div>
    );
  }

  return null;
}
