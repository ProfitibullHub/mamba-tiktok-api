import PDFDocument from 'pdfkit';

const PDF_MARGIN_X = 56;
/** Leave room for right column so long labels (e.g. TikTok settlement…) never overlap values */
const PDF_ROW_LABEL_W = 260;
const PDF_LABEL_VALUE_GAP = 20;
const PDF_PAGE_MARGIN = 48;
const PDF_ROW_GAP = 12;
const PDF_SECTION_GAP = 20;

type ReportType = 'order' | 'pl';

type PdfKitDoc = InstanceType<typeof PDFDocument>;

export type DashboardPdfPayload = {
    brandName: string;
    accountName: string;
    shopName: string;
    periodLabel: string;
    reportTypes: ReportType[];
    orderSummary?: {
        orderCount: number;
        gmv: number;
    };
    plSummary?: {
        gmv: number;
        totalOrders: number;
        totalRevenue: number;
        netSales: number;
        grossProfit: number;
        netProfit: number;
        adSpend?: number;
    };
    notes?: string[];
};

/** Mamba export — aligns with platform palette */
const PDF_HEADER_BG = '#06141A';
const PDF_PRIMARY_TEXT = '#E6F3F1';
const PDF_MUTED_TEXT = '#8CAFB3';
const PDF_BODY_HEADING = '#06141A';
const PDF_ROW_LABEL = '#8CAFB3';
const PDF_ROW_VALUE = '#06141A';
const PDF_NOTE = '#1F3A43';
const PDF_FOOTNOTE = '#8CAFB3';

function currency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

/**
 * Two-column row: label (wraps) left, value right — avoids PDFKit `continued` cursor bugs that stack all lines at the same Y.
 */
function row(doc: PdfKitDoc, label: string, value: string): void {
    const left = PDF_MARGIN_X;
    const top = doc.y;
    const pageW = doc.page.width;
    const valueX = left + PDF_ROW_LABEL_W + PDF_LABEL_VALUE_GAP;
    const valueWidth = Math.max(130, pageW - PDF_PAGE_MARGIN - valueX);

    doc.font('Helvetica').fontSize(10).fillColor(PDF_ROW_LABEL);
    doc.text(label, left, top, {
        width: PDF_ROW_LABEL_W,
        lineGap: 3,
    });
    const afterLabelY = doc.y;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_ROW_VALUE);
    doc.text(value, valueX, top, {
        width: valueWidth,
        align: 'right',
        lineGap: 3,
    });
    const afterValueY = doc.y;

    doc.y = Math.max(afterLabelY, afterValueY) + PDF_ROW_GAP;
}

function sectionSpacer(doc: PdfKitDoc): void {
    doc.y += PDF_SECTION_GAP;
}

export async function buildDashboardExportPdfBuffer(payload: DashboardPdfPayload): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: PDF_PAGE_MARGIN,
            info: {
                Title: `${payload.brandName} Dashboard Export`,
                Author: payload.brandName,
                Subject: 'Dashboard Export',
            },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.rect(0, 0, doc.page.width, 90).fill(PDF_HEADER_BG);
        doc.fillColor(PDF_PRIMARY_TEXT).font('Helvetica-Bold').fontSize(20).text(`${payload.brandName} Dashboard Export`, 48, 32);
        doc.fillColor(PDF_MUTED_TEXT).font('Helvetica').fontSize(10).text(`Generated ${new Date().toISOString().slice(0, 19)} UTC`, 48, 60);

        // Continue body below the header band (avoid overlap with fixed header coordinates)
        doc.x = PDF_MARGIN_X;
        doc.y = 102;

        doc.fillColor(PDF_BODY_HEADING).font('Helvetica-Bold').fontSize(13).text('Export Details', { underline: false });
        doc.moveDown(0.35);
        row(doc, 'Account', payload.accountName);
        row(doc, 'Shop', payload.shopName);
        row(doc, 'Period', payload.periodLabel);
        row(doc, 'Included reports', payload.reportTypes.join(', ').toUpperCase());

        if (payload.orderSummary && payload.reportTypes.includes('order')) {
            sectionSpacer(doc);
            doc.fillColor(PDF_BODY_HEADING).font('Helvetica-Bold').fontSize(13).text('Order-based Summary');
            doc.moveDown(0.35);
            row(doc, 'Orders (excl. sample)', String(payload.orderSummary.orderCount));
            row(doc, 'GMV', currency(payload.orderSummary.gmv));
        }

        if (payload.plSummary && payload.reportTypes.includes('pl')) {
            sectionSpacer(doc);
            doc.fillColor(PDF_BODY_HEADING).font('Helvetica-Bold').fontSize(13).text('P&L Summary');
            doc.moveDown(0.35);
            row(doc, 'GMV', currency(payload.plSummary.gmv));
            row(doc, 'Total orders', String(payload.plSummary.totalOrders));
            row(doc, 'Total revenue', currency(payload.plSummary.totalRevenue));
            row(doc, 'TikTok settlement net sales (reference)', currency(payload.plSummary.netSales));
            row(doc, 'Gross profit', currency(payload.plSummary.grossProfit));
            row(doc, 'Net profit', currency(payload.plSummary.netProfit));
            if (typeof payload.plSummary.adSpend === 'number') {
                row(doc, 'Ad spend', currency(payload.plSummary.adSpend));
            }
        }

        if (payload.notes && payload.notes.length > 0) {
            doc.moveDown(0.75);
            doc.fillColor(PDF_BODY_HEADING).font('Helvetica-Bold').fontSize(13).text('Notes');
            doc.moveDown(0.35);
            for (const note of payload.notes) {
                doc.font('Helvetica').fontSize(10).fillColor(PDF_NOTE).text(`• ${note}`, {
                    paragraphGap: 6,
                    lineGap: 2,
                });
            }
        }

        doc.moveDown(1);
        doc.font('Helvetica').fontSize(9).fillColor(PDF_FOOTNOTE);
        doc.text('This export is generated from Mamba dashboard data and current financial visibility policies.', PDF_MARGIN_X, doc.y, {
            width: doc.page.width - PDF_PAGE_MARGIN - PDF_MARGIN_X,
            align: 'left',
            lineGap: 2,
        });

        doc.end();
    });
}
