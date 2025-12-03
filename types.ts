export enum SessionStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  STOPPED = 'STOPPED'
}

export interface GpuDevice {
  id: number;
  name: string;
  temp: number;
  fanSpeed: number;
  utilization: number;
  coreClock: number;
  memoryClock: number;
}

export interface RecoveredHash {
  id: string;
  hash: string;
  plain: string;
  algorithmId: string;
  timestamp: number;
  sentToEscrow?: boolean;
}

export interface SessionStats {
  sessionId?: string; 
  name?: string; 
  status: SessionStatus;
  target: string;
  hashType: string;
  attackMode?: number;
  progress: number;
  recovered: number;
  total: number;
  hashrate: number;
  estimatedTimeRemaining: string;
  startTime: number;
  recoveredHashes: RecoveredHash[];
}

export interface HistoryPoint {
  timestamp: number;
  hashrate: number;
  temp: number;
}

export interface LogEntry {
  id: string;
  sessionId?: string; 
  timestamp: Date;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' | 'CMD';
  message: string;
}

// Queue Interface
export interface QueueItem {
  id: string;
  config: HashcatConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED';
  addedAt: number;
  targetSummary: string;
}

// Hashes.com Interfaces
export interface EscrowJob {
  id: number;
  createdAt: string;
  lastUpdate: string;
  algorithmName: string;
  algorithmId: number;
  totalHashes: number;
  foundHashes: number;
  leftHashes: number;
  currency: string;
  pricePerHash: string;
  pricePerHashUsd: string;
  maxCracksNeeded: number;
  leftList: string; 
}

export interface EscrowAlgo {
  id: number;
  algorithmName: string;
}

// Hashcat Configuration
export interface HashcatConfig {
  hashType: string; // -m
  attackMode: number; // -a
  
  // Hardware & Resources
  devices: string; // -d (e.g., "1,2")
  resourcesPath: string; // Path to scan for files
  
  // Paths
  targetPath: string; 
  wordlistPath: string;
  wordlistPath2?: string; 
  rulePath: string;
  mask: string;
  maskFile: string; 
  
  // Increment Settings
  increment: boolean; // --increment (-i)
  incrementMin: number; // --increment-min
  incrementMax: number; // --increment-max
  incrementInverse: boolean; // --increment-inverse

  // Flags & Options
  optimizedKernel: boolean; // -O
  workloadProfile: number; // -w
  statusTimer: number; // --status-timer
  potfileDisable: boolean; // --potfile-disable
  remove: boolean; // --remove
  hwmonDisable: boolean; // --hwmon-disable
  
  // Advanced
  bitmapMax: number; 
  backendDisableOpenCL: boolean; 
  backendIgnoreCuda: boolean; 
  spinDamp: number; 
  scryptTmto: number; 
  segmentSize: number; 
  keepGuessing: boolean; 
  selfTestDisable: boolean; 
  logfileDisable: boolean; 
  force: boolean; 
  skip: number; 
}