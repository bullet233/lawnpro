import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../db/db';
import { Printer, ArrowLeft, Leaf } from 'lucide-react';
import { getSettings } from '../db/settings';

// Renders a value, or a muted "N/A" placeholder when empty. Module-scoped so it
// isn't recreated (and its subtree remounted) on every render of PrintEpaLog.
const Field = ({ val }) => {
  if (!val || val === 'N/A') return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 400 }}>N/A</span>;
  return val;
};

export default function PrintEpaLog() {
  const { visitId } = useParams();
  const [visit, setVisit] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = parseInt(visitId, 10);

    if (!isNaN(id)) {
      db.visits.get(id).then(v => {
        if (v) {
          setVisit(v);
          db.customers.get(v.customerId).then(c => {
            setCustomer(c);
            setLoading(false);
          });
        } else {
          setLoading(false);
        }
      });
    } else {
      setLoading(false);
    }
  }, [visitId]);

  if (loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>Loading document...</div>;
  const urlParams = new URLSearchParams(window.location.search);
  const isPreview = urlParams.get('preview') === 'true';
  const previewLogStr = isPreview ? localStorage.getItem(`preview_epa_log_${visitId}`) : null;
  let previewLog = null;
  try {
    if (previewLogStr) previewLog = JSON.parse(previewLogStr);
  } catch { /* malformed preview payload — fall back to saved log */ }

  if (!visit || (!visit.complianceLog && !previewLog)) return <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>EPA Log not found for this visit.</div>;

  const log = previewLog || visit.complianceLog;
  const settings = getSettings();
  const businessName = settings.businessName || settings.applicatorName || 'Landscape Professional';
  const logo = settings.businessLogo;
  const address = settings.businessAddress;
  const phone = settings.businessPhone;
  const email = settings.businessEmail;
  
  const productsToPrint = log.products && log.products.length > 0 
    ? log.products 
    : [{ 
        productName: log.productName, 
        epaRegNum: log.epaRegNum, 
        targetSite: log.targetSite, 
        applicationRate: log.applicationRate || log.amountApplied,
        customerNotices: log.customerNotices || (log.customerNotice ? [log.customerNotice] : [])
      }];

  let customNotices = [];
  productsToPrint.forEach(p => {
    if (p.customerNotices && p.customerNotices.length > 0) {
      p.customerNotices.forEach(n => {
        if (n.trim() !== '') customNotices.push({ name: p.productName || 'Product', notice: n.trim() });
      });
    } else if (p.customerNotice && p.customerNotice.trim() !== '') {
      customNotices.push({ name: p.productName || 'Product', notice: p.customerNotice.trim() });
    }
  });

  const CATEGORIES = ['Fertilizer', 'Weed Control', 'Pre-Emergent', 'Fungicide', 'Insecticide', 'Other'];
  const productsByCategory = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = [];
    return acc;
  }, {});

  productsToPrint.forEach(prod => {
    const cat = CATEGORIES.includes(prod.category) ? prod.category : 'Other';
    productsByCategory[cat].push(prod);
  });

  const printDoc = () => window.print();

  return (
    <div style={{ background: '#e2e8f0', minHeight: '100vh', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* ── SCREEN ONLY CONTROLS ── */}
      <style>
        {`
          @media print {
            .no-print { display: none !important; }
            body, .app-container { background: #fff !important; }
            .print-container { 
              box-shadow: none !important; 
              margin: 0 !important; 
              padding: 0 !important; 
              max-width: 100% !important; 
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
          
          .data-box {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 12px 16px;
            height: 100%;
          }
          .box-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            margin-bottom: 4px;
            font-weight: 700;
          }
          .box-value {
            font-size: 1.1rem;
            color: #0f172a;
            font-weight: 500;
          }
          .section-title {
            font-size: 1rem;
            font-weight: 700;
            color: #334155;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 8px;
            margin-bottom: 16px;
            margin-top: 32px;
          }
        `}
      </style>

      <div className="no-print" style={{ padding: '1rem', background: '#ffffff', borderBottom: '1px solid #cbd5e1', display: 'flex', gap: '1rem', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <button className="btn btn-secondary" onClick={() => window.close()}>
          <ArrowLeft size={18} /> Close
        </button>
        <button className="btn btn-primary" onClick={printDoc} style={{ flex: 1, justifyContent: 'center', fontSize: '1.1rem', padding: '0.5rem' }}>
          <Printer size={20} /> Save as PDF / Print
        </button>
      </div>

      {/* ── PRINTABLE DOCUMENT ── */}
      <div className="print-container" style={{ 
        background: '#fff', 
        maxWidth: '850px', 
        margin: '2rem auto', 
        padding: '3rem 4rem', 
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        borderRadius: '8px'
      }}>
        
        {/* HEADER / LETTERHEAD */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '1rem', marginBottom: '1rem' }}>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {logo ? (
              <img src={logo} alt="Business Logo" style={{ maxHeight: '60px', maxWidth: '140px', objectFit: 'contain' }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', background: '#f1f5f9', borderRadius: '8px' }}>
                <Leaf size={24} color="#10b981" />
              </div>
            )}
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.1rem 0', color: '#0f172a', lineHeight: 1.1 }}>
                {businessName}
              </h1>
              <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600, marginBottom: '0.2rem' }}>
                Official Pesticide Application Record
              </div>
              {(address || phone || email) && (
                <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.4 }}>
                  {address && <span>{address}</span>}
                  {address && (phone || email) && ' • '}
                  {(phone || email) && (
                    <span>{phone}{phone && email && ' • '}{email}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '2px' }}>Date of Application</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
              {new Date(visit.exitTime).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>

        {/* SECTION 1: CUSTOMER INFORMATION */}
        <div style={{ border: '1px solid #1e293b', marginBottom: '1rem', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #1e293b', padding: '6px 12px', fontWeight: 'bold', fontSize: '0.9rem', color: '#0f172a' }}>
            CUSTOMER INFORMATION
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #cbd5e1' }}>
            <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Customer Name</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={log.customerName || customer?.name} /></div>
            </div>
            <div style={{ padding: '4px 10px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Phone</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={log.customerPhone || customer?.phone} /></div>
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', borderBottom: '1px solid #cbd5e1' }}>
            <div style={{ padding: '4px 10px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Address</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={log.customerAddress || customer?.address} /></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Date of Service</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}>{log.dateOfService || new Date(visit.exitTime).toLocaleDateString()}</div>
            </div>
            <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Start Time</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}>{log.startTime || (visit.entryTime ? new Date(visit.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(visit.exitTime - (visit.durationSecs || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div>
            </div>
            <div style={{ padding: '4px 10px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>End Time</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}>{log.endTime || new Date(visit.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        </div>

        {/* SECTION 2: APPLICATOR INFORMATION */}
        <div style={{ border: '1px solid #1e293b', marginBottom: '1rem', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #1e293b', padding: '6px 12px', fontWeight: 'bold', fontSize: '0.9rem', color: '#0f172a' }}>
            APPLICATOR INFORMATION
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #cbd5e1' }}>
            <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Applicator Name</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={log.applicatorName} /></div>
            </div>
            <div style={{ padding: '4px 10px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>License #</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={log.licenseNumber} /></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Mix/Loading Site</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}>{log.mixSite || 'Business Location'}</div>
            </div>
            <div style={{ padding: '4px 10px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Business Phone</div>
              <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={log.businessPhone || phone} /></div>
            </div>
          </div>
        </div>


        {/* SECTION 4: FERTILIZERS AND CHEMICALS USED */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
          {CATEGORIES.map(category => {
            const items = productsByCategory[category];
            if (items.length === 0) return null;

            return (
              <div key={category} style={{ border: '1px solid #1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #1e293b', padding: '6px 12px', fontWeight: 'bold', fontSize: '0.9rem', color: '#0f172a', textTransform: 'uppercase' }}>
                  {category} APPLIED
                </div>
                {items.map((prod, idx) => (
                  <div key={idx} style={{ borderBottom: idx === items.length - 1 ? 'none' : '1px solid #1e293b' }}>
                    {items.length > 1 && (
                      <div style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #cbd5e1', padding: '4px 12px', fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase' }}>
                        Item {idx + 1}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: category === 'Fertilizer' ? '1fr' : '1fr 1fr', borderBottom: '1px solid #cbd5e1' }}>
                      <div style={{ padding: '4px 10px', borderRight: category === 'Fertilizer' ? 'none' : '1px solid #cbd5e1' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Product Name</div>
                        <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={prod.productName} /></div>
                      </div>
                      {category !== 'Fertilizer' && (
                        <div style={{ padding: '4px 10px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>EPA Registration Number</div>
                          <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={prod.epaRegNum} /></div>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: prod.isSpotTreatment ? '1px solid #cbd5e1' : 'none' }}>
                      <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Target Site</div>
                        <div style={{ color: '#0f172a', fontWeight: 600 }}>{prod.targetSite || log.treatmentLocation || 'Turf'}</div>
                      </div>
                      <div style={{ padding: '4px 10px', borderRight: '1px solid #cbd5e1' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Application Rate</div>
                        <div style={{ color: '#0f172a', fontWeight: 600 }}><Field val={prod.applicationRate || prod.amountApplied} /></div>
                      </div>
                      <div style={{ padding: '4px 10px' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '2px' }}>Area Treated</div>
                        <div style={{ color: '#0f172a', fontWeight: 600 }}>
                          {(() => {
                            const val = prod.areaTreated || log.areaTreated || 'N/A';
                            let displayVal = val;
                            if (val !== 'N/A' && !String(val).toLowerCase().includes('sq') && !String(val).toLowerCase().includes('acre')) {
                              displayVal = `${val} sq ft`;
                            }
                            if (prod.isSpotTreatment) {
                              return <span>{displayVal} <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.9em' }}>(Spot Treatment)</span></span>;
                            }
                            return displayVal;
                          })()}
                        </div>
                      </div>
                    </div>
                    {prod.isSpotTreatment && prod.spotLocation && (
                      <div style={{ padding: '4px 10px', borderTop: '1px solid #cbd5e1', display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' }}>Spot Treatment Location:</div>
                        <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.85rem' }}>{prod.spotLocation}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>



        {/* FOOTER */}
        <div style={{ marginTop: '2rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #10b981', fontSize: '0.85rem', color: '#475569', lineHeight: 1.6 }}>
          <div>
            <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#0f172a' }}>Customer Instructions:</strong>
            {customNotices.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {customNotices.map((n, i) => (
                  <li key={i}><strong>{n.name}:</strong> {n.notice}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0 }}>Please keep children and pets off the treated area until dry (approximately 2-3 hours) unless otherwise specified by the product label.</p>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
