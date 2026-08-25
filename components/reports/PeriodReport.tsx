import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatCurrency } from '@/lib/currency';

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1e293b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32, borderBottomWidth: 2, borderBottomColor: '#3730A3', paddingBottom: 16 },
  title: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: '#3730A3' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 4 },
  orgName: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#3730A3', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingBottom: 4 },
  table: { width: '100%' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f1f5f9', padding: '6 8', marginBottom: 1 },
  tableRow: { flexDirection: 'row', padding: '5 8', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  col1: { flex: 3 },
  col2: { flex: 1, textAlign: 'right' },
  col3: { flex: 1, textAlign: 'right' },
  col4: { flex: 1.5, textAlign: 'right' },
  headerText: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#64748b', textTransform: 'uppercase' },
  totalRow: { flexDirection: 'row', padding: '8 8', backgroundColor: '#f8fafc', borderTopWidth: 2, borderTopColor: '#3730A3', marginTop: 4 },
  totalLabel: { flex: 5, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  totalValue: { flex: 1.5, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#3730A3' },
  footer: { position: 'absolute', bottom: 32, left: 48, right: 48, textAlign: 'center', color: '#94a3b8', fontSize: 9, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 },
  metaBox: { flexDirection: 'row', gap: 16, marginBottom: 24 },
  metaItem: { flex: 1, backgroundColor: '#f8fafc', padding: 12, borderRadius: 4 },
  metaLabel: { fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  metaValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1e293b' },
});

interface Entry {
  id: string;
  description: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  isBillable: boolean;
  user: { name: string };
  project: { name: string; hourlyRate: any } | null;
}

interface ProjectSummary {
  projectName: string;
  currency: string;
  hours: number;
  rate: number;
  subtotal: number;
}

interface PeriodReportProps {
  orgName: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  entries: Entry[];
  projectSummaries: ProjectSummary[];
  totalSeconds: number;
  currencyTotals: { currency: string; amount: number }[];
}

export function PeriodReport({
  orgName, periodStart, periodEnd, status, entries, projectSummaries, totalSeconds, currencyTotals,
}: PeriodReportProps) {
  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const formatHours = (s: number) => (s / 3600).toFixed(2);
  const formatDur = (s: number | null) => {
    if (!s) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
  };

  const totalAmountText = currencyTotals
    .filter((t) => t.amount > 0)
    .map((t) => formatCurrency(t.amount, t.currency))
    .join(' · ') || formatCurrency(0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>ORA</Text>
            <Text style={styles.subtitle}>Time Report</Text>
            <Text style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>
              {formatDate(periodStart)} — {formatDate(periodEnd)}
            </Text>
          </View>
          <View>
            <Text style={styles.orgName}>{orgName}</Text>
            <Text style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, textAlign: 'right' }}>Status: {status}</Text>
          </View>
        </View>

        {/* Meta boxes */}
        <View style={styles.metaBox}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Total Hours</Text>
            <Text style={styles.metaValue}>{formatHours(totalSeconds)}h</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Total Entries</Text>
            <Text style={styles.metaValue}>{entries.length}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Billable Amount</Text>
            <Text style={[styles.metaValue, { color: '#3730A3', fontSize: currencyTotals.length > 1 ? 10 : 14 }]}>
              {totalAmountText}
            </Text>
          </View>
        </View>

        {/* Summary by project */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary by Project</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.col1, styles.headerText]}>Project</Text>
              <Text style={[styles.col2, styles.headerText]}>Hours</Text>
              <Text style={[styles.col3, styles.headerText]}>Rate</Text>
              <Text style={[styles.col4, styles.headerText]}>Subtotal</Text>
            </View>
            {projectSummaries.map((p, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.col1}>{p.projectName}</Text>
                <Text style={styles.col2}>{p.hours.toFixed(2)}h</Text>
                <Text style={styles.col3}>{formatCurrency(p.rate, p.currency)}/hr</Text>
                <Text style={styles.col4}>{formatCurrency(p.subtotal, p.currency)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={[styles.totalValue, { fontSize: currencyTotals.length > 1 ? 9 : 11 }]}>
                {totalAmountText}
              </Text>
            </View>
          </View>
        </View>

        {/* Detailed entries */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detailed Time Entries</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[{ flex: 2 }, styles.headerText]}>Date</Text>
              <Text style={[{ flex: 2 }, styles.headerText]}>User</Text>
              <Text style={[{ flex: 3 }, styles.headerText]}>Description</Text>
              <Text style={[{ flex: 2 }, styles.headerText]}>Project</Text>
              <Text style={[{ flex: 1.5, textAlign: 'right' }, styles.headerText]}>Duration</Text>
            </View>
            {entries.map((e, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 0 ? { backgroundColor: '#fafafa' } : {}]}>
                <Text style={{ flex: 2 }}>{new Date(e.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                <Text style={{ flex: 2 }}>{e.user.name}</Text>
                <Text style={{ flex: 3 }}>{e.description || '—'}</Text>
                <Text style={{ flex: 2 }}>{e.project?.name || 'No project'}</Text>
                <Text style={{ flex: 1.5, textAlign: 'right' }}>{formatDur(e.durationSeconds)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Generated by ORA — Time, tracked. Invoices, done. | {new Date().toLocaleDateString()}
        </Text>
      </Page>
    </Document>
  );
}
