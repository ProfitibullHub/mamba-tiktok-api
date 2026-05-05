import PDFDocument from 'pdfkit';

type ReportType = 'order' | 'pl';

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

function currency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

function row(doc: any, label: string, value: string, x = 56): void {
    doc.font('Helvetica').fontSize(10).fillColor('#475569').text(label, x, doc.y, { continued: true, width: 280 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(value, x + 290, doc.y - 12, { align: 'right', width: 220 });
    doc.moveDown(0.2);
}

export async function buildDashboardExportPdfBuffer(payload: DashboardPdfPayload): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: 48,
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

        doc.rect(0, 0, doc.page.width, 90).fill('#0f172a');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(`${payload.brandName} Dashboard Export`, 48, 32);
        doc.fillColor('#cbd5e1').font('Helvetica').fontSize(10).text(`Generated ${new Date().toISOString().slice(0, 19)} UTC`, 48, 60);

        doc.moveDown(4);
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Export Details');
        doc.moveDown(0.4);
        row(doc, 'Account', payload.accountName);
        row(doc, 'Shop', payload.shopName);
        row(doc, 'Period', payload.periodLabel);
        row(doc, 'Included reports', payload.reportTypes.join(', ').toUpperCase());

        if (payload.orderSummary && payload.reportTypes.includes('order')) {
            doc.moveDown(1);
            doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Order-based Summary');
            doc.moveDown(0.4);
            row(doc, 'Paid orders (excl. cancelled/sample)', String(payload.orderSummary.orderCount));
            row(doc, 'GMV', currency(payload.orderSummary.gmv));
        }

        if (payload.plSummary && payload.reportTypes.includes('pl')) {
            doc.moveDown(1);
            doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('P&L Summary');
            doc.moveDown(0.4);
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
            doc.moveDown(1);
            doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Notes');
            doc.moveDown(0.3);
            for (const note of payload.notes) {
                doc.font('Helvetica').fontSize(10).fillColor('#334155').text(`• ${note}`);
            }
        }

        doc.moveDown(2);
        doc.font('Helvetica').fontSize(9).fillColor('#64748b')
            .text('This export is generated from Mamba dashboard data and current financial visibility policies.', {
                align: 'left',
            });

        doc.end();
    });
}
