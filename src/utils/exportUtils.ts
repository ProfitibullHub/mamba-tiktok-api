import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export interface ExportData {
    headers: string[];
    rows: (string | number)[][];
}

/**
 * Export data to CSV format
 */
export function exportToCSV(data: ExportData, filename: string = 'export.csv'): void {
    const { headers, rows } = data;

    // Create CSV content
    const csvRows = [headers, ...rows];
    const csvContent = csvRows
        .map(row => row.map(cell => {
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            const cellStr = String(cell);
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                return `"${cellStr.replace(/"/g, '""')}"`;
            }
            return cellStr;
        }).join(','))
        .join('\n');

    // Create blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, filename);
}

/**
 * Export data to Excel format (.xlsx)
 */
export function exportToExcel(data: ExportData, filename: string = 'export.xlsx'): void {
    const { headers, rows } = data;

    // Create worksheet data
    const wsData = [headers, ...rows];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const colWidths = headers.map((_, colIndex) => {
        const maxLength = Math.max(
            headers[colIndex].length,
            ...rows.map(row => String(row[colIndex] || '').length)
        );
        return { wch: Math.min(maxLength + 2, 50) };
    });
    ws['!cols'] = colWidths;

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    // Generate Excel file and trigger download
    XLSX.writeFile(wb, filename);
}

/**
 * Export data to PDF format
 */
export function exportToPDF(
    data: ExportData,
    filename: string = 'export.pdf',
    title?: string,
    subtitle?: string
): void {
    const { headers, rows } = data;

    // Create PDF document
    const doc = new jsPDF();

    // Add title if provided
    if (title) {
        doc.setFontSize(16);
        doc.text(title, 14, 15);
    }

    // Add subtitle if provided
    if (subtitle) {
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(subtitle, 14, title ? 22 : 15);
    }

    // Add table
    autoTable(doc, {
        head: [headers],
        body: rows,
        startY: title && subtitle ? 28 : title ? 22 : 15,
        styles: {
            fontSize: 8,
            cellPadding: 2,
        },
        headStyles: {
            fillColor: [41, 128, 185],
            textColor: 255,
            fontStyle: 'bold',
        },
        alternateRowStyles: {
            fillColor: [245, 245, 245],
        },
    });

    // Save PDF
    doc.save(filename);
}
