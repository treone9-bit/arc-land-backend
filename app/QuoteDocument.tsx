import { Document, Page, View, Text, Image, Svg, Polygon, StyleSheet } from "@react-pdf/renderer";
import type { QuoteResult } from "../lib/quoteGeneration";

type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

function fmt(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a1a",
    paddingBottom: 40,
  },
  headerBar: {
    backgroundColor: "#1a2744",
    paddingVertical: 16,
    paddingHorizontal: 32,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#ffffff",
    letterSpacing: 2,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 24,
  },
  label: {
    fontSize: 8,
    color: "#888888",
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  clientName: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 2,
  },
  clientDetail: {
    fontSize: 9,
    color: "#444444",
    marginBottom: 1,
  },
  companyBlock: {
    alignItems: "flex-end",
  },
  logo: {
    width: 90,
    marginBottom: 4,
  },
  companyName: {
    fontSize: 10,
    fontWeight: 700,
  },
  companyDetail: {
    fontSize: 9,
    color: "#444444",
  },
  numRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    borderBottomStyle: "solid",
  },
  numVal: {
    fontSize: 9,
    fontWeight: 700,
  },
  scopeBar: {
    backgroundColor: "#1a2744",
    color: "#ffffff",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    paddingVertical: 6,
    paddingHorizontal: 24,
  },
  scopeText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    padding: 24,
    paddingBottom: 8,
  },
  table: {
    marginHorizontal: 24,
    marginBottom: 12,
  },
  tableHeaderWrap: {
    marginHorizontal: 24,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#eeeeee",
    borderBottomStyle: "solid",
    paddingVertical: 5,
  },
  trAlt: {
    backgroundColor: "#f8f9fb",
  },
  thDesc: {
    flex: 3,
    fontSize: 8,
    fontWeight: 700,
    color: "#666666",
  },
  thPart: {
    flex: 1.4,
    fontSize: 8,
    fontWeight: 700,
    color: "#666666",
  },
  th: {
    flex: 1,
    fontSize: 8,
    fontWeight: 700,
    color: "#666666",
    textAlign: "right",
  },
  tdDesc: {
    flex: 3,
    fontSize: 9,
  },
  tdPart: {
    flex: 1.4,
    fontSize: 8,
    color: "#666666",
  },
  td: {
    flex: 1,
    fontSize: 9,
    textAlign: "right",
  },
  tdAmt: {
    flex: 1,
    fontSize: 9,
    textAlign: "right",
    fontWeight: 700,
  },
  tableSubtotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTopWidth: 1.5,
    borderTopColor: "#1a2744",
    borderTopStyle: "solid",
    paddingTop: 5,
    marginTop: 2,
  },
  tableSubtotalLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: "#555555",
    marginRight: 16,
  },
  tableSubtotalAmt: {
    fontSize: 9,
    fontWeight: 700,
  },
  totalsBlock: {
    marginHorizontal: 24,
    marginBottom: 12,
    paddingTop: 8,
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 9.5,
    marginBottom: 4,
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 13,
    fontWeight: 700,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#1a2744",
    borderTopStyle: "solid",
  },
  list: {
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  listItem: {
    fontSize: 9,
    marginBottom: 3,
    lineHeight: 1.4,
  },
  thankYou: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    marginTop: 12,
  },
  terms: {
    fontSize: 7.5,
    color: "#777777",
    textAlign: "center",
    paddingHorizontal: 32,
    marginTop: 6,
    lineHeight: 1.4,
  },
  sigRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    marginTop: 30,
  },
  sigBlock: {
    width: "40%",
  },
  sigLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#999999",
    borderBottomStyle: "solid",
    marginBottom: 4,
    height: 24,
  },
  sigLabel: {
    fontSize: 8,
    color: "#777777",
  },
  treeBox: {
    marginHorizontal: 24,
    marginBottom: 12,
    padding: 12,
    backgroundColor: "#f0f4ff",
    borderRadius: 4,
  },
  treeGrid: {
    flexDirection: "row",
    marginBottom: 8,
  },
  treeStat: {
    flex: 1,
    alignItems: "center",
  },
  treeStatWide: {
    flex: 2,
    alignItems: "center",
  },
  treeStatNum: {
    fontSize: 13,
    fontWeight: 700,
  },
  treeStatNumSmall: {
    fontSize: 9,
    fontWeight: 700,
    textAlign: "center",
  },
  treeStatLabel: {
    fontSize: 7.5,
    color: "#666666",
  },
  treeDetail: {
    fontSize: 8.5,
    marginBottom: 3,
  },
  treeDisclaimer: {
    fontSize: 7,
    color: "#888888",
    marginTop: 4,
  },
  mapWrap: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    alignItems: "center",
  },
  mapContainer: {
    position: "relative",
    width: 300,
    height: 225,
  },
  mapImage: {
    width: 300,
    height: 225,
  },
  mapOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 300,
    height: 225,
  },
});

