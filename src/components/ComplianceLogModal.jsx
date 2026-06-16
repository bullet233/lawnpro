import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, Save, Copy, Repeat, Printer, Plus, Trash2 } from 'lucide-react';
import { getSettings } from '../db/settings';
import { parseLawnSizeToSqFt } from '../utils/parseLawnSize';

export default function ComplianceLogModal({ visit, customerName, customerLawnSize, initialLog, onSave, onClose }) {
  const settings = getSettings();
  const inventory = settings.chemicalInventory || [];
  const [log, setLog] = useState({
    applicatorName: settings.applicatorName || '',
    licenseNumber: settings.licenseNumber || '',
    businessPhone: settings.businessPhone || '',
    areaTreated: '',
    mixSite: 'Business Location',
    treatmentLocation: 'Turf',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    dateOfService: '',
    startTime: '',
    endTime: '',
    products: []
  });

  useEffect(() => {
    let newLog = { ...log };
    if (initialLog) {
      newLog = { ...newLog, ...initialLog };
      
      // Backward compatibility: Convert old single-product log to multi-product array
      if (initialLog.productName && (!initialLog.products || initialLog.products.length === 0)) {
        newLog.products = [{
          id: Date.now().toString(),
          productName: initialLog.productName || '',
          epaRegNum: initialLog.epaRegNum || '',
          targetSite: initialLog.targetSite || 'Turf',
          applicationRate: initialLog.applicationRate || initialLog.amountApplied || '',
          customerNotices: initialLog.customerNotices || (initialLog.customerNotice ? [initialLog.customerNotice] : []),
          isSpotTreatment: initialLog.isSpotTreatment || false,
          areaTreated: initialLog.areaTreated || ''
        }];
        // Clean up old fields
        delete newLog.productName;
        delete newLog.epaRegNum;
        delete newLog.targetSite;
        delete newLog.applicationRate;
        delete newLog.amountApplied;
        delete newLog.customerNotice; delete newLog.customerNotices;
      }
    } else {
      // If no initial log, start with an empty products list
      newLog.products = [];
    }
    
    // Auto-fill customer info if not present
    newLog.customerName = newLog.customerName || customerName || '';
    newLog.customerPhone = newLog.customerPhone || visit.phone || '';
    newLog.customerAddress = newLog.customerAddress || visit.address || '';
    newLog.dateOfService = newLog.dateOfService || new Date(visit.exitTime).toLocaleDateString();
    newLog.startTime = newLog.startTime || new Date(visit.exitTime - (visit.durationSecs || 0) * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    newLog.endTime = newLog.endTime || new Date(visit.exitTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    // Auto-fill area treated if we have customerLawnSize and no area is set yet
    if (!newLog.areaTreated && customerLawnSize) {
      const sqft = parseLawnSizeToSqFt(customerLawnSize);
      if (sqft) {
        newLog.areaTreated = `${sqft.toLocaleString()} sq ft`;
      } else {
        newLog.areaTreated = customerLawnSize;
      }
    }
    setLog(newLog);
  }, [initialLog, customerLawnSize]);

  const handleChange = (field, value) => {
    setLog(prev => ({ ...prev, [field]: value }));
  };

  const handleProductChange = (index, field, value) => {
    setLog(prev => {
      const newProducts = [...prev.products];
      newProducts[index] = { ...newProducts[index], [field]: value };
      return { ...prev, products: newProducts };
    });
  };

  const addProduct = (category = 'Other') => {
    setLog(prev => ({
      ...prev,
      products: [...prev.products, {
        id: Date.now().toString(),
        productName: '',
        epaRegNum: '',
        targetSite: 'Turf',
        applicationRate: '',
        customerNotices: [],
        category: category,
        isSpotTreatment: false,
        areaTreated: ''
      }]
    }));
  };

  const removeProduct = (index) => {
    setLog(prev => {
      const newProducts = [...prev.products];
      newProducts.splice(index, 1);
      return { ...prev, products: newProducts };
    });
  };

  const copyNotice = () => {
    let prods = '';
    let notices = new Set();

    if (log.products && log.products.length > 0) {
      prods = log.products.map(p => `- ${p.productName || 'N/A'} (EPA Reg #${p.epaRegNum || 'N/A'}) on ${p.targetSite || 'Turf'} @ ${p.applicationRate || 'N/A'}`).join('\n');
      log.products.forEach(p => {
        if (p.customerNotices && p.customerNotices.length > 0) {
          p.customerNotices.forEach(n => { if (n.trim() !== '') notices.add(n.trim()); });
        } else if (p.customerNotice && p.customerNotice.trim() !== '') {
          notices.add(p.customerNotice.trim());
        }
      });
    } else {
      prods = 'No products listed.';
    }

    let noticesText = Array.from(notices).map(n => `⚠️ ${n}`).join('\n');
    if (!noticesText) noticesText = 'Please keep children and pets off the treated area until dry (approx 2-3 hours).';

    const text = `Post-Application Notice\nDate: ${new Date(visit.exitTime).toLocaleDateString()}\nApplicator: ${log.applicatorName || 'Technician'}\n\nProducts Applied:\n${prods}\n\nInstructions:\n${noticesText}`;
    navigator.clipboard.writeText(text);
    alert('Notice copied to clipboard!');
  };

  const handleRepeatLast = () => {
    try {
      const last = JSON.parse(localStorage.getItem('last_epa_log'));
      if (last) {
        setLog(prev => ({
          ...prev,
          applicatorName: last.applicatorName || prev.applicatorName,
          licenseNumber: last.licenseNumber || prev.licenseNumber,
          businessPhone: last.businessPhone || prev.businessPhone,
          mixSite: last.mixSite || prev.mixSite,
          treatmentLocation: last.treatmentLocation || prev.treatmentLocation,
          products: last.products && last.products.length > 0 ? last.products : prev.products
        }));
      } else {
        alert('No previous log found to repeat.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = () => {
    localStorage.setItem('last_epa_log', JSON.stringify(log));
    onSave(log);
  };

  const CATEGORIES = ['Fertilizer', 'Weed Control', 'Pre-Emergent', 'Fungicide', 'Insecticide', 'Other'];
  
  const productsByCategory = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = [];
    return acc;
  }, {});

  if (log.products) {
    log.products.forEach((prod, index) => {
      const cat = CATEGORIES.includes(prod.category) ? prod.category : 'Other';
      productsByCategory[cat].push({ prod, globalIndex: index });
    });
  }

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <style>{`
        .epa-modal-grid .input-label {
          display: block;
          margin-bottom: 0.4rem;
        }
        .epa-modal-grid .input-field {
          width: 100%;
          box-sizing: border-box;
        }
      `}</style>
      <div className="modal-content animate-fade-in epa-modal-grid" style={{ maxWidth: '850px', width: '95%', maxHeight: '95vh', overflowY: 'auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ color: 'var(--color-primary)' }}>🧪</span> EPA Chemical Log
            </h3>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
              {customerName} • {new Date(visit.exitTime).toLocaleDateString()}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={24} />
          </button>
        </div>

        {/* ── SECTION 1: CUSTOMER INFORMATION ── */}
        <div style={{ background: 'var(--color-bg-main)', padding: '1.2rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--color-text-main)' }}>1. Customer Information</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="input-label">Name</label>
                <input type="text" className="input-field" value={log.customerName || ''} onChange={e => handleChange('customerName', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Phone</label>
                <input type="text" className="input-field" value={log.customerPhone || ''} onChange={e => handleChange('customerPhone', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
              <div>
                <label className="input-label">Address</label>
                <input type="text" className="input-field" value={log.customerAddress || ''} onChange={e => handleChange('customerAddress', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
              <div>
                <label className="input-label">Date of Service</label>
                <input type="text" className="input-field" value={log.dateOfService || ''} onChange={e => handleChange('dateOfService', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Start Time</label>
                <input type="text" className="input-field" value={log.startTime || ''} onChange={e => handleChange('startTime', e.target.value)} />
              </div>
              <div>
                <label className="input-label">End Time</label>
                <input type="text" className="input-field" value={log.endTime || ''} onChange={e => handleChange('endTime', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Property Size (Sq Ft)</label>
                <input type="text" className="input-field" value={log.areaTreated || ''} onChange={e => handleChange('areaTreated', e.target.value)} placeholder="e.g. 4500" />
              </div>
            </div>
          </div>
        </div>

        {/* ── SECTION 2: APPLICATOR INFORMATION ── */}
        <div style={{ background: 'var(--color-bg-main)', padding: '1.2rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--color-text-main)' }}>2. Applicator Information</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="input-label">Applicator Name</label>
                <input type="text" className="input-field" value={log.applicatorName} onChange={e => handleChange('applicatorName', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Applicator License #</label>
                <input type="text" className="input-field" value={log.licenseNumber || ''} onChange={e => handleChange('licenseNumber', e.target.value)} placeholder="e.g. 123456-CA" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="input-label">Business Phone #</label>
                <input type="text" className="input-field" value={log.businessPhone || ''} onChange={e => handleChange('businessPhone', e.target.value)} placeholder="e.g. 555-0199" />
              </div>
              <div>
                <label className="input-label">Mix / Load Site</label>
                <select className="input-field" style={{ width: '100%' }} value={log.mixSite} onChange={e => handleChange('mixSite', e.target.value)}>
                  <option>Business Location</option>
                  <option>On-Site (Customer Property)</option>
                </select>
              </div>
            </div>

          </div>
        </div>



        {/* ── SECTION 3: CHEMICALS APPLIED ── */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--color-text-main)' }}>3. Fertilizers and Chemicals Used</h4>

          {CATEGORIES.map(category => {
            const items = productsByCategory[category];
            if (items.length === 0) return null;

            const catInventory = inventory.filter(c => (c.category || 'Other') === category);

            return (
              <div key={category} style={{ marginBottom: '1.5rem', background: 'var(--color-bg-main)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h5 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{category}</h5>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {items.map(({ prod, globalIndex }, localIndex) => (
                    <div key={prod.id || globalIndex} style={{ position: 'relative', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Item {localIndex + 1}</div>
                        <button onClick={() => removeProduct(globalIndex)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}>
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: category === 'Fertilizer' ? '1fr' : '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                        <div>
                          <label className="input-label">Product Name</label>
                          <input 
                            type="text" 
                            className="input-field" 
                            list={`inventory-list-${globalIndex}`}
                            value={prod.productName} 
                            onChange={e => {
                              const val = e.target.value;
                              handleProductChange(globalIndex, 'productName', val);
                              const chem = catInventory.find(c => c.name === val);
                              if (chem) {
                                handleProductChange(globalIndex, 'epaRegNum', chem.epaRegNum || '');
                                handleProductChange(globalIndex, 'targetSite', chem.targetSite || 'Turf');
                                handleProductChange(globalIndex, 'applicationRate', chem.applicationRate || '');
                                handleProductChange(globalIndex, 'customerNotices', chem.customerNotices || (chem.customerNotice ? [chem.customerNotice] : []));
                                handleProductChange(globalIndex, 'category', chem.category || category);
                              }
                            }} 
                            placeholder={`e.g. ${category} Product`} 
                          />
                          <datalist id={`inventory-list-${globalIndex}`}>
                            {catInventory.map(chem => <option key={chem.id} value={chem.name} />)}
                          </datalist>
                        </div>
                        {category !== 'Fertilizer' && (
                          <div>
                            <label className="input-label">EPA Reg Number</label>
                            <input type="text" className="input-field" value={prod.epaRegNum} onChange={e => handleProductChange(globalIndex, 'epaRegNum', e.target.value)} />
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                        <div>
                          <label className="input-label">Target Site</label>
                          <input type="text" className="input-field" value={prod.targetSite} onChange={e => handleProductChange(globalIndex, 'targetSite', e.target.value)} placeholder="e.g. Turf, Beds" />
                        </div>
                        <div>
                          <label className="input-label">Application Rate</label>
                          <input type="text" className="input-field" value={prod.applicationRate} onChange={e => handleProductChange(globalIndex, 'applicationRate', e.target.value)} placeholder="e.g. 1.5 oz / 1000 sq ft" />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1rem' }}>
                        <div>
                          <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            Customer Instructions
                            <button type="button" onClick={() => {
                              const arr = prod.customerNotices || (prod.customerNotice ? [prod.customerNotice] : []);
                              handleProductChange(globalIndex, 'customerNotices', [...arr, '']);
                            }} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                              <Plus size={14} /> Add Line
                            </button>
                          </label>
                          {(prod.customerNotices || (prod.customerNotice ? [prod.customerNotice] : [])).map((notice, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <input type="text" className="input-field" value={notice} onChange={e => {
                                const arr = [...(prod.customerNotices || (prod.customerNotice ? [prod.customerNotice] : []))];
                                arr[idx] = e.target.value;
                                handleProductChange(globalIndex, 'customerNotices', arr);
                              }} placeholder="e.g. Keep off until dry" />
                              <button type="button" className="btn btn-secondary" onClick={() => {
                                const arr = (prod.customerNotices || (prod.customerNotice ? [prod.customerNotice] : [])).filter((_, i) => i !== idx);
                                handleProductChange(globalIndex, 'customerNotices', arr);
                              }} style={{ padding: '0.4rem 0.6rem', color: 'var(--color-danger)' }}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 100%' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input 
                              type="checkbox" 
                              checked={prod.isSpotTreatment || false} 
                              onChange={e => {
                                handleProductChange(globalIndex, 'isSpotTreatment', e.target.checked);
                                if (e.target.checked) {
                                  // Clear area treated when toggled so they enter the spot size
                                  handleProductChange(globalIndex, 'areaTreated', '');
                                }
                              }} 
                              style={{ width: '18px', height: '18px' }}
                            />
                            <span className="input-label" style={{ margin: 0 }}>This is a Spot Treatment</span>
                          </label>
                        </div>
                        {prod.isSpotTreatment && (
                          <div style={{ flex: '1 1 100%', background: '#fffbeb', padding: '1rem', borderRadius: '4px', borderLeft: '4px solid #f59e0b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                              <label className="input-label" style={{ color: '#b45309' }}>Estimated Area Treated (Sq Ft)</label>
                              <input type="text" className="input-field" style={{ borderColor: '#fcd34d' }} value={prod.areaTreated || ''} onChange={e => handleProductChange(globalIndex, 'areaTreated', e.target.value)} placeholder="e.g. 100" />
                              {(() => {
                                const totalStr = String(log.areaTreated || '');
                                const spotStr = String(prod.areaTreated || '');
                                const totalNum = parseFloat(totalStr.replace(/[^\d.]/g, '')) || 0;
                                const spotNum = parseFloat(spotStr.replace(/[^\d.]/g, '')) || 0;
                                
                                if (totalNum > 0 && spotNum > (totalNum * 0.10)) {
                                  return (
                                    <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '4px', fontWeight: 600 }}>
                                      ⚠️ Exceeds 10% of total property size ({totalNum.toLocaleString()} sq ft). This legally qualifies as a broadcast application.
                                    </div>
                                  );
                                }
                                return (
                                  <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '4px' }}>Must estimate area for spot treatments.</div>
                                );
                              })()}
                            </div>
                            <div>
                              <label className="input-label" style={{ color: '#b45309' }}>Specific Location</label>
                              <input type="text" className="input-field" style={{ borderColor: '#fcd34d' }} value={prod.spotLocation || ''} onChange={e => handleProductChange(globalIndex, 'spotLocation', e.target.value)} placeholder="e.g. Front walkway cracks" />
                              <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '4px' }}>Required by state law for spot applications.</div>
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            {CATEGORIES.map(cat => (
              <button 
                key={cat}
                className="btn btn-secondary" 
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', borderStyle: 'dashed', background: 'var(--color-bg-main)' }}
                onClick={() => addProduct(cat)}
              >
                <Plus size={14} style={{ marginRight: '0.3rem' }}/> {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ── CONTROLS ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '2rem', borderTop: '1px solid var(--color-border)', paddingTop: '1.2rem' }}>
          
          <button 
            className="btn btn-secondary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleRepeatLast}
          >
            <Repeat size={16} /> Repeat Last Saved Application
          </button>

          <button 
            className="btn btn-secondary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              if (window.confirm("Do you want to save these changes to the database before viewing the PDF?\n\nClick OK to Save and View, or Cancel to keep editing.")) {
                onSave(log);
                localStorage.setItem(`preview_epa_log_${visit.id}`, JSON.stringify(log));
                window.open(import.meta.env.BASE_URL + 'print-epa/' + visit.id + '?preview=true', '_blank');
              }
            }}
          >
            <Printer size={16} /> View Official PDF Sheet
          </button>

          <button 
            className="btn btn-secondary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={copyNotice}
          >
            <Copy size={16} /> Copy Customer Handover Notice
          </button>

          <button 
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center', padding: '0.8rem' }}
            onClick={handleSave}
          >
            <Save size={18} /> Save Compliance Log
          </button>

        </div>

      </div>
    </div>,
    document.body
  );
}
