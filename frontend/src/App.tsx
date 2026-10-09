import { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { Sun, Moon, Mic, Send, Shield, Zap, Info, CheckCircle2, AlertTriangle, XCircle, ExternalLink, ShieldAlert, Wallet } from 'lucide-react';
import './index.css';
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

type Verdict = 'PASS' | 'WARN' | 'BLOCK';

interface Intent {
  action: 'balance' | 'send_eth' | 'send_usdc';
  amount?: string;
  recipient?: string;
  confidence: number;
}

interface WalletBalance {
  walletAddress: string;
  balanceEth: string;
  network: string;
}

interface TransactionPreview {
  network: string;
  asset?: 'ETH' | 'USDC';
  contractAddress?: string;
  sender: string;
  recipient: string;
  amount?: string;
  amountRaw?: string;
  amountEth: string;
  estimatedGas: string;
  gasCostEth?: string;
  totalCostEth: string;
  simulationStatus: string;
  failureReason?: string;
}

interface RiskResult {
  verdict: Verdict;
  reasons: string[];
}

interface ApiResponse {
  intent?: Intent;
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
}

const CONFIDENCE_THRESHOLD = 0.90;

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  const [requestText, setRequestText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [intent, setIntent] = useState<Intent | null>(null);
  const [walletBalance, setWalletBalance] = useState<WalletBalance | null>(null);
  const [preview, setPreview] = useState<TransactionPreview | null>(null);
  const [risk, setRisk] = useState<RiskResult | null>(null);
  const [approvalToken, setApprovalToken] = useState<string | null>(null);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{hash?: string, success?: boolean, pending?: boolean, error?: string, message?: string} | null>(null);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const cardsContainerRef = useRef<HTMLDivElement>(null);

  // Invalidate previous approval token, preview, and results when user revises request
  const handleTextChange = (newText: string) => {
    setRequestText(newText);
    if (approvalToken || preview || intent || risk || walletBalance || executionResult) {
      setApprovalToken(null);
      setPreview(null);
      setIntent(null);
      setRisk(null);
      setWalletBalance(null);
      setExecutionResult(null);
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
      // Only animate elements that haven't been animated yet
      const newCards = Array.from(cards).filter(card => !card.classList.contains('animated'));
      
      if (newCards.length > 0) {
        gsap.fromTo(newCards, 
          { opacity: 0, y: 40, rotateX: 15, scale: 0.95 },
          { 
            opacity: 1, 
            y: 0, 
            rotateX: 0, 
            scale: 1, 
            duration: 0.7, 
            stagger: 0.1, 
            ease: 'power3.out',
            onComplete: () => {
              newCards.forEach(c => c.classList.add('animated'));
            }
          }
        );
      }
    }
  }, [intent, walletBalance, preview, risk, executionResult]);

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg("Your browser does not support the Web Speech API. Please try a different browser like Chrome.");
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

  const handleSimulate = async () => {
    if (!requestText.trim()) return;
    
    setIsProcessing(true);
    setErrorMsg(null);
    setIntent(null);
    setWalletBalance(null);
    setPreview(null);
    setRisk(null);
    setApprovalToken(null);
    setExecutionResult(null);

    // Reset animated classes for next run
    if (cardsContainerRef.current) {
      const cards = cardsContainerRef.current.querySelectorAll('.animate-card');
      cards.forEach(c => c.classList.remove('animated'));
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: requestText })
      });

      let data: ApiResponse = {};
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);
        throw new Error('Received invalid non-JSON response from server');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process intent');
      }

      if (data.intent) setIntent(data.intent);
      if (data.balance) setWalletBalance(data.balance);
      if (data.preview) setPreview(data.preview);
      if (data.risk) setRisk(data.risk);
      if (data.approvalToken) setApprovalToken(data.approvalToken);

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = async () => {
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
        setExecutionResult({ success: false, pending: true, hash: data.hash, message: data.message });
      } else {
        setExecutionResult({ success: true, hash: data.hash, message: data.message });
      }
    } catch (err) {
      setExecutionResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsExecuting(false);
    }
  };

  const getVerdictIcon = (verdict: Verdict) => {
    if (verdict === 'PASS') return <CheckCircle2 className="w-10 h-10 text-success" />;
    if (verdict === 'WARN') return <AlertTriangle className="w-10 h-10 text-warn" />;
    return <ShieldAlert className="w-10 h-10 text-danger" />;
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-20 perspective-container">
      {/* Header */}
      <header className="flex items-center justify-between py-6 mb-8 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent to-accent-hover flex items-center justify-center shadow-lg shadow-accent/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">VoxIntent</h1>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Web3 Security Engine</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            <span className="text-xs font-mono font-medium text-accent">Sepolia Network</span>
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
        
        {/* Request Panel */}
        <section className="glass-card p-6 lg:p-8 animate-card opacity-0">
          <div className="flex items-center gap-2 mb-4">
            <Mic className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold">Natural Language Request</h2>
          </div>
          
          <div className="relative">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input 
                  type="text" 
                  className="input-field pl-12 h-14 text-lg font-medium shadow-inner"
                  value={requestText}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSimulate()}
                  placeholder="e.g. Send 0.05 ETH to vitalik.eth or Check my balance"
                  disabled={isProcessing || isExecuting}
                />
                <button 
                  type="button"
                  onClick={toggleListening}
                  className={`absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
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
                className="btn-primary flex items-center justify-center gap-2 h-14 px-8" 
                onClick={handleSimulate} 
                disabled={isProcessing || isExecuting || !requestText.trim()}
              >
                {isProcessing ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    <span>Analyze</span>
                  </>
                )}
              </button>
            </div>
          </div>
          
          {errorMsg && (
            <div className="mt-4 p-4 rounded-xl bg-danger/10 border border-danger/20 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
              <p className="text-danger text-sm font-medium">{errorMsg}</p>
            </div>
          )}
        </section>

        {/* Intent Extraction Panel */}
        {intent && (
          <section className="glass-card p-6 animate-card opacity-0">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-semibold">Extracted Intent</h2>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-bold border ${intent.confidence >= CONFIDENCE_THRESHOLD ? 'bg-success/10 border-success/30 text-success' : 'bg-warn/10 border-warn/30 text-warn'}`}>
                {(intent.confidence * 100).toFixed(0)}% Confidence
              </div>
            </div>
            
            <div className={`grid grid-cols-1 ${intent.action === 'balance' ? 'md:grid-cols-1' : 'md:grid-cols-3'} gap-4`}>
              <div className="glass-panel p-4">
                <div className="text-xs text-text-secondary font-medium mb-1 uppercase tracking-wide">Action</div>
                <div className="font-mono text-lg font-semibold text-text-primary">
                  {intent.action.toUpperCase()}
                  {intent.action === 'balance' && <span className="text-xs font-sans text-text-secondary ml-2 font-normal">(Read-only Query)</span>}
                </div>
              </div>
              {intent.action !== 'balance' && (
                <>
                  <div className="glass-panel p-4">
                    <div className="text-xs text-text-secondary font-medium mb-1 uppercase tracking-wide">
                      {intent.action === 'send_usdc' ? 'Amount (USDC)' : 'Amount (ETH)'}
                    </div>
                    <div className="font-mono text-lg font-semibold text-text-primary">{intent.amount}</div>
                  </div>
                  <div className="glass-panel p-4">
                    <div className="text-xs text-text-secondary font-medium mb-1 uppercase tracking-wide">Recipient</div>
                    <div className="font-mono text-lg font-semibold text-text-primary truncate" title={intent.recipient}>{intent.recipient}</div>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* Wallet Balance Panel for balance intent */}
        {walletBalance && (
          <section className="glass-card p-6 animate-card opacity-0 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-bl-full pointer-events-none"></div>
            
            <div className="flex items-center gap-2 mb-6">
              <Wallet className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold">Wallet Balance (Sepolia)</h2>
            </div>
            
            <div className="glass-panel p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-4">
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Network</span>
                <span className="font-mono text-sm font-medium uppercase">{walletBalance.network} Testnet</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Available Balance</span>
                <span className="font-mono text-base font-bold text-accent">
                  {walletBalance.balanceEth} ETH
                </span>
              </div>
              <div className="md:col-span-2 flex flex-col md:flex-row md:justify-between md:items-center py-2 border-surface-border/50 gap-2">
                <span className="text-sm text-text-secondary shrink-0">Account Address</span>
                <span className="font-mono text-sm text-text-primary bg-surface/50 border border-surface-border px-3 py-1 rounded-lg break-all">
                  {walletBalance.walletAddress}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Transaction Preview Panel */}
        {preview && (
          <section className="glass-card p-6 animate-card opacity-0 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-bl-full pointer-events-none"></div>
            
            <div className="flex items-center gap-2 mb-6">
              <Zap className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold">Simulation & Routing</h2>
            </div>
            
            <div className="glass-panel p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-4">
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Network</span>
                <span className="font-mono text-sm font-medium">{preview.network}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Asset</span>
                <span className="font-mono text-sm font-bold text-accent">{preview.asset || (intent?.action === 'send_usdc' ? 'USDC' : 'ETH')}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Transfer Amount</span>
                <span className="font-mono text-sm font-medium">
                  {preview.amount || preview.amountEth} {preview.asset || (intent?.action === 'send_usdc' ? 'USDC' : 'ETH')}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Simulation Status</span>
                <span className={`font-mono text-sm font-bold ${preview.simulationStatus === 'success' ? 'text-success' : 'text-danger'}`}>
                  {preview.simulationStatus.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">
                  {preview.asset === 'USDC' ? 'Gas Cost (ETH)' : 'Total Cost (ETH)'}
                </span>
                <span className="font-mono text-sm font-medium">{preview.gasCostEth || preview.totalCostEth} ETH</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-surface-border/50">
                <span className="text-sm text-text-secondary">Estimated Gas</span>
                <span className="font-mono text-sm font-medium">{preview.estimatedGas}</span>
              </div>
              {preview.contractAddress && (
                <div className="md:col-span-2 flex flex-col md:flex-row md:justify-between md:items-center py-2 border-b border-surface-border/50 gap-2">
                  <span className="text-sm text-text-secondary shrink-0">USDC Contract</span>
                  <span className="font-mono text-xs text-text-secondary bg-surface/50 border border-surface-border px-3 py-1 rounded-lg break-all">
                    {preview.contractAddress}
                  </span>
                </div>
              )}
              <div className="md:col-span-2 flex flex-col md:flex-row md:justify-between md:items-center py-2 border-surface-border/50 gap-2">
                <span className="text-sm text-text-secondary shrink-0">Resolved Address</span>
                <span className="font-mono text-sm text-accent bg-accent/10 px-3 py-1 rounded-lg break-all">
                  {preview.recipient}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Intent Firewall Panel */}
        {risk && (
          <section className="glass-card p-6 animate-card opacity-0">
            <div className="flex items-center gap-2 mb-6">
              <Shield className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold">Security Firewall</h2>
            </div>
            
            <div className={`rounded-xl border p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center shadow-inner ${
              risk.verdict === 'PASS' ? 'verdict-pass' : 
              risk.verdict === 'WARN' ? 'verdict-warn' : 'verdict-block'
            }`}>
              <div className="shrink-0">
                {getVerdictIcon(risk.verdict)}
              </div>
              
              <div className="flex-1">
                <h3 className="text-xl font-bold mb-1 tracking-tight">{risk.verdict}</h3>
                <div className="text-sm opacity-90 font-medium">
                  {risk.verdict === 'PASS' 
                    ? 'All security constraints satisfied. Safe to execute.' 
                    : 'Transaction flagged by security policies:'}
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

        {/* Authorization Panel */}
        {risk && risk.verdict === 'PASS' && !executionResult && intent && preview && (
          <section className="glass-card p-6 border-accent/40 animate-card opacity-0 shadow-[0_0_30px_rgba(59,130,246,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-success via-accent to-success"></div>
            
            <h2 className="text-lg font-semibold mb-2">Transaction Authorization</h2>
            <p className="text-sm text-text-secondary mb-6">
              Review details carefully. This action is irreversible on the Sepolia testnet.
            </p>
            
            <button 
              className="w-full bg-success hover:bg-success/90 text-white shadow-lg shadow-success/30 hover:shadow-success/40 py-4 rounded-xl font-bold text-lg transition-all duration-300 hover:-translate-y-1 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-3"
              onClick={handleExecute}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Executing on Sepolia...</span>
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
          <section className="glass-card p-6 animate-card opacity-0">
            <h2 className="text-lg font-semibold mb-4">Execution Status</h2>
            
            {executionResult.pending ? (
              <div className="bg-warn/10 border border-warn/30 rounded-xl p-6 text-center">
                <div className="w-16 h-16 bg-warn/20 text-warn rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-warn mb-2">Confirmation Pending</h3>
                <p className="text-text-secondary text-sm mb-4">
                  {executionResult.message || 'Transaction was broadcasted, but confirmation timed out on Sepolia. Do not re-submit.'}
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
              <div className="bg-success/10 border border-success/30 rounded-xl p-6 text-center">
                <div className="w-16 h-16 bg-success/20 text-success rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-success mb-2">Transaction Successful</h3>
                <p className="text-text-secondary text-sm mb-4">Your intent has been executed on the Sepolia network.</p>
                
                <a 
                  href={`https://sepolia.etherscan.io/tx/${executionResult.hash}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-surface-border rounded-lg text-accent hover:bg-accent/10 transition-colors font-mono text-sm break-all"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span className="truncate max-w-[200px] sm:max-w-md">{executionResult.hash}</span>
                </a>
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
          </section>
        )}

      </div>
    </div>
  );
}

export default App;
