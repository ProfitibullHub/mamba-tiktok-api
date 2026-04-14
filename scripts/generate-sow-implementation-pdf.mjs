#!/usr/bin/env node
/**
 * Generates client-facing PDF: SOW §3.1–3.2 implementation summary.
 * Run from repo root: node scripts/generate-sow-implementation-pdf.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'client-deliverables');
const OUT_FILE = join(OUT_DIR, 'Mamba_SOW_3.1-3.2_Implementation_Summary.pdf');

const doc = new jsPDF({ unit: 'pt', format: 'letter' });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const M = 48;
let cursorY = 0;

function newPage() {
  doc.addPage();
  cursorY = M;
}

function ensureSpace(needed) {
  if (cursorY + needed > pageH - M) newPage();
}

function heading(text, size = 14) {
  ensureSpace(size + 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(30, 30, 30);
  doc.text(text, M, cursorY);
  cursorY += size + 10;
}

function body(text, size = 10) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  doc.setTextColor(45, 45, 45);
  const lines = doc.splitTextToSize(text, pageW - 2 * M);
  for (const line of lines) {
    ensureSpace(14);
    doc.text(line, M, cursorY);
    cursorY += 13;
  }
  cursorY += 6;
}

function bullet(text, size = 9) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  doc.setTextColor(45, 45, 45);
  const prefix = '• ';
  const lines = doc.splitTextToSize(prefix + text, pageW - 2 * M - 12);
  let first = true;
  for (const line of lines) {
    ensureSpace(13);
    doc.text(first ? line : line.replace(/^\s*/, '  '), M + (first ? 0 : 0), cursorY);
    cursorY += 12;
    first = false;
  }
  cursorY += 2;
}

// --- Page 1: Title ---
cursorY = M + 20;
doc.setFont('helvetica', 'bold');
doc.setFontSize(20);
doc.setTextColor(20, 20, 20);
doc.text('Mamba Platform', M, cursorY);
cursorY += 28;
doc.setFontSize(16);
doc.text('Statement of Work — Implementation Summary', M, cursorY);
cursorY += 22;
doc.setFont('helvetica', 'normal');
doc.setFontSize(11);
doc.setTextColor(80, 80, 80);
doc.text('Sections 3.1 (Multi-Tenant Architecture) & 3.2 (Role-Based Access Control)', M, cursorY);
cursorY += 36;

doc.setFontSize(9);
doc.text(`Prepared for: Client review`, M, cursorY);
cursorY += 14;
doc.text(`Vendor delivery snapshot date: March 30, 2026`, M, cursorY);
cursorY += 14;
doc.text(
  'This document maps contractual requirements to the current Mamba codebase and infrastructure.',
  M,
  cursorY
);
cursorY += 28;

heading('Executive summary', 12);
body(
  'Mamba implements tenant boundaries in PostgreSQL (Supabase) with Row Level Security (RLS), SECURITY DEFINER visibility helpers, and authenticated RPCs. The Node API enforces account-scoped access for TikTok Shop operations. RBAC uses a centralized permissions catalog, system roles, tenant-scoped custom roles, and server-side enforcement so custom roles cannot exceed the creator’s effective permissions. Some SOW items depend on product modules (e.g. unified messaging, task workflows) or referenced sections (e.g. §3.13 financial restrictions); those are called out explicitly below.'
);

heading('Recommended production tiers', 12);
body(
  'For full operational fit with the implemented features (scheduled jobs, database scale, and support expectations), we recommend upgrading to:'
);
bullet('Vercel Pro (or higher): Hobby enforces once-per-day cron only; Pro allows more frequent scheduled functions and higher limits for dashboard digest emails, sync jobs, and predictable throughput.');
bullet(
  'Supabase Pro (or higher): Higher database resources, connection limits, and platform SLAs appropriate for multi-tenant production workloads and RLS-heavy query patterns.'
);
body(
  'Exact SKU and pricing should be confirmed on vercel.com and supabase.com at contract time. This is a planning recommendation, not a binding quote.'
);

heading('3.1 Multi-Tenant Architecture', 13);

autoTable(doc, {
  startY: cursorY,
  margin: { left: M, right: M },
  head: [['Requirement', 'Status', 'Implementation notes']],
  body: [
    [
      'Self-managed Seller accounts',
      'Implemented',
      'Seller tenants on `tenants` (type seller); accounts tied to seller `tenant_id`.',
    ],
    [
      'Agency accounts managing multiple Sellers',
      'Implemented',
      'Agency tenants; sellers linked via `parent_tenant_id`; Agency Admin RPCs and UI.',
    ],
    [
      'Hierarchical Agency → Seller relationships',
      'Implemented',
      'Enforced in schema and visibility helpers (`tenant_is_visible_to_user`, etc.).',
    ],
    [
      'Strict data isolation',
      'Implemented',
      'RLS on tenants, accounts, shops, orders; permissive policy leaks removed in migrations.',
    ],
    [
      'Sellers: only own tenant data',
      'Implemented',
      'Membership + RLS; API uses `check_user_account_access` / visibility RPCs.',
    ],
    [
      'Agencies: only linked Sellers',
      'Implemented',
      'Agency Admin path in visibility over child sellers under same agency.',
    ],
    [
      'AM / AC: only assigned Sellers',
      'Implemented',
      '`user_seller_assignments` + same visibility helpers; UI rules for team management.',
    ],
    [
      'Enforcement at API and database',
      'Implemented',
      'Postgres RLS + SECURITY DEFINER RPCs; Express middleware for account-scoped routes.',
    ],
  ],
  styles: { fontSize: 8, cellPadding: 4 },
  headStyles: { fillColor: [180, 40, 90], textColor: 255 },
  columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 72 }, 2: { cellWidth: 'auto' } },
});

