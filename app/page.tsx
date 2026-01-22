'use client';

import React, { useState, useCallback } from 'react';
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
    isBacklit: false,
    hasCutouts: false,
    hasCorners: false,
    hasLogos: false,
  });
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionResult, setCompressionResult] = useState<{ original: number; compressed: number } | null>(null);

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
          setError(`PDF is ${sizeMB}MB after compression (max 32MB). Please compress at smallpdf.com first.`);
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

  const toggleAnswer = (questionId: keyof ProjectAnswers) => {
    setProjectAnswers((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

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
          projectType: projectAnswers,
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
    setProjectAnswers({ isBacklit: false, hasCutouts: false, hasCorners: false, hasLogos: false });
    setCompressionResult(null);
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
                <h1 className="text-3xl font-bold text-white">Shop Drawing QC</h1>
                <p className="text-gray-400">Pre-flight check before Carlo</p>
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

          {/* File Size Notice */}
          <div className="mb-6 p-3 bg-gray-900/50 border border-gray-800 rounded-xl text-sm text-gray-400">
            <strong className="text-orange-400">Max file size: 32MB</strong> — Large shop drawings supported
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
            <p className="text-gray-400">Select all that apply to enable relevant checks</p>
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
                    isSelected ? 'border-orange-500 bg-orange-500/10' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                  }`}
                >
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${isSelected ? 'bg-orange-500/20' : 'bg-gray-800/50'}`}>
                    <Icon className={isSelected ? 'text-orange-400' : 'text-gray-400'} size={28} />
                  </div>
                  <div className="flex-1">
                    <span className={`font-semibold text-lg ${isSelected ? 'text-white' : 'text-gray-300'}`}>{q.label}</span>
                    <p className="text-sm text-gray-500">{q.desc}</p>
                  </div>
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-pink-500 bg-pink-500' : 'border-gray-600'}`}>
                    {isSelected && <CheckCircle className="text-black" size={18} />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep('upload')} className="px-8 py-4 border border-gray-700 text-gray-300 font-medium rounded-xl hover:bg-gray-900 transition-colors">
              Back
            </button>
            <button
              onClick={runAnalysis}
              className="flex-1 py-4 bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-400 hover:to-pink-400 text-black font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2"
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
          <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-orange-500 to-pink-500 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-gray-500">{progress}%</p>
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
                    <span className="font-semibold text-lg text-pink-400">{totalIssues} critical issue{totalIssues > 1 ? 's' : ''} must be fixed</span>
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
              <button
                disabled={totalIssues > 0}
                className={`px-8 py-3 rounded-xl font-bold text-lg flex items-center gap-2 transition-colors ${
                  totalIssues > 0 ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-400 hover:to-pink-400 text-black'
                }`}
              >
                <Send size={20} />
                Ready for Carlo
              </button>
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
