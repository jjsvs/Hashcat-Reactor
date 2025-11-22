export enum SessionStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
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

export interface SessionStats {
  status: SessionStatus;
  target: string;
  hashType: string;
  progress: number;
  recovered: number;
  total: number;
  hashrate: number;
  estimatedTimeRemaining: string;
  startTime: number;
}

export interface HistoryPoint {
  timestamp: number;
  hashrate: number;
  temp: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' | 'CMD';
  message: string;
}

export interface RecoveredHash {
  id: string;
  hash: string;
  plain: string;
  algorithmId: string;
  timestamp: number;
  sentToEscrow?: boolean;
}

// Hashes.com Interfaces matching official API
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
  leftList: string; // Relative path e.g. "/unfound/..."
}

export interface EscrowAlgo {
  id: number;
  algorithmName: string;
}

// Hashcat Configuration
export interface HashcatConfig {
  hashType: string; // -m
  attackMode: number; // -a
  
  // Paths
  targetPath: string; // The file containing hashes to crack
  wordlistPath: string;
  wordlistPath2?: string; // Optional: For Mode 1 (Combination) right side
  rulePath: string;
  mask: string;
  maskFile: string; // New: mask from file
  
  // Flags & Options
  optimizedKernel: boolean; // -O
  workloadProfile: number; // -w
  statusTimer: number; // --status-timer
  potfileDisable: boolean; // --potfile-disable
  remove: boolean; // --remove
  hwmonDisable: boolean; // --hwmon-disable
  
  // Advanced
  bitmapMax: number; // --bitmap-max
  backendDisableOpenCL: boolean; // --backend-disable-opencl
  backendIgnoreCuda: boolean; // --backend-ignore-cuda
  spinDamp: number; // --spin-damp
  scryptTmto: number; // --scrypt-tmto
  segmentSize: number; // --segment-size
  keepGuessing: boolean; // --keep-guessing
  selfTestDisable: boolean; // --self-test-disable
  logfileDisable: boolean; // --logfile-disable
  force: boolean; // --force
  skip: number; // -s / --skip
}