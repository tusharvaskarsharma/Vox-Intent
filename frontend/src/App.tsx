import { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import {
  Sun,
  Moon,
  Mic,
  Send,
  Shield,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  ShieldAlert,
  Wallet,
  RefreshCw,
  Edit3,
  Lock,
  Activity,
  AlertCircle,
  FileText
} from 'lucide-react';
import './index.css';
import {
  type Intent,
  type TransactionPreview,
  type RiskResult,
  type VerificationChecklistItem,
  type BalanceVerificationDetails,
  detectMismatches,
  isConfirmationAllowed
} from './intent-comparison';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

type Verdict = 'PASS' | 'WARN' | 'BLOCK';

interface WalletBalance {
  walletAddress: string;
  balanceEth: string;
  network: string;
}

interface ApiResponse {
  intent?: Intent;
  resolvedAddress?: string;
  balance?: WalletBalance;
  preview?: TransactionPreview;
  risk?: RiskResult;
  approvalToken?: string;
  error?: string;
}

interface ExecuteResponse {
  success?: boolean;
  pending?: boolean;
  hash?: string;
  error?: string;
  message?: string;
  checklist?: VerificationChecklistItem[];
  balanceVerification?: BalanceVerificationDetails;
}

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [requestText, setRequestText] = useState("");
  const [lastAnalyzedText, setLastAnalyzedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [intent, setIntent] = useState<Intent | null>(null);
  const [walletBalance, setWalletBalance] = useState<WalletBalance | null>(null);
  const [preview, setPreview] = useState<TransactionPreview | null>(null);
  const [risk, setRisk] = useState<RiskResult | null>(null);
  const [approvalToken, setApprovalToken] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    hash?: string;
    success?: boolean;
    pending?: boolean;
    error?: string;
    message?: string;
    checklist?: VerificationChecklistItem[];
    balanceVerification?: BalanceVerificationDetails;
  } | null>(null);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const simulateIdRef = useRef<number>(0);

  /**
   * SECURITY INVARIANT:
   * Any modification (typing, voice dictation, quick-edit) immediately invalidates
   * any pending preview and approval token. In-flight requests are also invalidated.
   * Stale results or previous approval tokens can NEVER be executed.
   */
  const handleTextChange = (newText: string) => {
    setRequestText(newText);
    simulateIdRef.current++; // Invalidate any in-flight simulation requests immediately
    if (approvalToken || preview || intent || risk || walletBalance || executionResult || !isStale) {
      setApprovalToken(null);
      setPreview(null);
      setIntent(null);
      setRisk(null);
      setWalletBalance(null);
      setExecutionResult(null);
      setIsStale(true);
    }
  };

  // Theme initialization
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
      setIsDarkMode(true);
    } else {
      document.documentElement.classList.remove('dark');
      setIsDarkMode(false);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setIsDarkMode(true);
    }
  };

  // GSAP animation for dynamically appearing cards
  useEffect(() => {
    if (cardsContainerRef.current) {
      const cards = cardsContainerRef.current.querySelectorAll('.animate-card');
      const newCards = Array.from(cards).filter(card => !card.classList.contains('animated'));

      if (newCards.length > 0) {
        gsap.fromTo(newCards,
          { opacity: 0, y: 30, scale: 0.98 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.5,
            stagger: 0.08,
            ease: 'power3.out',
            onComplete: () => {
              newCards.forEach(c => c.classList.add('animated'));
            }
          }
        );
      }
    }
  }, [intent, walletBalance, preview, risk, executionResult, isStale]);

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg("Your browser does not support the Web Speech API. Please try a browser like Chrome.");
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setErrorMsg(null);
      };

      recognition.onresult = (event: any) => {
        let newTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            newTranscript += event.results[i][0].transcript;
          }
        }
        if (newTranscript) {
          setRequestText(prev => {
            const updated = prev ? prev + ' ' + newTranscript.trim() : newTranscript.trim();
            handleTextChange(updated);
            return updated;
          });
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          setErrorMsg("Microphone access was denied. Please allow microphone permissions to use voice input.");
        } else if (event.error === 'no-speech') {
          setErrorMsg("No speech was detected. Please try again.");
        } else if (event.error !== 'aborted') {
          setErrorMsg(`Speech recognition error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    try {
      recognitionRef.current.start();
    } catch (e) {
      console.error(e);
      setErrorMsg("Speech recognition is already running or encountered an error starting.");
      setIsListening(false);
    }
  };

  /**
   * Sends the current request to the backend for intent extraction, validation,
   * EVM simulation, and firewall evaluation.
   */
  const handleSimulate = async () => {
    if (!requestText.trim()) return;

    const currentSimulateId = ++simulateIdRef.current;
    setIsProcessing(true);
    setErrorMsg(null);
    setIntent(null);
    setWalletBalance(null);
    setPreview(null);
    setRisk(null);
    setApprovalToken(null);
    setExecutionResult(null);
    setIsStale(false);
    setLastAnalyzedText(requestText.trim());

    // Reset animated classes for clean GSAP transitions
    if (cardsContainerRef.current) {
      const cards = cardsContainerRef.current.querySelectorAll('.animate-card');
      cards.forEach(c => c.classList.remove('animated'));
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: requestText.trim() })
      });

      let data: ApiResponse = {};
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);
        throw new Error('Received invalid non-JSON response from server');
      }

      // If user modified text or started another simulation while in-flight, discard stale response
      if (currentSimulateId !== simulateIdRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process intent');
      }

      if (data.intent) setIntent(data.intent);
      if (data.balance) setWalletBalance(data.balance);
      if (data.preview) {
        // Ensure recipient address is populated
        const previewWithRecipient = {
          ...data.preview,
          recipient: data.preview.recipient || data.resolvedAddress || ''
        };
        setPreview(previewWithRecipient);
      }
      if (data.risk) setRisk(data.risk);
      if (data.approvalToken) setApprovalToken(data.approvalToken);

    } catch (err) {
      if (currentSimulateId === simulateIdRef.current) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentSimulateId === simulateIdRef.current) {
        setIsProcessing(false);
      }
    }
  };

  /**
   * Executes the transaction with the backend.
   * Only permitted when isConfirmationAllowed(...) is true.
   */
  const handleExecute = async () => {
    if (!isConfirmationAllowed(intent, preview, risk, approvalToken, isStale)) {
      setErrorMsg("Confirmation blocked: Invalidation, firewall policy, or simulation check not satisfied.");
      return;
    }

    setIsExecuting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent,
          confirmed: true,
          approvalToken
        })
      });

      let data: ExecuteResponse = {};
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);
        throw new Error('Received invalid non-JSON response from server');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Execution failed');
      }

      if (data.pending) {
        setExecutionResult({
          success: false,
          pending: true,
          hash: data.hash,
          message: data.message,
          checklist: data.checklist,
          balanceVerification: data.balanceVerification
        });
      } else {
        setExecutionResult({
          success: true,
          hash: data.hash,
          message: data.message,
          checklist: data.checklist,
          balanceVerification: data.balanceVerification
        });
      }
      // Invalidate approval token after use
      setApprovalToken(null);
    } catch (err) {
      setExecutionResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsExecuting(false);
    }
  };

  const focusInputForModification = () => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  };

  const getVerdictIcon = (verdict: Verdict) => {
    if (verdict === 'PASS') return <CheckCircle2 className="w-9 h-9 text-success" />;
    if (verdict === 'WARN') return <AlertTriangle className="w-9 h-9 text-warn" />;
    return <ShieldAlert className="w-9 h-9 text-danger" />;
  };

  // Run mismatch detection between transcribed voice input and backend validated intent
  const comparison = detectMismatches(lastAnalyzedText || requestText, intent, preview);

  const canConfirm = isConfirmationAllowed(intent, preview, risk, approvalToken, isStale);

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 perspective-container px-4 sm:px-6">
      {/* Header */}
      <header className="flex items-center justify-between py-6 mb-8 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="VoxIntent Logo"
            className="w-10 h-10 rounded-xl object-contain shadow-lg shadow-accent/25 border border-white/10"
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">VoxIntent</h1>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Web3 Voice Firewall & Security Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            <span className="text-xs font-mono font-medium text-accent">Sepolia (11155111)</span>
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun className="w-5 h-5 text-text-secondary" /> : <Moon className="w-5 h-5 text-text-secondary" />}
          </button>
        </div>
      </header>

      {/* Main Workflow Container */}
      <div className="space-y-6 preserve-3d" ref={cardsContainerRef}>

        {/* Feature 3: Request Panel with Voice Modification & Invalidation */}
        <section className="glass-card p-6 lg:p-8 animate-card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Mic className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold">Voice Request & Dictation</h2>
            </div>
            {isStale && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-warn/10 text-warn border border-warn/20 animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Modified — Revalidation Required
              </span>
            )}
          </div>

          <div className="relative">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  className="input-field pl-12 h-14 text-base sm:text-lg font-medium shadow-inner"
                  value={requestText}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSimulate()}
                  placeholder="e.g. Send 0.05 ETH to Rahul, Send 25 USDC to Alice, or Check my balance"
                  disabled={isProcessing || isExecuting}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
                    isListening
                      ? 'text-danger bg-danger/10 animate-pulse'
                      : 'text-text-secondary hover:bg-surface-border cursor-pointer'
                  }`}
                  title="Click to dictate (Web Speech API). Wispr Flow works globally."
                  aria-label={isListening ? "Stop listening" : "Start dictating"}
                  disabled={isProcessing || isExecuting}
                >
                  <Mic className={`w-5 h-5 ${isListening ? 'opacity-100' : 'opacity-70'}`} />
                </button>
              </div>
              <button
                className="btn-primary flex items-center justify-center gap-2 h-14 px-8 text-base font-semibold"
                onClick={handleSimulate}
                disabled={isProcessing || isExecuting || !requestText.trim()}
              >
                {isProcessing ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    <span>{isStale ? "Re-validate" : "Analyze"}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Stale Invalidation Notice */}
          {isStale && (
            <div className="mt-3 p-3 rounded-xl bg-accent/5 border border-accent/20 flex items-center justify-between text-xs sm:text-sm text-text-secondary">
              <span className="flex items-center gap-2">
                <Info className="w-4 h-4 text-accent shrink-0" />
                Previous preview and approval token invalidated. Click &ldquo;Re-validate&rdquo; to process the revised request.
              </span>
              <button
                onClick={handleSimulate}
                disabled={isProcessing || !requestText.trim()}
                className="font-semibold text-accent hover:underline ml-2 shrink-0 cursor-pointer"
              >
                Re-validate Now
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 p-4 rounded-xl bg-danger/10 border border-danger/20 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
              <p className="text-danger text-sm font-medium">{errorMsg}</p>
            </div>
          )}
        </section>

        {/* Feature 2: “What you said vs. what executes” Panel */}
        {intent && !isStale && (
          <section className="glass-card p-6 animate-card border-accent/20">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-semibold">What You Said vs. What Executes</h2>
              </div>
              <div className="flex items-center gap-2">
                {comparison.hasMismatch ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-warn/10 border border-warn/30 text-warn flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Discrepancy Detected
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-success/10 border border-success/30 text-success flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Lexical Alignment Match
                  </span>
                )}
              </div>
            </div>

            {/* Mismatch warnings banner */}
            {comparison.discrepancies.length > 0 && (
              <div className="mb-4 p-4 rounded-xl bg-warn/10 border border-warn/30 text-warn text-sm">
                <div className="font-semibold flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4" />
                  Potential Transcription or Parameter Mismatch:
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm pl-2">
                  {comparison.discrepancies.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Side-by-Side Comparison Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: What You Said */}
              <div className="glass-panel p-4 border-l-4 border-l-accent/70">
                <div className="text-xs text-text-secondary font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-accent" />
                  What You Said (Voice Transcription)
                </div>
                <blockquote className="font-mono text-sm sm:text-base text-text-primary bg-surface/60 border border-surface-border p-3 rounded-lg mb-3 italic break-words">
                  &ldquo;{lastAnalyzedText || requestText}&rdquo;
                </blockquote>
                <div className="space-y-2 text-xs">
                  {comparison.comparisons.map((c, idx) => (
                    <div key={idx} className="flex justify-between items-center py-1 border-b border-surface-border/40">
                      <span className="text-text-secondary font-medium">{c.field}</span>
                      <span className="font-mono font-semibold text-text-primary truncate max-w-[180px]">{c.voiceValue}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: What Executes */}
              <div className="glass-panel p-4 border-l-4 border-l-success">
                <div className="text-xs text-text-secondary font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-success" />
                  What Executes (Backend Validated Intent)
                </div>
                <div className="font-mono text-sm sm:text-base text-text-primary bg-surface/60 border border-surface-border p-3 rounded-lg mb-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-accent">{intent.action.toUpperCase()}</span>
                    <span className="text-xs text-text-secondary">{(intent.confidence * 100).toFixed(0)}% confidence</span>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  {comparison.comparisons.map((c, idx) => (
                    <div key={idx} className="flex justify-between items-center py-1 border-b border-surface-border/40">
                      <span className="text-text-secondary font-medium">{c.field}</span>
                      <span className={`font-mono font-semibold truncate max-w-[180px] ${c.isMatch ? 'text-success' : 'text-warn'}`}>
                        {c.executedValue}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 text-center text-xs text-text-secondary italic">
              Security Notice: Lexical alignment confirms transcription wording only and does not establish execution safety. Transaction safety, balance bounds, and gas limits are determined exclusively by the Intent Firewall and EVM simulation.
            </div>
          </section>
        )}

        {/* Feature 1: Plan Card (for Send Intent) */}
        {intent && intent.action !== 'balance' && preview && !isStale && (
          <section className="glass-card p-6 lg:p-8 animate-card relative overflow-hidden border-accent/30 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
              <div className="flex items-center gap-2">
                <FileText className="w-6 h-6 text-accent" />
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Execution Plan</h2>
                  <p className="text-xs text-text-secondary">Comprehensive review of verified facts and estimated runtime costs</p>
                </div>
              </div>

              {/* Quick Voice Modification Trigger */}
              <button
                type="button"
                onClick={focusInputForModification}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface border border-surface-border hover:border-accent hover:text-accent transition-colors self-start sm:self-auto cursor-pointer"
                title="Edit or revise this request"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Modify Plan</span>
              </button>
            </div>

            {/* Section A: Confirmed Facts */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-4 h-4 text-success" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-success">Confirmed Execution Facts</h3>
                <span className="text-xs text-text-secondary">(Immutable on-chain parameters)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 glass-panel p-4">
                <div className="flex justify-between items-center py-1.5 border-b border-surface-border/40">
                  <span className="text-xs text-text-secondary">Action</span>
                  <span className="font-mono text-sm font-bold text-text-primary uppercase">{intent.action}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-surface-border/40">
                  <span className="text-xs text-text-secondary">Asset</span>
                  <span className="font-mono text-sm font-bold text-accent">{preview.asset || (intent.action === 'send_usdc' ? 'USDC' : 'ETH')}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-surface-border/40">
                  <span className="text-xs text-text-secondary">Transfer Amount</span>
                  <span className="font-mono text-base font-bold text-text-primary">
                    {preview.amount || preview.amountEth} {preview.asset || (intent.action === 'send_usdc' ? 'USDC' : 'ETH')}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-surface-border/40">
                  <span className="text-xs text-text-secondary">Network</span>
                  <span className="font-mono text-sm font-medium text-text-primary">{preview.network} (Chain ID: 11155111)</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-surface-border/40">
                  <span className="text-xs text-text-secondary">Resolved Contact</span>
                  <span className="font-mono text-sm font-bold text-text-primary">{intent.recipient}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-surface-border/40">
                  <span className="text-xs text-text-secondary">Sender Account</span>
                  <span className="font-mono text-xs text-text-secondary truncate max-w-[200px]" title={preview.sender}>
                    {preview.sender || 'Sender account'}
                  </span>
                </div>

                <div className="md:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between py-1.5 gap-1">
                  <span className="text-xs text-text-secondary shrink-0">Recipient Address (Resolved)</span>
                  <span className="font-mono text-xs font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-md break-all">
                    {preview.recipient}
                  </span>
                </div>

                {preview.contractAddress && (
                  <div className="md:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between py-1.5 gap-1 border-t border-surface-border/40 pt-2">
                    <span className="text-xs text-text-secondary shrink-0">USDC Contract Address</span>
                    <span className="font-mono text-xs text-text-secondary bg-surface/50 border border-surface-border px-2.5 py-1 rounded-md break-all">
                      {preview.contractAddress}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Section B: Estimated Runtime Parameters */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-accent">Estimated Runtime Parameters</h3>
                <span className="text-xs text-text-secondary">(Dynamic network estimates; subject to live block conditions)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 glass-panel p-4">
                <div className="p-3 rounded-lg bg-surface/40 border border-surface-border">
                  <div className="text-xs text-text-secondary font-medium mb-1">Estimated Gas</div>
                  <div className="font-mono text-base font-bold text-text-primary">
                    {preview.estimatedGas} <span className="text-xs font-sans text-text-secondary font-normal">units</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface/40 border border-surface-border">
                  <div className="text-xs text-text-secondary font-medium mb-1">Estimated Gas Cost</div>
                  <div className="font-mono text-base font-bold text-text-primary">
                    {preview.gasCostEth || 'unknown'} <span className="text-xs font-sans text-text-secondary font-normal">ETH</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface/40 border border-surface-border">
                  <div className="text-xs text-text-secondary font-medium mb-1">Max Total Cost (Approved Cap)</div>
                  <div className="font-mono text-base font-bold text-accent">
                    {preview.totalCostEth} <span className="text-xs font-sans text-text-secondary font-normal">ETH</span>
                  </div>
                </div>

                <div className="md:col-span-3 p-3 rounded-lg bg-surface/40 border border-surface-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary font-medium">EVM Simulation Status:</span>
                    <span className={`font-mono text-sm font-bold ${preview.simulationStatus === 'success' ? 'text-success' : 'text-danger'}`}>
                      {preview.simulationStatus.toUpperCase()}
                    </span>
                  </div>
                  {preview.simulationStatus === 'success' ? (
                    <span className="text-xs text-success flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Revert simulation passed cleanly
                    </span>
                  ) : (
                    <span className="text-xs text-danger flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> {preview.failureReason || 'Simulation reverted'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Feature 1 (Part B): Wallet Balance Plan (Read-Only; No Execution) */}
        {walletBalance && !isStale && (
          <section className="glass-card p-6 lg:p-8 animate-card border-accent/30 relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-6 h-6 text-accent" />
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Wallet Balance (Sepolia)</h2>
                  <p className="text-xs text-text-secondary">Read-only balance query. No transaction or approval token is generated.</p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-accent/10 border border-accent/20 text-accent">
                Read-Only
              </span>
            </div>

            <div className="glass-panel p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-4">
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Network</span>
                <span className="font-mono text-sm font-medium uppercase">{walletBalance.network} Testnet</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Available Balance</span>
                <span className="font-mono text-lg font-bold text-accent">
                  {walletBalance.balanceEth} ETH
                </span>
              </div>
              <div className="md:col-span-2 flex flex-col md:flex-row md:justify-between md:items-center py-2 gap-2">
                <span className="text-sm text-text-secondary shrink-0">Account Address</span>
                <span className="font-mono text-sm text-text-primary bg-surface/50 border border-surface-border px-3 py-1.5 rounded-lg break-all">
                  {walletBalance.walletAddress}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-accent/5 border border-accent/20 text-center text-xs text-text-secondary">
              🔒 Read-Only Query Security Invariant: Balance queries do not construct or sign transactions.
            </div>
          </section>
        )}

        {/* Security Firewall Verdict Panel */}
        {risk && !isStale && (
          <section className="glass-card p-6 animate-card">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold">Security Firewall Verdict</h2>
            </div>

            <div className={`rounded-xl border p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center shadow-inner ${
              risk.verdict === 'PASS' ? 'verdict-pass' :
              risk.verdict === 'WARN' ? 'verdict-warn' : 'verdict-block'
            }`}>
              <div className="shrink-0">
                {getVerdictIcon(risk.verdict)}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-bold tracking-tight">{risk.verdict}</h3>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface/40">
                    {risk.verdict === 'PASS' ? 'Safe to Authorize' : risk.verdict === 'WARN' ? 'Execution Blocked: Warning' : 'Execution Blocked: Policy Violation'}
                  </span>
                </div>
                <div className="text-sm opacity-90 font-medium">
                  {risk.verdict === 'PASS'
                    ? 'All security constraints and balance bounds satisfied.'
                    : 'The deterministic firewall flagged this transaction:'}
                </div>

                {risk.reasons.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {risk.reasons.map((reason, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-70"></span>
                        <span className="opacity-90">{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Transaction Authorization Panel */}
        {canConfirm && !executionResult && intent && preview && (
          <section className="glass-card p-6 border-accent/40 animate-card shadow-[0_0_30px_rgba(59,130,246,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-success via-accent to-success"></div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold">Transaction Authorization</h2>
                <p className="text-sm text-text-secondary">
                  Review the plan above carefully. This action will sign and broadcast a live transaction to Sepolia.
                </p>
              </div>

              <button
                type="button"
                onClick={focusInputForModification}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-accent transition-colors self-start sm:self-auto cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Need to change anything?</span>
              </button>
            </div>

            <button
              className="w-full bg-success hover:bg-success/90 text-white shadow-lg shadow-success/30 hover:shadow-success/40 py-4 rounded-xl font-bold text-lg transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-3 cursor-pointer"
              onClick={handleExecute}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Signing & Broadcasting on Sepolia...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-6 h-6" />
                  <span>
                    Confirm & Send {intent?.action === 'send_usdc' ? (preview.amount || preview.amountEth) : preview.amountEth} {intent?.action === 'send_usdc' ? 'USDC' : 'ETH'}
                  </span>
                </>
              )}
            </button>
          </section>
        )}

        {/* Execution Result Panel */}
        {executionResult && (
          <section className="glass-card p-6 animate-card space-y-6">
            <h2 className="text-lg font-semibold">Execution Status & On-Chain Verification</h2>

            {executionResult.pending ? (
              <div className="bg-warn/10 border border-warn/30 rounded-xl p-6 text-center">
                <div className="w-16 h-16 bg-warn/20 text-warn rounded-full flex items-center justify-center mx-auto mb-4">
                  <RefreshCw className="w-8 h-8 animate-spin" />
                </div>
                <h3 className="text-xl font-bold text-warn mb-2">Confirmation Pending</h3>
                <p className="text-text-primary font-semibold text-sm mb-1">
                  Transaction broadcast; receipt and balance verification pending.
                </p>
                <p className="text-text-secondary text-xs mb-4">
                  Do not resubmit or rebroadcast this transaction. Receipt and balance changes are awaiting inclusion on Sepolia.
                </p>

                {executionResult.hash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${executionResult.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-surface-border rounded-lg text-accent hover:bg-accent/10 transition-colors font-mono text-sm break-all"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    <span className="truncate max-w-[200px] sm:max-w-md">{executionResult.hash}</span>
                  </a>
                )}
              </div>
            ) : executionResult.success ? (
              <div
                className={`rounded-xl p-6 text-center border ${
                  executionResult.balanceVerification?.status === 'inconclusive'
                    ? 'bg-warn/10 border-warn/30'
                    : executionResult.balanceVerification?.status === 'mismatch'
                    ? 'bg-danger/10 border-danger/30'
                    : 'bg-success/10 border-success/30'
                }`}
              >
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                    executionResult.balanceVerification?.status === 'inconclusive'
                      ? 'bg-warn/20 text-warn'
                      : executionResult.balanceVerification?.status === 'mismatch'
                      ? 'bg-danger/20 text-danger'
                      : 'bg-success/20 text-success'
                  }`}
                >
                  {executionResult.balanceVerification?.status === 'inconclusive' ? (
                    <AlertTriangle className="w-8 h-8" />
                  ) : executionResult.balanceVerification?.status === 'mismatch' ? (
                    <AlertCircle className="w-8 h-8" />
                  ) : (
                    <CheckCircle2 className="w-8 h-8" />
                  )}
                </div>

                <h3
                  className={`text-xl font-bold mb-2 ${
                    executionResult.balanceVerification?.status === 'inconclusive'
                      ? 'text-warn'
                      : executionResult.balanceVerification?.status === 'mismatch'
                      ? 'text-danger'
                      : 'text-success'
                  }`}
                >
                  {executionResult.balanceVerification?.status === 'inconclusive'
                    ? 'Receipt Confirmed — Balance Verification Inconclusive'
                    : executionResult.balanceVerification?.status === 'mismatch'
                    ? 'Receipt Confirmed — Balance Delta Mismatch'
                    : 'Transaction Successfully Executed & Verified'}
                </h3>

                <p className="text-text-secondary text-sm mb-4">
                  {executionResult.balanceVerification?.status === 'inconclusive'
                    ? 'Transaction receipt was confirmed on-chain, but post-execution balance query was inconclusive. This does NOT indicate an on-chain revert.'
                    : executionResult.balanceVerification?.status === 'mismatch'
                    ? 'Transaction receipt confirmed, but observed balance delta did not match expected integer calculations.'
                    : 'Your intent has been executed on Sepolia, receipt confirmed, and exact balance changes verified.'}
                </p>

                {executionResult.hash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${executionResult.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-surface-border rounded-lg text-accent hover:bg-accent/10 transition-colors font-mono text-sm break-all"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    <span className="truncate max-w-[200px] sm:max-w-md">{executionResult.hash}</span>
                  </a>
                )}
              </div>
            ) : (
              <div className="bg-danger/10 border border-danger/30 rounded-xl p-6 text-center">
                <div className="w-16 h-16 bg-danger/20 text-danger rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-danger mb-2">Execution Failed</h3>
                <p className="text-danger/80 text-sm font-medium">{executionResult.error}</p>
              </div>
            )}

            {/* Structured Verification Checklist */}
            {executionResult.checklist && executionResult.checklist.length > 0 && (
              <div className="border-t border-surface-border pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent" />
                    Verification Checklist
                  </h3>
                  <span className="text-xs font-mono text-text-secondary">On-Chain Audit</span>
                </div>

                <div className="space-y-2.5">
                  {executionResult.checklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-surface/50 border border-surface-border"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {item.status === 'passed' && (
                            <CheckCircle2 className="w-5 h-5 text-success" />
                          )}
                          {item.status === 'failed' && (
                            <XCircle className="w-5 h-5 text-danger" />
                          )}
                          {item.status === 'pending' && (
                            <RefreshCw className="w-5 h-5 text-warn animate-spin" />
                          )}
                          {item.status === 'inconclusive' && (
                            <AlertTriangle className="w-5 h-5 text-warn" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-text-primary">{item.label}</div>
                          {item.description && (
                            <div className="text-xs text-text-secondary mt-0.5 font-mono break-all">{item.description}</div>
                          )}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 px-2.5 py-0.5 text-[11px] font-bold rounded-full uppercase tracking-wider ${
                          item.status === 'passed'
                            ? 'bg-success/15 text-success border border-success/30'
                            : item.status === 'failed'
                            ? 'bg-danger/15 text-danger border border-danger/30'
                            : item.status === 'pending'
                            ? 'bg-warn/15 text-warn border border-warn/30'
                            : 'bg-warn/15 text-warn border border-warn/30'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Balance Verification Breakdown (Integer Base Units) */}
            {executionResult.balanceVerification && (
              <div className="border-t border-surface-border pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-accent" />
                    Balance Verification Breakdown ({executionResult.balanceVerification.asset})
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full uppercase tracking-wider ${
                      executionResult.balanceVerification.status === 'passed'
                        ? 'bg-success/15 text-success border border-success/30'
                        : executionResult.balanceVerification.status === 'mismatch'
                        ? 'bg-danger/15 text-danger border border-danger/30'
                        : executionResult.balanceVerification.status === 'inconclusive'
                        ? 'bg-warn/15 text-warn border border-warn/30'
                        : 'bg-surface text-text-secondary border border-surface-border'
                    }`}
                  >
                    Status: {executionResult.balanceVerification.status}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                    <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Sender Pre-ETH Balance</div>
                    <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.preSenderEth} wei</div>
                  </div>
                  <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                    <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Sender Post-ETH Balance</div>
                    <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.postSenderEth ?? 'Pending confirmation'} wei</div>
                  </div>
                  <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                    <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Observed Sender ETH Delta</div>
                    <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.senderEthDelta ?? 'Pending'} wei</div>
                  </div>
                  <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                    <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Actual Gas Fee Paid</div>
                    <div className="font-semibold text-text-primary break-all">
                      {executionResult.balanceVerification.actualGasFeeWei ?? '0'} wei ({executionResult.balanceVerification.actualGasFeeEth ?? '0'} ETH)
                    </div>
                  </div>

                  {executionResult.balanceVerification.asset === 'USDC' && (
                    <>
                      <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                        <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Sender Pre-USDC Units</div>
                        <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.preSenderUsdc ?? '0'} units</div>
                      </div>
                      <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                        <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Sender Post-USDC Units</div>
                        <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.postSenderUsdc ?? 'Pending'} units</div>
                      </div>
                      <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                        <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Observed Sender USDC Delta</div>
                        <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.senderUsdcDelta ?? 'Pending'} units</div>
                      </div>
                      <div className="p-3 rounded-lg bg-surface/50 border border-surface-border">
                        <div className="text-text-secondary text-[10px] mb-1 uppercase tracking-wide">Observed Recipient USDC Delta</div>
                        <div className="font-semibold text-text-primary break-all">{executionResult.balanceVerification.recipientUsdcDelta ?? 'Pending'} units</div>
                      </div>
                    </>
                  )}
                </div>

                {executionResult.balanceVerification.details && (
                  <div className="mt-3 p-3 rounded-lg bg-surface/60 border border-surface-border text-xs text-text-secondary">
                    <span className="font-semibold text-text-primary">Verification Details: </span>
                    {executionResult.balanceVerification.details}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}

export default App;
