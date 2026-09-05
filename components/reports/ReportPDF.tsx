import {
  Document, Page, Text, View, Svg, Rect, Path, Circle, G, Line, StyleSheet,
} from '@react-pdf/renderer';
import {
  apportionPercents,
  amountMinor,
  formatGroupedAmounts,
  formatMinor,
  groupCurrencyTotals,
  rateToHundredths,
} from '@/lib/currency';
import { eachDayOfInterval, format, parseISO } from 'date-fns';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PDFEntry {
  durationSeconds: number | null;
  isBillable: boolean;
  description: string | null;
  project: {
    hourlyRate: unknown;
    client: { id: string; name: string; currency: string } | null;
  } | null;
}

interface PDFByDay {
  date: string;
  seconds: number;
}

export interface ReportPDFProps {
  orgName: string;
  dateRange: { start: string; end: string };
  entries: PDFEntry[];
  byDay: PDFByDay[];
  totals: { totalSeconds: number; billableSeconds: number; activeDays: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHMS(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function fmtHM(sec: number): string {
  const totalMinutes = Math.round(sec / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ─── Donut arc math ───────────────────────────────────────────────────────────

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutArc(cx: number, cy: number, R: number, ri: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  // Full circle — split into two arcs to avoid degenerate SVG path
  if (sweep >= 359.99) {
    const mid = a0 + 180;
    const [p1, p2] = [polarToXY(cx, cy, R, a0), polarToXY(cx, cy, R, mid)];
    const [q1, q2] = [polarToXY(cx, cy, ri, a0), polarToXY(cx, cy, ri, mid)];
    return [
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${R} ${R} 0 1 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `A ${R} ${R} 0 1 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `M ${q2.x.toFixed(2)} ${q2.y.toFixed(2)}`,
      `A ${ri} ${ri} 0 1 0 ${q1.x.toFixed(2)} ${q1.y.toFixed(2)}`,
      `A ${ri} ${ri} 0 1 0 ${q2.x.toFixed(2)} ${q2.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  }
  const large = sweep > 180 ? 1 : 0;
  const o1 = polarToXY(cx, cy, R, a0);
  const o2 = polarToXY(cx, cy, R, a1);
  const i1 = polarToXY(cx, cy, ri, a1);
  const i2 = polarToXY(cx, cy, ri, a0);
  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${R} ${R} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${ri} ${ri} 0 ${large} 0 ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCENT = '#3730A3';
const BORDER = '#E2E8F0';
const TEXT = '#1E293B';
const MUTED = '#64748B';
const BG_LIGHT = '#F8FAFC';
const ACCENT_LIGHT = '#EEF2FF';

const DONUT_COLORS = ['#3730A3', '#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6B7280'];

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page:         { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: TEXT, backgroundColor: '#FFFFFF' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, paddingBottom: 14, borderBottomWidth: 2, borderBottomColor: ACCENT },
  title:        { fontSize: 20, fontFamily: 'Helvetica-Bold', color: ACCENT },
  dateRange:    { fontSize: 10, color: MUTED, marginTop: 3 },
  orgRight:     { fontSize: 11, fontFamily: 'Helvetica-Bold', color: TEXT, textAlign: 'right' },
  // Summary band
  summaryRow:   { flexDirection: 'row', gap: 8, marginBottom: 24 },
  statBox:      { flex: 1, backgroundColor: BG_LIGHT, borderRadius: 4, padding: 10, borderWidth: 1, borderColor: BORDER },
  statLabel:    { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', marginBottom: 3 },
  statValue:    { fontSize: 13, fontFamily: 'Helvetica-Bold', color: TEXT },
  statSub:      { fontSize: 7, color: MUTED, marginTop: 2 },
  // Sections
  section:      { marginBottom: 20 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: ACCENT, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 8 },
  empty:        { fontSize: 9, color: MUTED },
  // Donut layout
  donutSection: { flexDirection: 'row', alignItems: 'flex-start' },
  donutLegend:  { flex: 1, paddingLeft: 20, paddingTop: 6 },
  legendRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  legendSwatch: { width: 8, height: 8, borderRadius: 1, marginRight: 6, flexShrink: 0 },
  legendName:   { flex: 1, fontSize: 8, color: TEXT },
  legendMeta:   { fontSize: 8, color: MUTED },
  // Table
  tableHead:    { flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, marginBottom: 1 },
  tableRow:     { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  clientRow:    { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 8, backgroundColor: ACCENT_LIGHT, marginTop: 4 },
  totalRow:     { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, backgroundColor: BG_LIGHT, borderTopWidth: 2, borderTopColor: ACCENT, marginTop: 4 },
  thText:       { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase' },
  colDesc:      { flex: 4 },
  colDur:       { flex: 2, textAlign: 'right' },
  colPct:       { flex: 1.5, textAlign: 'right' },
  colRev:       { flex: 2.5, textAlign: 'right' },
  // Footer
  footer:       { position: 'absolute', bottom: 28, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 6 },
  footerText:   { fontSize: 8, color: MUTED },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function ReportPDF({ orgName, dateRange, entries, byDay, totals }: ReportPDFProps) {
  const { totalSeconds, billableSeconds, activeDays } = totals;

  // ── Summary metrics ────────────────────────────────────────────────────────
  const billablePct = totalSeconds > 0 ? ((billableSeconds / totalSeconds) * 100).toFixed(1) : '0.0';
  const avgDailyHours = activeDays > 0 ? (totalSeconds / 3600 / activeDays).toFixed(2) : '0.00';

  // ── Date range label ───────────────────────────────────────────────────────
  let dateLabel = '';
  try {
    if (dateRange.start && dateRange.end) {
      dateLabel = `${format(parseISO(dateRange.start), 'MMM d, yyyy')} – ${format(parseISO(dateRange.end), 'MMM d, yyyy')}`;
    }
  } catch { /* invalid range */ }

  // ── Bar chart: fill every calendar day ────────────────────────────────────
  const daySecMap = new Map<string, number>(byDay.map((d) => [d.date, d.seconds]));
  const calDays: { label: string; seconds: number }[] = [];
  try {
    if (dateRange.start && dateRange.end) {
      for (const d of eachDayOfInterval({ start: parseISO(dateRange.start), end: parseISO(dateRange.end) })) {
        const key = format(d, 'yyyy-MM-dd');
        calDays.push({ label: format(d, 'MMM d'), seconds: daySecMap.get(key) ?? 0 });
      }
    }
  } catch { /* leave calDays empty */ }

  const numBars = calDays.length;
  // Guard against divide-by-zero on maxSeconds
  const maxBarSec = Math.max(...calDays.map((d) => d.seconds), 1);

  // Chart SVG dimensions
  const CHART_W = 499;
  const BAR_AREA_H = 100;  // height of the bar drawing area
  const AXIS_H = 18;
  const SVG_H = BAR_AREA_H + AXIS_H;

  const barPad = numBars > 1 ? 1 : 0;
  const barW = numBars > 0 ? CHART_W / numBars : CHART_W;

  // Bar labels: H:MM:SS for ≤14 days (wider bars), H:MM for 15-31 days, none beyond
  const showBarLabels = numBars > 0 && numBars <= 31;
  const barLabelFmt = numBars <= 14 ? fmtHMS : fmtHM;
  const barLabelSize = numBars <= 14 ? 5.5 : 5;

  // X-axis labels: step to avoid overlap
  const xStep = numBars <= 7 ? 1 : numBars <= 14 ? 1 : numBars <= 31 ? 3 : numBars <= 90 ? 7 : 30;

  // ── Description donut ──────────────────────────────────────────────────────
  const descMap = new Map<string, number>();
  for (const e of entries) {
    const key = e.description?.trim() || '(No description)';
    descMap.set(key, (descMap.get(key) ?? 0) + (e.durationSeconds ?? 0));
  }
  const sortedDescs = [...descMap.entries()].sort((a, b) => b[1] - a[1]);
  const topDescs = sortedDescs.slice(0, 7);
  const otherSec = sortedDescs.slice(7).reduce((s, [, v]) => s + v, 0);
  if (otherSec > 0) topDescs.push(['Other', otherSec]);
  const donutTotal = topDescs.reduce((s, [, v]) => s + v, 0);

  const DONUT_CX = 80, DONUT_CY = 80, DONUT_R = 62, DONUT_HOLE = 37;
  const slices: { d: string; color: string; label: string; seconds: number }[] = [];
  let angle = 0;
  for (let i = 0; i < topDescs.length; i++) {
    const [label, sec] = topDescs[i];
    const sweep = donutTotal > 0 ? (sec / donutTotal) * 360 : 0;
    slices.push({
      d: donutArc(DONUT_CX, DONUT_CY, DONUT_R, DONUT_HOLE, angle, angle + sweep),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      label,
      seconds: sec,
    });
    angle += sweep;
  }

  // ── Client → description breakdown ────────────────────────────────────────
  // Money: rounded once per time entry into integer minor units; description
  // rows, client rows and the TOTAL row are integer sums of the same leaves, so
  // the table foots at every level and matches the REVENUE card exactly.
  type DescAgg = { seconds: number; revenueMinor: number };
  type ClientAgg = { name: string; currency: string; totalSec: number; descs: Map<string, DescAgg> };
  const clientMap = new Map<string, ClientAgg>();

  for (const e of entries) {
    const cid = e.project?.client?.id ?? '__none__';
    const cName = e.project?.client?.name ?? '(No Client)';
    const cur = e.project?.client?.currency ?? 'USD';
    const desc = e.description?.trim() || '(No description)';
    const secs = e.durationSeconds ?? 0;
    const rateHundredths = e.project ? rateToHundredths(e.project.hourlyRate) : 0;
    const revMinor = e.isBillable ? amountMinor(secs, rateHundredths, cur) : 0;

    if (!clientMap.has(cid)) {
      clientMap.set(cid, { name: cName, currency: cur, totalSec: 0, descs: new Map() });
    }
    const c = clientMap.get(cid)!;
    c.totalSec += secs;
    const d = c.descs.get(desc) ?? { seconds: 0, revenueMinor: 0 };
    d.seconds += secs;
    d.revenueMinor += revMinor;
    c.descs.set(desc, d);
  }

  // Percentages: largest-remainder apportionment over the description leaves
  // (which partition the report total), then summed upward — so the column adds
  // up to exactly 100.0 and each client row equals the sum of its rows.
  const clientRows = [...clientMap.values()]
    .sort((a, b) => b.totalSec - a.totalSec)
    .map((c) => ({
      ...c,
      revenueMinor: [...c.descs.values()].reduce((s, d) => s + d.revenueMinor, 0),
      descList: [...c.descs.entries()]
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .map(([desc, agg]) => ({ desc, ...agg, pct: 0 })),
      pct: 0,
    }));

  {
    const leaves = clientRows.flatMap((c) => c.descList);
    const leafPcts = apportionPercents(leaves.map((l) => l.seconds), totalSeconds);
    leaves.forEach((l, i) => { l.pct = leafPcts[i]; });
    for (const c of clientRows) {
      c.pct = Math.round(c.descList.reduce((s, d) => s + d.pct * 10, 0)) / 10;
    }
  }
  const totalPct = Math.round(clientRows.reduce((s, c) => s + c.pct * 10, 0)) / 10;

  // Revenue card and TOTAL row come from the same integer sums as the table
  // rows, grouped per currency — never added across currencies.
  const revenueStr = formatGroupedAmounts(
    groupCurrencyTotals(
      clientRows.map((c) => ({ clientCurrency: c.currency, billableAmountMinor: c.revenueMinor })),
    ),
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Summary Report</Text>
            {dateLabel ? <Text style={styles.dateRange}>{dateLabel}</Text> : null}
          </View>
          <Text style={styles.orgRight}>{orgName}</Text>
        </View>

        {/* Summary band */}
        <View style={styles.summaryRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Hours</Text>
            <Text style={styles.statValue}>{fmtHMS(totalSeconds)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Billable Hours</Text>
            <Text style={styles.statValue}>{fmtHMS(billableSeconds)}</Text>
            <Text style={styles.statSub}>{billablePct}% of total</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Revenue</Text>
            <Text style={styles.statValue}>{revenueStr || '—'}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Avg Daily Hours</Text>
            <Text style={styles.statValue}>{avgDailyHours}</Text>
          </View>
        </View>

        {/* Daily Activity bar chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Activity</Text>
          {numBars === 0 ? (
            <Text style={styles.empty}>No data for selected range.</Text>
          ) : (
            <Svg width={CHART_W} height={SVG_H}>
              {/* Baseline */}
              <Line
                x1={0} y1={BAR_AREA_H}
                x2={CHART_W} y2={BAR_AREA_H}
                strokeWidth={0.5}
                stroke={BORDER}
              />
              {calDays.map((day, i) => {
                const barH = day.seconds > 0
                  ? Math.max(2, (day.seconds / maxBarSec) * (BAR_AREA_H - 10))
                  : 0;
                const x = i * barW + barPad;
                const w = Math.max(1, barW - barPad * 2);
                const y = BAR_AREA_H - barH;
                return (
                  <G key={i}>
                    {barH > 0 && <Rect x={x} y={y} width={w} height={barH} fill={ACCENT} />}
                    {showBarLabels && day.seconds > 0 && (
                      <Text
                        x={x + w / 2}
                        y={y - 1.5}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        style={{ fontSize: barLabelSize, fill: TEXT, textAnchor: 'middle' } as any}
                      >
                        {barLabelFmt(day.seconds)}
                      </Text>
                    )}
                    {i % xStep === 0 && (
                      <Text
                        x={x + w / 2}
                        y={BAR_AREA_H + 11}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        style={{ fontSize: 6, fill: MUTED, textAnchor: 'middle' } as any}
                      >
                        {day.label}
                      </Text>
                    )}
                  </G>
                );
              })}
            </Svg>
          )}
        </View>

        {/* Description donut */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description Breakdown</Text>
          {donutTotal === 0 ? (
            <Text style={styles.empty}>No data for selected range.</Text>
          ) : (
            <View style={styles.donutSection}>
              <Svg width={160} height={160}>
                {slices.map((s, i) => (
                  <Path key={i} d={s.d} fill={s.color} />
                ))}
                <Circle cx={DONUT_CX} cy={DONUT_CY} r={DONUT_HOLE} fill="#FFFFFF" />
              </Svg>
              <View style={styles.donutLegend}>
                {slices.map((s, i) => (
                  <View key={i} style={styles.legendRow}>
                    <View style={[styles.legendSwatch, { backgroundColor: s.color }]} />
                    <Text style={styles.legendName}>{s.label}</Text>
                    <Text style={styles.legendMeta}>
                      {donutTotal > 0 ? `${((s.seconds / donutTotal) * 100).toFixed(1)}%` : '0.0%'}
                      {'  '}{fmtHMS(s.seconds)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Breakdown table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Breakdown by Client</Text>
          {clientRows.length === 0 ? (
            <Text style={styles.empty}>No data for selected range.</Text>
          ) : (
            <View>
              <View style={styles.tableHead}>
                <Text style={[styles.thText, styles.colDesc]}>Description</Text>
                <Text style={[styles.thText, styles.colDur]}>Duration</Text>
                <Text style={[styles.thText, styles.colPct]}>%</Text>
                <Text style={[styles.thText, styles.colRev]}>Revenue</Text>
              </View>

              {clientRows.map((client, ci) => (
                <View key={ci}>
                  <View style={styles.clientRow}>
                    <Text style={[styles.colDesc, { fontFamily: 'Helvetica-Bold', fontSize: 9, color: ACCENT }]}>
                      {client.name}
                    </Text>
                    <Text style={[styles.colDur, { fontFamily: 'Helvetica-Bold', fontSize: 9, color: ACCENT }]}>
                      {fmtHMS(client.totalSec)}
                    </Text>
                    <Text style={[styles.colPct, { fontFamily: 'Helvetica-Bold', fontSize: 9, color: ACCENT }]}>
                      {client.pct.toFixed(1)}%
                    </Text>
                    <Text style={[styles.colRev, { fontFamily: 'Helvetica-Bold', fontSize: 9, color: ACCENT }]}>
                      {client.revenueMinor > 0 ? formatMinor(client.revenueMinor, client.currency) : '—'}
                    </Text>
                  </View>
                  {client.descList.map((row, di) => (
                    <View key={di} style={styles.tableRow}>
                      <Text style={[styles.colDesc, { paddingLeft: 12 }]}>
                        {row.desc}
                      </Text>
                      <Text style={styles.colDur}>{fmtHMS(row.seconds)}</Text>
                      <Text style={styles.colPct}>{row.pct.toFixed(1)}%</Text>
                      <Text style={styles.colRev}>
                        {row.revenueMinor > 0 ? formatMinor(row.revenueMinor, client.currency) : '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}

              <View style={styles.totalRow}>
                <Text style={[styles.colDesc, { fontFamily: 'Helvetica-Bold' }]}>TOTAL</Text>
                <Text style={[styles.colDur, { fontFamily: 'Helvetica-Bold' }]}>{fmtHMS(totalSeconds)}</Text>
                <Text style={[styles.colPct, { fontFamily: 'Helvetica-Bold' }]}>{totalPct.toFixed(1)}%</Text>
                <Text style={[styles.colRev, { fontFamily: 'Helvetica-Bold', color: ACCENT }]}>
                  {revenueStr || '—'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Footer — fixed on every page */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{orgName}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>

      </Page>
    </Document>
  );
}
