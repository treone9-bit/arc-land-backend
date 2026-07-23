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
    paddingTop: 55,
    paddingBottom: 55,
  },
  runningHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1a2744",
    borderBottomStyle: "solid",
  },
  runningHeaderText: {
    fontSize: 7.5,
    fontWeight: 700,
    color: "#1a2744",
    letterSpacing: 0.3,
  },
  runningFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 7,
    color: "#888888",
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    borderTopStyle: "solid",
  },
  titleBlock: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 32,
    paddingTop: 10,
    paddingBottom: 16,
  },
  titleText: {
    fontSize: 24,
    fontWeight: 700,
    color: "#1a2744",
  },
  subtitleText: {
    fontSize: 10,
    fontStyle: "italic",
    color: "#666666",
    marginTop: 4,
  },
  titleLogo: {
    width: 90,
  },
  infoBox: {
    flexDirection: "row",
    marginHorizontal: 32,
    marginBottom: 20,
    backgroundColor: "#f4f5f7",
    borderRadius: 4,
    padding: 14,
  },
  infoBoxCol: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 7.5,
    color: "#888888",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 9.5,
    fontWeight: 700,
    color: "#1a1a1a",
    marginBottom: 8,
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
  totalBar: {
    flexDirection: "row",
    marginHorizontal: 24,
    marginTop: 6,
    marginBottom: 12,
  },
  totalBarLabel: {
    flex: 1.4,
    backgroundColor: "#1a2744",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  totalBarAmountBox: {
    flex: 1,
    backgroundColor: "#c9971f",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  totalBarAmount: {
    fontSize: 15,
    fontWeight: 700,
    color: "#ffffff",
  },
  durationText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    padding: 24,
    paddingBottom: 8,
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
  listItemWrap: {
    paddingHorizontal: 24,
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
  parcelId?: string;
  scopeLabel: string;
  logoUrl: string;
  mapImageUrl?: string;
  mapBbox?: Bbox;
  parcelRings?: number[][][];
};

// Derives the bid's subtitle line from the job's selected service(s), e.g.
// "Complete Home Build — Exterior Shell Scope" or "Complete Land Clearing
// Scope". Exported so callers (which already know the service types) can
// compute this without QuoteDocument needing to know about serviceType/trades.
export function computeScopeLabel(serviceTypes: string[] | null | undefined): string {
  const types = (serviceTypes ?? []).filter(Boolean);
  if (types.length === 0) return "Construction Scope";
  if (types.includes("Complete Home Build")) return "Complete Home Build — Exterior Shell Scope";
  return `${types.join(" & ")} Scope`;
}

export default function QuoteDocument({
  quote,
  estNum,
  estDate,
  contactName,
  contactPhone,
  contactEmail,
  addressLine,
  countyLine,
  parcelId,
  scopeLabel,
  logoUrl,
  mapImageUrl,
  mapBbox,
  parcelRings,
}: QuoteDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.runningHeader} fixed>
          <Text style={styles.runningHeaderText}>
            ARC LAND DEVELOPMENT  •  arclanddevelopment@gmail.com  •  www.arclanddevelopment.net
          </Text>
          <Text style={styles.runningHeaderText}>Bid {estNum}</Text>
        </View>
        <Text
          style={styles.runningFooter}
          fixed
          render={({ pageNumber, totalPages }) =>
            `ARC Land Development  •  (954) 471-1507  •  arclanddevelopment@gmail.com  •  www.arclanddevelopment.net  •  Page ${pageNumber} of ${totalPages}`
          }
        />

        <View style={styles.titleBlock}>
          <View>
            <Text style={styles.titleText}>CONSTRUCTION BID PROPOSAL</Text>
            <Text style={styles.subtitleText}>{scopeLabel}</Text>
          </View>
          <Image src={logoUrl} style={styles.titleLogo} />
        </View>

        <View style={styles.infoBox}>
          <View style={styles.infoBoxCol}>
            <Text style={styles.infoLabel}>PREPARED FOR</Text>
            <Text style={[styles.infoValue, { marginBottom: contactPhone || contactEmail ? 1 : 8 }]}>
              {contactName || "—"}
            </Text>
            {(contactPhone || contactEmail) && (
              <Text style={[styles.infoLabel, { fontSize: 8, color: "#444444", marginBottom: 8 }]}>
                {[contactPhone, contactEmail].filter(Boolean).join("  •  ")}
              </Text>
            )}
            <Text style={styles.infoLabel}>PROPERTY</Text>
            <Text style={styles.infoValue}>{[addressLine, countyLine].filter(Boolean).join(", ") || "—"}</Text>
            {parcelId ? (
              <>
                <Text style={styles.infoLabel}>PARCEL #</Text>
                <Text style={[styles.infoValue, { marginBottom: 0 }]}>{parcelId}</Text>
              </>
            ) : null}
          </View>
          <View style={styles.infoBoxCol}>
            <Text style={styles.infoLabel}>BID NUMBER</Text>
            <Text style={styles.infoValue}>{estNum}</Text>
            <Text style={styles.infoLabel}>BID DATE</Text>
            <Text style={styles.infoValue}>{estDate}</Text>
            <Text style={styles.infoLabel}>VALID FOR</Text>
            <Text style={[styles.infoValue, { marginBottom: 0 }]}>30 Days from Issuance</Text>
          </View>
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
        </View>

        <View style={styles.totalBar} wrap={false}>
          <View style={styles.totalBarLabel}>
            <Text>TOTAL BID AMOUNT</Text>
          </View>
          <View style={styles.totalBarAmountBox}>
            <Text style={styles.totalBarAmount}>{fmt(quote.total)}</Text>
          </View>
        </View>

        <View wrap={false}>
          <Text style={styles.scopeBar}>ESTIMATED DURATION</Text>
          <Text style={styles.durationText}>{quote.estimatedDuration}</Text>
        </View>

        {quote.assumptions.length > 0 && (
          <>
            <View wrap={false}>
              <Text style={styles.scopeBar}>ASSUMPTIONS</Text>
              <View style={styles.listItemWrap}>
                <Text style={styles.listItem}>• {quote.assumptions[0]}</Text>
              </View>
            </View>
            {quote.assumptions.slice(1).map((a, i) => (
              <View style={styles.listItemWrap} key={i} wrap={false}>
                <Text style={styles.listItem}>• {a}</Text>
              </View>
            ))}
            <View style={{ marginBottom: 12 }} />
          </>
        )}

        {quote.warnings.length > 0 && (
          <>
            <View wrap={false}>
              <Text style={[styles.scopeBar, { backgroundColor: "#92400e" }]}>IMPORTANT NOTICES</Text>
              <View style={styles.listItemWrap}>
                <Text style={[styles.listItem, { color: "#78350f" }]}>• {quote.warnings[0]}</Text>
              </View>
            </View>
            {quote.warnings.slice(1).map((w, i) => (
              <View style={styles.listItemWrap} key={i} wrap={false}>
                <Text style={[styles.listItem, { color: "#78350f" }]}>• {w}</Text>
              </View>
            ))}
            <View style={{ marginBottom: 12 }} />
          </>
        )}

        <View wrap={false}>
          <Text style={styles.scopeBar}>ACCEPTANCE</Text>
          <Text style={styles.terms}>
            This document is a bid proposal, not a contract or invoice. It represents our best estimate of the total
            cost to complete the work described. Final pricing may change based on field conditions, material
            availability, or scope changes; the customer will be informed before any price change or additional
            materials/labor proceeds. This bid is valid for 30 days from the date of issuance.
          </Text>

          <View style={styles.sigRow}>
            <View style={styles.sigBlock}>
              <View style={styles.sigLine} />
              <Text style={styles.sigLabel}>Customer Signature / Date</Text>
            </View>
            <View style={styles.sigBlock}>
              <View style={styles.sigLine} />
              <Text style={styles.sigLabel}>ARC Land Development / Date</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