cursorY = doc.lastAutoTable.finalY + 20;

heading('3.2 Role-Based Access Control (RBAC)', 13);
body(
  'Architecture: permissions table, `role_permissions`, system roles (`tenant_id` null), custom roles per tenant, `tenant_memberships`, optional `user_seller_assignments` for AM/AC. Enforcement via RPCs (e.g. invitations, member management, custom role create/update with permission ceiling) and RLS. Super Admin / legacy internal operator paths are scoped for platform use.'
);

autoTable(doc, {
  startY: cursorY,
  margin: { left: M, right: M },
  head: [['SOW element', 'Status', 'Notes']],
  body: [
    ['System roles (Seller Admin/User, AA, AM, AC, Super Admin)', 'Implemented', 'Seeded; grants via `role_permissions`.'],
    ['System role grants not tenant-editable', 'Implemented', 'Mutations via controlled RPCs / service role; catalog read for authenticated users.'],
    ['Seller Admin capabilities (users, billing, COGS, TikTok, financials)', 'Implemented', 'Permission actions + RLS/write checks; Seller User read-only writes blocked.'],
    ['Seller User view-only', 'Implemented', '`check_user_account_write_access` + aligned RLS for shop writes.'],
    ['Agency Admin: users, link sellers, assign AM, subscription, custom roles, visibility', 'Implemented', 'RPCs + UI; agency tenant PATCH for status/name; link/invite flows.'],
    ['AM: assigned sellers only; invite/manage AC; custom roles within own permissions', 'Implemented', 'SQL ceiling on custom roles; AM-only coordinator management rules.'],
    ['AM: cannot change agency subscription / create-remove sellers / manage AA or other AMs', 'Implemented', 'No billing.manage on AM role; RPC guards on staff/member mutations.'],
    ['AC: assigned scope; no subscription or agency-level admin', 'Implemented', 'Role grants + read-only team/roles UI where implemented.'],
    ['Custom roles tenant-scoped; cannot exceed creator', 'Implemented', '`get_my_custom_role_permission_ceiling`, `create_custom_role` / `update_custom_role`.'],
    ['Central permission logic; avoid ad-hoc hardcoding', 'Implemented', 'Action strings in DB; some UI still uses role names for UX—authoritative checks are DB/RPC.'],
    ['Export dashboards & email (manual / automated)', 'Implemented', 'API `/api/reports/email-dashboard` (order + optional P&L snapshot); daily digest + Resend; Vercel cron (daily on Hobby).'],
    ['Unified messaging', 'Partial', '`messages.send` in catalog; product messaging UX not covered in this summary.'],
    ['Tasks (AM/AC)', 'Partial', '`tasks.manage` permission seeded; dedicated task product scope to confirm with client.'],
    ['§3.13 Financial restrictions (cross-reference)', 'See §3.13', '`financials.restricted` vs `financials.view`; fee/settlement RLS—full §3.13 matrix separate doc if required.'],
  ],
  styles: { fontSize: 7.5, cellPadding: 3 },
  headStyles: { fillColor: [180, 40, 90], textColor: 255 },
  columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 65 }, 2: { cellWidth: 'auto' } },
});

cursorY = doc.lastAutoTable.finalY + 16;
if (cursorY > pageH - M - 80) newPage();

heading('References (technical)', 11);
body(
  'Key areas: `supabase/migrations/*` (tenants, RLS, RBAC, custom role ceiling, team RPCs), `server/src/middleware/account-access.middleware.ts`, `server/src/routes/reports.routes.ts`, `server/src/routes/team.routes.ts`, `src/components/views/RoleManagementView.tsx`, `AgencyConsoleView.tsx`, `OverviewView.tsx`.'
);

heading('Disclaimer', 11);
body(
  'This summary is accurate to the best of our knowledge for the codebase snapshot dated above. It does not replace legal review of the full SOW or warranty language. Client acceptance should include validation in a staging environment against their own test users and tenants.'
);

mkdirSync(OUT_DIR, { recursive: true });
const buf = doc.output('arraybuffer');
writeFileSync(OUT_FILE, Buffer.from(buf));

console.log('Wrote PDF:', OUT_FILE);
