import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../db/db';
import { Printer, ArrowLeft, Leaf } from 'lucide-react';
import { getSettings } from '../db/settings';

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
  if (!visit || !visit.complianceLog) return <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>EPA Log not found for this visit.</div>;

  const log = visit.complianceLog;
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
        customerNotice: log.customerNotice
      }];

  let customNotices = [];
  productsToPrint.forEach(p => {
    if (p.customerNotice && p.customerNotice.trim() !== '') {
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f172a', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
          
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            {logo ? (
              <img src={logo} alt="Business Logo" style={{ maxHeight: '80px', maxWidth: '180px', objectFit: 'contain' }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '60px', height: '60px', background: '#f1f5f9', borderRadius: '8px' }}>
                <Leaf size={32} color="#10b981" />
              </div>
            )}
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 0.2rem 0', color: '#0f172a' }}>
                {businessName}
              </h1>
              <div style={{ fontSize: '1rem', color: '#64748b', fontWeight: 500, marginBottom: '0.4rem' }}>
                Official Pesticide Application Record
              </div>
              {(address || phone || email) && (
                <div style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.4 }}>
                  {address && <div>{address}</div>}
                  {(phone || email) && (
                    <div>{phone}{phone && email && ' • '}{email}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>Date of Application</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
              {new Date(visit.exitTime).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>

        {/* CUSTOMER & TIMING */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem' }}>
          
          <div className="data-box">
            <div className="box-label">Service Address</div>
            <div className="box-value" style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '4px' }}>{customer?.name || 'N/A'}</div>
            <div className="box-value" style={{ color: '#475569' }}>{customer?.address || 'Address Not Provided'}</div>
          </div>

          <div className="data-box">
            <div className="box-label">Application Timing</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Date:</span>
              <span className="box-value">{new Date(visit.exitTime).toLocaleDateString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Start Time:</span>
              <span className="box-value">{visit.entryTime ? new Date(visit.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b', fontSize: '0.9rem' }}>End Time:</span>
              <span className="box-value">{new Date(visit.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

        </div>

        {/* APPLICATION DETAILS */}
        <div className="section-title">Chemical Application Details</div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginBottom: '2rem' }}>
          {CATEGORIES.map(category => {
            const items = productsByCategory[category];
            if (items.length === 0) return null;

            return (
              <div key={category}>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', marginBottom: '1rem' }}>
                  {category} APPLIED
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {items.map((prod, idx) => (
                    <div key={idx} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '16px' }}>
                      {items.length > 1 && (
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '12px', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
                          Item {idx + 1}
                        </div>
                      )}
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.2rem' }}>
                        <div>
                          <div className="box-label">Product Name</div>
                          <div className="box-value" style={{ fontSize: '1.2rem', fontWeight: 700 }}>{prod.productName || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="box-label">EPA Registration Number</div>
                          <div className="box-value" style={{ fontSize: '1.2rem', fontFamily: 'monospace' }}>{prod.epaRegNum || 'N/A'}</div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div>
                          <div className="box-label">Target Site</div>
                          <div className="box-value">{prod.targetSite || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="box-label">Application Rate</div>
                          <div className="box-value">{prod.applicationRate || prod.amountApplied || 'N/A'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* AREA TREATED & APPLICATOR DETAILS */}
        <div className="section-title">Treatment & Applicator Information</div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div className="data-box">
            <div className="box-label">Total Area Treated</div>
            <div className="box-value" style={{ fontSize: '1.2rem', fontWeight: 700 }}>{log.areaTreated || 'N/A'}</div>
          </div>
          <div className="data-box">
            <div className="box-label">Mix & Load Site</div>
            <div className="box-value" style={{ fontSize: '1.2rem' }}>{log.mixSite || 'Business Location'}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
          <div className="data-box">
            <div className="box-label">Applicator Name</div>
            <div className="box-value">{log.applicatorName || 'N/A'}</div>
            {log.licenseNumber && (
              <div style={{ marginTop: '4px', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                Lic #: {log.licenseNumber}
              </div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ marginTop: '4rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #10b981', fontSize: '0.85rem', color: '#475569', lineHeight: 1.6 }}>
          <p style={{ fontWeight: 700, color: '#0f172a', fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Regulatory Compliance Statement</p>
          <p style={{ margin: 0 }}>
            This document serves as the official pesticide application record for the customer listed above. Application details comply with all reporting standards for Commercial Landscape Applications under ATCP 29.21 & 29.22. 
          </p>
          <div style={{ marginTop: '1rem' }}>
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