export type QuoteDocumentProps = {
  quote: QuoteResult;
  estNum: string;
  estDate: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  addressLine: string;
  countyLine: string;
  logoUrl: string;
  mapImageUrl?: string;
  mapBbox?: Bbox;
  parcelRings?: number[][][];
};

export default function QuoteDocument({
  quote,
  estNum,
  estDate,
  contactName,
  contactPhone,
  contactEmail,
  addressLine,
  countyLine,
  logoUrl,
  mapImageUrl,
  mapBbox,
  parcelRings,
}: QuoteDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerBar}>
          <Text style={styles.headerTitle}>ESTIMATE</Text>
        </View>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.label}>PREPARED FOR</Text>
            {contactName ? <Text style={styles.clientName}>{contactName}</Text> : null}
            {contactPhone ? <Text style={styles.clientDetail}>{contactPhone}</Text> : null}
            {contactEmail ? <Text style={styles.clientDetail}>{contactEmail}</Text> : null}
            {addressLine ? <Text style={styles.clientDetail}>{addressLine}</Text> : null}
            {countyLine ? <Text style={styles.clientDetail}>{countyLine}</Text> : null}
          </View>
          <View style={styles.companyBlock}>
            <Image src={logoUrl} style={styles.logo} />
            <Text style={styles.companyName}>ARC Land Development</Text>
            <Text style={styles.companyDetail}>(954) 471-1507</Text>
          </View>
        </View>

        <View style={styles.numRow}>
          <Text>
            <Text style={styles.label}>ESTIMATE # </Text>
            <Text style={styles.numVal}>{estNum}</Text>
          </Text>
          <Text>
            <Text style={styles.label}>ESTIMATE DATE </Text>
            <Text style={styles.numVal}>{estDate}</Text>
          </Text>
          <Text>
            <Text style={styles.label}>VALID FOR </Text>
            <Text style={styles.numVal}>30 Days</Text>
          </Text>
        </View>

        {mapImageUrl && mapBbox && (
          <View wrap={false}>
            <Text style={styles.scopeBar}>SITE MAP</Text>
            <View style={styles.mapWrap}>
              <View style={styles.mapContainer}>
                <Image src={mapImageUrl} style={styles.mapImage} />
                {parcelRings && (() => {
                  const { minLng, maxLng, minLat, maxLat } = mapBbox;
                  const toX = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 300;
                  const toY = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * 225;
                  return (
                    <Svg style={styles.mapOverlay} viewBox="0 0 300 225">
                      {parcelRings.map((ring, i) => (
                        <Polygon
                          key={i}
                          points={ring.map(([lng, lat]) => `${toX(lng)},${toY(lat)}`).join(" ")}
                          fill="#ffc800"
                          fillOpacity={0.12}
                          stroke="#ff6600"
                          strokeWidth={2}
                          strokeLinejoin="round"
                        />
                      ))}
                    </Svg>
                  );
                })()}
              </View>
            </View>
          </View>
        )}

        <Text style={styles.scopeBar}>SCOPE OF WORK</Text>
        <Text style={styles.scopeText}>{quote.summary}</Text>

        {quote.treeInventory && (
          <View wrap={false}>
            <Text style={styles.scopeBar}>TREE INVENTORY (AI AERIAL ANALYSIS)</Text>
            <View style={styles.treeBox}>
              <View style={styles.treeGrid}>
                <View style={styles.treeStat}>
                  <Text style={styles.treeStatNum}>{quote.treeInventory.estimatedCount}</Text>
                  <Text style={styles.treeStatLabel}>EST. TREES</Text>
                </View>
                <View style={styles.treeStat}>
                  <Text style={styles.treeStatNum}>{quote.treeInventory.density}</Text>
                  <Text style={styles.treeStatLabel}>DENSITY</Text>
                </View>
                <View style={styles.treeStatWide}>
                  <Text style={styles.treeStatNumSmall}>{quote.treeInventory.species.join(", ")}</Text>
                  <Text style={styles.treeStatLabel}>SPECIES IDENTIFIED</Text>
                </View>
              </View>
              <Text style={styles.treeDetail}>Size Distribution: {quote.treeInventory.sizeDistribution}</Text>
              {quote.treeInventory.notes ? (
                <Text style={styles.treeDetail}>Notes: {quote.treeInventory.notes}</Text>
              ) : null}
              <Text style={styles.treeDisclaimer}>
                Tree count estimated from satellite imagery. Field verification recommended before final contract.
              </Text>
            </View>
          </View>
        )}

        {quote.materialLineItems.length > 0 && (
          <>
            <View wrap={false}>
              <Text style={styles.scopeBar}>MATERIALS</Text>
              <View style={[styles.tableHeaderWrap, styles.tr]}>
                <Text style={styles.thDesc}>DESCRIPTION</Text>
                <Text style={styles.thPart}>PART #</Text>
                <Text style={styles.th}>UNIT</Text>
                <Text style={styles.th}>QTY</Text>
                <Text style={styles.th}>RATE</Text>
                <Text style={styles.th}>AMOUNT</Text>
              </View>
            </View>
            <View style={styles.table}>
              {quote.materialLineItems.map((item, i) => (
                <View style={i % 2 === 1 ? [styles.tr, styles.trAlt] : styles.tr} key={i} wrap={false}>
                  <Text style={styles.tdDesc}>{item.description}</Text>
                  <Text style={styles.tdPart}>{item.partNumber ?? "—"}</Text>
                  <Text style={styles.td}>{item.unit}</Text>
                  <Text style={styles.td}>{item.qty.toFixed(2)}</Text>
                  <Text style={styles.td}>{fmt(item.unitCost)}</Text>
                  <Text style={styles.tdAmt}>{fmt(item.total)}</Text>
                </View>
              ))}
              <View style={styles.tableSubtotalRow} wrap={false}>
                <Text style={styles.tableSubtotalLabel}>Materials Subtotal</Text>
                <Text style={styles.tableSubtotalAmt}>
                  {fmt(quote.materialLineItems.reduce((sum, item) => sum + item.total, 0))}
                </Text>
              </View>
            </View>
          </>
        )}

        {quote.laborLineItems.length > 0 && (
          <>
            <View wrap={false}>
              <Text style={styles.scopeBar}>LABOR</Text>
              <View style={[styles.tableHeaderWrap, styles.tr]}>
                <Text style={styles.thDesc}>DESCRIPTION</Text>
                <Text style={styles.th}>AMOUNT</Text>
              </View>
            </View>
            <View style={styles.table}>
              {quote.laborLineItems.map((item, i) => (
                <View style={i % 2 === 1 ? [styles.tr, styles.trAlt] : styles.tr} key={i} wrap={false}>
                  <Text style={styles.tdDesc}>{item.description}</Text>
                  <Text style={styles.tdAmt}>{fmt(item.total)}</Text>
                </View>
              ))}
              <View style={styles.tableSubtotalRow} wrap={false}>
                <Text style={styles.tableSubtotalLabel}>Labor Subtotal</Text>
                <Text style={styles.tableSubtotalAmt}>
                  {fmt(quote.laborLineItems.reduce((sum, item) => sum + item.total, 0))}
                </Text>
              </View>
            </View>
          </>
        )}

        <View style={styles.totalsBlock} wrap={false}>
          <View style={styles.totalLine}>
            <Text>Subtotal</Text>
            <Text>{fmt(quote.subtotal)}</Text>
          </View>
          {quote.mobilization > 0 && (
            <View style={styles.totalLine}>
              <Text>Mobilization</Text>
              <Text>{fmt(quote.mobilization)}</Text>
            </View>
          )}
          {quote.disposal > 0 && (
            <View style={styles.totalLine}>
              <Text>Disposal</Text>
              <Text>{fmt(quote.disposal)}</Text>
            </View>
          )}
          <View style={styles.totalLine}>
            <Text>Est. Duration</Text>
            <Text>{quote.estimatedDuration}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>ESTIMATED TOTAL</Text>
            <Text>{fmt(quote.total)}</Text>
          </View>
        </View>

        {quote.assumptions.length > 0 && (
          <>
            <Text style={styles.scopeBar}>ASSUMPTIONS</Text>
            <View style={styles.list}>
              {quote.assumptions.map((a, i) => (
                <Text style={styles.listItem} key={i}>
                  • {a}
                </Text>
              ))}
            </View>
          </>
        )}

        {quote.warnings.length > 0 && (
          <>
            <Text style={[styles.scopeBar, { backgroundColor: "#92400e" }]}>IMPORTANT NOTICES</Text>
            <View style={styles.list}>
              {quote.warnings.map((w, i) => (
                <Text style={[styles.listItem, { color: "#78350f" }]} key={i}>
                  • {w}
                </Text>
              ))}
            </View>
          </>
        )}

        <Text style={styles.thankYou}>Thank you for your business!</Text>
        <Text style={styles.terms}>
          This estimate is not a contract or invoice. It represents our best estimate of the total cost to complete
          the work described. Final pricing may change based on field conditions, material availability, or scope
          changes. Price change or additional materials/labor may be required — we will inform you before
          proceeding. This estimate is valid for 30 days from the date of issuance.
        </Text>

        <View style={styles.sigRow}>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigLabel}>Customer Signature</Text>
          </View>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigLabel}>Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
