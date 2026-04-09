import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';

// Mock dependencies
jest.mock('fs');
jest.mock('child_process');
jest.mock('path');

describe('validateAndSanitizePath', () => {
  let validateAndSanitizePath: typeof import('../terminal-sessions').validateAndSanitizePath;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-import to get fresh module state
    jest.isolateModules(() => {
      validateAndSanitizePath = require('../terminal-sessions').validateAndSanitizePath;
    });
  });

  describe('Security: Path traversal prevention', () => {
    it('should block path traversal attempts with ..', () => {
      const result = validateAndSanitizePath('../../../etc/passwd');
      expect(result).toBe('/opt/workspaces');
    });

    it('should block path traversal disguised in /opt/workspaces', () => {
      const result = validateAndSanitizePath('/opt/workspaces/../../etc/passwd');
      expect(result).toBe('/opt/workspaces');
    });

    it('should allow valid nested paths', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockImplementation((p) => `/opt/workspaces/${p}`);
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);
      jest.spyOn(path, 'resolve').mockImplementation((p) => `/opt/workspaces/${p}`);
      jest.spyOn(path, 'relative').mockImplementation((base, target) => target.replace(`${base}/`, ''));
      
      const result = validateAndSanitizePath('myproject');
      expect(result).toContain('/opt/workspaces');
    });
  });

  describe('Security: Whitelist enforcement', () => {
    it('should reject paths outside whitelist', () => {
      const result = validateAndSanitizePath('/etc/passwd');
      expect(result).toBe('/opt/workspaces');
    });

    it('should reject /root directory', () => {
      const result = validateAndSanitizePath('/root/.ssh');
      expect(result).toBe('/opt/workspaces');
    });

    it('should accept valid paths in /opt/workspaces', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockReturnValue('/opt/workspaces/myproject');
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/myproject');
      jest.spyOn(path, 'relative').mockReturnValue('myproject');
      
      const result = validateAndSanitizePath('/opt/workspaces/myproject');
      expect(result).toBe('/opt/workspaces/myproject');
    });
  });

  describe('Directory validation', () => {
    it('should reject non-existent paths', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/nonexistent');
      jest.spyOn(path, 'relative').mockReturnValue('nonexistent');
      
      const result = validateAndSanitizePath('/opt/workspaces/nonexistent');
      expect(result).toBe('/opt/workspaces');
    });

    it('should reject files (not directories)', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockReturnValue('/opt/workspaces/somefile.txt');
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false } as any);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/somefile.txt');
      jest.spyOn(path, 'relative').mockReturnValue('somefile.txt');
      
      const result = validateAndSanitizePath('/opt/workspaces/somefile.txt');
      expect(result).toBe('/opt/workspaces');
    });

    it('should accept directories', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockReturnValue('/opt/workspaces/myproject');
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/myproject');
      jest.spyOn(path, 'relative').mockReturnValue('myproject');
      
      const result = validateAndSanitizePath('/opt/workspaces/myproject');
      expect(result).toBe('/opt/workspaces/myproject');
    });
  });

  describe('Default behavior', () => {
    it('should return default for undefined', () => {
      const result = validateAndSanitizePath(undefined);
      expect(result).toBe('/opt/workspaces');
    });

    it('should return default for null', () => {
      const result = validateAndSanitizePath(null as any);
      expect(result).toBe('/opt/workspaces');
    });

    it('should return default for empty string', () => {
      const result = validateAndSanitizePath('');
      expect(result).toBe('/opt/workspaces');
    });
  });

  describe('Security: Symlink bypass prevention', () => {
    it('should resolve symlinks to their real targets', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockReturnValue('/opt/workspaces/actual-project');
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/link');
      jest.spyOn(path, 'relative').mockReturnValue('actual-project');
      
      const result = validateAndSanitizePath('/opt/workspaces/link');
      expect(result).toBe('/opt/workspaces/actual-project');
    });

    it('should block symlinks pointing outside allowed directories', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockReturnValue('/etc/passwd');
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/malicious-link');
      jest.spyOn(path, 'relative').mockReturnValue('/etc/passwd');
      
      const result = validateAndSanitizePath('/opt/workspaces/malicious-link');
      expect(result).toBe('/opt/workspaces');
    });

    it('should allow legitimate symlinks within workspace', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'realpathSync').mockReturnValue('/opt/workspaces/real-project');
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/project-link');
      jest.spyOn(path, 'relative').mockReturnValue('real-project');
      
      const result = validateAndSanitizePath('/opt/workspaces/project-link');
      expect(result).toBe('/opt/workspaces/real-project');
    });
  });

  describe('Error handling', () => {
    it('should handle permission errors gracefully', () => {
      jest.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/secure');
      
      const result = validateAndSanitizePath('/opt/workspaces/secure');
      expect(result).toBe('/opt/workspaces');
    });

    it('should handle filesystem errors gracefully', () => {
      jest.spyOn(fs, 'realpathSync').mockImplementation(() => {
        throw new Error('Filesystem error');
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(path, 'resolve').mockReturnValue('/opt/workspaces/project');
      jest.spyOn(path, 'relative').mockReturnValue('project');
      
      const result = validateAndSanitizePath('/opt/workspaces/project');
      expect(result).toBe('/opt/workspaces');
    });
  });
});