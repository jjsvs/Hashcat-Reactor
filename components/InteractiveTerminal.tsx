import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Socket } from 'socket.io-client';
import { Lock } from 'lucide-react'; // Import Lock icon
import 'xterm/css/xterm.css';

interface InteractiveTerminalProps {
  socket: Socket | null;
  disabled?: boolean; // NEW PROP
}

const InteractiveTerminal: React.FC<InteractiveTerminalProps> = ({ socket, disabled = false }) => {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // 1. Handle Visual State Changes (Cursor & Theme)
  useEffect(() => {
    if (xtermRef.current) {
        // Change cursor style to indicate disabled state
        xtermRef.current.options.cursorStyle = disabled ? 'underline' : 'block';
        xtermRef.current.options.cursorBlink = !disabled;
        // Dim the text slightly if disabled
        xtermRef.current.options.theme = {
            ...xtermRef.current.options.theme,
            foreground: disabled ? '#64748b' : '#e2e8f0' 
        };
    }
  }, [disabled]);

  useEffect(() => {
    if (!terminalContainerRef.current || !socket || isInitialized.current) return;

    isInitialized.current = true;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        selectionBackground: '#334155',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;
    xtermRef.current = term;

    term.open(terminalContainerRef.current);
    
    setTimeout(() => {
        fitAddon.fit();
        socket.emit('term_init');
        socket.emit('term_resize', { cols: term.cols, rows: term.rows });
    }, 50);

    const handleOutput = (data: string) => term.write(data);
    socket.on('term_output', handleOutput);

    // 2. THE WRAPPER LOGIC: Intercept Input
    // We use a ref to access the latest 'disabled' prop value inside the callback
    // without re-creating the listener constantly.
    term.onData((data) => {
      // Check the prop passed from parent
      // We need to access the LATEST value of disabled. 
      // Since this closure is created once, we rely on the parent causing a re-render
      // or we can strictly enforce it via the UI overlay blocking pointer events.
      // However, xterm captures input aggressively, so we check the prop:
      if (disabled) return; // BLOCKED
      
      socket.emit('term_input', data);
    });

    // Resize Logic
    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          try {
            fitAddonRef.current.fit();
            const { cols, rows } = xtermRef.current;
            if (cols > 0 && rows > 0) socket.emit('term_resize', { cols, rows });
          } catch (e) { console.warn("Resize error:", e); }
        }
      }, 100);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(terminalContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(resizeTimeout);
      socket.off('term_output', handleOutput);
      term.dispose();
      isInitialized.current = false;
    };
  }, [socket]); // We intentionally exclude 'disabled' here to avoid re-init the whole terminal

  return (
    <div className="h-full w-full bg-slate-950 rounded-xl overflow-hidden flex flex-col border border-slate-800 shadow-2xl relative group">
       <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${disabled ? 'bg-red-500' : 'bg-slate-700'}`}></div>
            <div className={`w-3 h-3 rounded-full ${disabled ? 'bg-red-500' : 'bg-slate-700'}`}></div>
            <div className={`w-3 h-3 rounded-full ${disabled ? 'bg-red-500' : 'bg-slate-700'}`}></div>
            <span className="ml-2 text-slate-400 text-xs font-mono font-bold">REACTOR SHELL ACCESS</span>
        </div>
        <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${disabled ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></div>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                {disabled ? 'LOCKED' : 'INTERACTIVE'}
            </span>
        </div>
      </div>
      
      <div className="flex-1 relative bg-slate-950 p-1">
        <div ref={terminalContainerRef} className="absolute inset-0 h-full w-full" />
        
        {/* 3. VISUAL OVERLAY: Blocks clicks and shows warning */}
        {disabled && (
            <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-slate-400 select-none animate-in fade-in duration-200">
                <div className="bg-slate-900 p-6 rounded-2xl border border-red-500/20 shadow-2xl flex flex-col items-center max-w-sm text-center">
                    <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                        <Lock className="text-red-500" size={24} />
                    </div>
                    <h3 className="text-slate-200 font-bold text-lg mb-2">Terminal Locked</h3>
                    <p className="text-sm text-slate-500">
                        A cracking session is currently active. Access is restricted to prevent GPU resource conflicts.
                    </p>
                    <div className="mt-4 px-3 py-1 bg-slate-950 rounded border border-slate-800 text-xs font-mono text-yellow-500">
                        Stop session to unlock
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default InteractiveTerminal;