import { describe, it, expect } from 'vitest';
import { sanitizeExportCellValue } from './exportUtils';

describe('sanitizeExportCellValue', () => {
    it('replaces box-drawing section bars with ASCII for PDF-safe export', () => {
        expect(sanitizeExportCellValue('═══ TIKTOK SETTLEMENT (statement sync) ═══')).toBe(
            '=== TIKTOK SETTLEMENT (statement sync) ===',
        );
    });

    it('passes through numbers', () => {
        expect(sanitizeExportCellValue(42)).toBe(42);
    });

    it('passes through plain ASCII', () => {
        expect(sanitizeExportCellValue('Net Revenue')).toBe('Net Revenue');
    });
});
