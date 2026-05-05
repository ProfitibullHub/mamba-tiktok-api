import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export interface ExportData {
    headers: string[];
    rows: (string | number)[][];
}

export interface PdfBrandingOptions {
    brandName?: string;
    primaryColor?: string;
    logoUrl?: string | null;
}

function hexToRgb(color: string): [number, number, number] | null {
    const hex = color.trim().replace('#', '');
    if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return null;
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return [r, g, b];
}

function mimeToPdfImageFormat(mimeType: string | null | undefined): 'PNG' | 'JPEG' | 'WEBP' | null {
    const mime = (mimeType || '').toLowerCase();
    if (mime.includes('png')) return 'PNG';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'JPEG';
    if (mime.includes('webp')) return 'WEBP';
    return null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed reading logo blob'));
        reader.readAsDataURL(blob);
    });
}

async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
    return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
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
    subtitle?: string,
    options?: PdfBrandingOptions
): void {
    const { headers, rows } = data;
    const brandName = options?.brandName?.trim() || 'Mamba';
    const primaryColor = hexToRgb(options?.primaryColor || '') ?? [41, 128, 185];
    const logoUrl = options?.logoUrl || null;

    // Create PDF document
    const doc = new jsPDF();

    const topY = 10;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Branded by ${brandName}`, 14, topY);

    const renderAndSave = (titleStartY: number) => {
        if (title) {
            doc.setFontSize(16);
            doc.setTextColor(20);
            doc.text(title, 14, titleStartY);
        }

        if (subtitle) {
            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(subtitle, 14, title ? titleStartY + 7 : titleStartY);
        }

        autoTable(doc, {
            head: [headers],
            body: rows,
            startY: title && subtitle ? titleStartY + 13 : title ? titleStartY + 7 : titleStartY,
            styles: {
                fontSize: 8,
                cellPadding: 2,
            },
            headStyles: {
                fillColor: primaryColor,
                textColor: 255,
                fontStyle: 'bold',
            },
            alternateRowStyles: {
                fillColor: [245, 245, 245],
            },
        });

        doc.save(filename);
    };

    if (logoUrl) {
        (async () => {
            try {
                const response = await fetch(logoUrl);
                if (!response.ok) {
                    renderAndSave(15);
                    return;
                }
                const blob = await response.blob();
                const format = mimeToPdfImageFormat(blob.type);
                if (!format) {
                    // Unsupported image type for jsPDF (e.g. svg); export still proceeds.
                    renderAndSave(15);
                    return;
                }
                const dataUrl = await blobToDataUrl(blob);
                const logoBox = { x: 160, y: 4, width: 28, height: 10 };
                const dims = await getImageDimensions(dataUrl);
                if (!dims || dims.width <= 0 || dims.height <= 0) {
                    renderAndSave(15);
                    return;
                }

                // Contain-fit: preserve aspect ratio, center in the logo box.
                const scale = Math.min(logoBox.width / dims.width, logoBox.height / dims.height);
                const drawW = dims.width * scale;
                const drawH = dims.height * scale;
                const drawX = logoBox.x + (logoBox.width - drawW) / 2;
                const drawY = logoBox.y + (logoBox.height - drawH) / 2;

                doc.addImage(dataUrl, format, drawX, drawY, drawW, drawH);
                renderAndSave(18);
            } catch {
                // Non-fatal: continue without logo image if loading/conversion fails.
                renderAndSave(15);
            }
        })();
        return;
    }

    renderAndSave(15);
}
