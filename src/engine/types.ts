export type Axis = 'SAFE' | 'CLEAN' | 'RUNS' | 'HONEST';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';

export interface Finding {
  ruleId: string;
  axis: Axis;
  severity: Severity;
  confidence: Confidence;
  message: string;
  /** Repo-relative path, when the finding is tied to a file. */
  file?: string;
  /** 1-based line number, when known. */
  line?: number;
}

export interface ScannedFile {
  /** Repo-relative path using forward slashes. */
  relPath: string;
  absPath: string;
  content: string;
  lines: string[];
}

export type PackageResolution = 'exists' | 'missing' | 'unknown';

export interface ScanOptions {
  /**
   * Resolves whether an npm package name exists in the registry.
   * Injectable so tests never touch the network.
   */
  resolvePackage?: (name: string) => Promise<PackageResolution>;
}

export interface ScanContext {
  root: string;
  files: ScannedFile[];
  options: ScanOptions;
}

export interface Rule {
  id: string;
  axis: Axis;
  description: string;
  check(ctx: ScanContext): Finding[] | Promise<Finding[]>;
}

export interface ScanResult {
  root: string;
  fileCount: number;
  findings: Finding[];
}
