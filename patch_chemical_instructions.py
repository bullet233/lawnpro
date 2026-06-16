import re

def patch_settings():
    with open('src/pages/Settings.jsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. useState
    content = content.replace("const [newChemNotice, setNewChemNotice] = useState('');", "const [newChemNotices, setNewChemNotices] = useState([]);")

    # 2. save object
    content = content.replace("customerNotice: newChemNotice.trim(),", "customerNotices: newChemNotices.filter(n => n.trim() !== ''),")

    # 3. reset state
    content = content.replace("setNewChemNotice('');", "setNewChemNotices([]);")

    # 4. load state
    content = content.replace("setNewChemNotice(chem.customerNotice || '');", "setNewChemNotices(chem.customerNotices || (chem.customerNotice ? [chem.customerNotice] : []));")

    # 5. UI Render for existing chemicals
    old_ui = "{chem.customerNotice && <div>Notice: {chem.customerNotice}</div>}"
    new_ui = """{chem.customerNotices && chem.customerNotices.length > 0 ? (
                      <div style={{ marginTop: '0.2rem' }}>
                        Instructions:
                        <ul style={{ margin: '0.2rem 0 0 1rem', padding: 0 }}>
                          {chem.customerNotices.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                      </div>
                    ) : chem.customerNotice ? (
                      <div style={{ marginTop: '0.2rem' }}>Notice: {chem.customerNotice}</div>
                    ) : null}"""
    content = content.replace(old_ui, new_ui)

    # 6. Add inputs
    old_inputs = """            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" className="input-field" placeholder="Customer Notice (e.g. Keep off until dry)" value={newChemNotice} onChange={e => setNewChemNotice(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={saveChemical} style={{ padding: '0.4rem 0.8rem' }}>
                {editingChemId ? <Check size={16} /> : <Plus size={16} />}
              </button>
            </div>"""
              
    new_inputs = """            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {newChemNotices.map((notice, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" className="input-field" placeholder="Instruction (e.g. Keep off until dry)" value={notice} onChange={e => {
                    const updated = [...newChemNotices];
                    updated[idx] = e.target.value;
                    setNewChemNotices(updated);
                  }} style={{ flex: 1 }} />
                  <button type="button" className="btn btn-secondary" onClick={() => setNewChemNotices(newChemNotices.filter((_, i) => i !== idx))} style={{ padding: '0.4rem 0.6rem', color: 'var(--color-danger)' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setNewChemNotices([...newChemNotices, ''])} style={{ flex: 1, padding: '0.4rem' }}>
                  <Plus size={16} style={{ marginRight: '0.4rem' }} /> Add Instruction
                </button>
                <button type="button" className="btn btn-secondary" onClick={saveChemical} style={{ padding: '0.4rem 0.8rem' }}>
                  {editingChemId ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </div>
            </div>"""
    content = content.replace(old_inputs, new_inputs)

    with open('src/pages/Settings.jsx', 'w', encoding='utf-8') as f:
        f.write(content)

patch_settings()
