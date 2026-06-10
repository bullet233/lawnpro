import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Users, Map as MapIcon, Route as RouteIcon, FileText, TrendingUp, Home } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import CustomersList from './pages/CustomersList';
import CustomerDetail from './pages/CustomerDetail';
import RouteBuilder from './pages/RouteBuilder';
import LiveMap from './pages/LiveMap';
import History from './pages/History';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import PrintEpaLog from './pages/PrintEpaLog';
import Toast from './components/Toast';
import ReloadPrompt from './components/ReloadPrompt';
import { db } from './db/db';
import { getSettings, saveSettings } from './db/settings';

function App() {
  const location = useLocation();
  const isLive = location.pathname === '/live';
  const isPrint = location.pathname.startsWith('/print-epa');

  useEffect(() => {
    document.body.classList.add('sun-mode');
    
    // Auto-Migration Script for Custom Services
    const runMigration = async () => {
      if (localStorage.getItem('services_migrated_v2')) return;
      
      const settings = getSettings();
      let defaultServices = [...(settings.defaultServices || [])];
      let settingsChanged = false;
      
      const customers = await db.customers.toArray();
      const visits = await db.visits.toArray();
      
      for (const cust of customers) {
        if (!cust.services) continue;
        
        let custChanged = false;
        const newServices = [];
        const idMapping = {}; // oldId -> newId
        
        for (const svc of cust.services) {
          // If it's already a default service, keep it
          if (defaultServices.some(d => d.id === svc.id)) {
            newServices.push(svc);
            continue;
          }
          
          custChanged = true;
          const nameLower = svc.name.toLowerCase();
          let newId = null;
          
          if (nameLower.includes('mow') || nameLower.includes('cut') || nameLower.includes('trim') || nameLower.includes('yard')) {
            newId = 's1';
          } else if (nameLower.includes('fert') || nameLower.includes('spray') || nameLower.includes('weed') || nameLower.includes('chem')) {
            newId = 's3';
          } else {
            const existingMatch = defaultServices.find(d => d.name.toLowerCase() === nameLower);
            if (existingMatch) {
              newId = existingMatch.id;
            } else {
              newId = 's_' + Date.now() + Math.random().toString(36).substr(2, 5);
              defaultServices.push({ id: newId, name: svc.name, price: svc.price, category: 'Other', active: false });
              settingsChanged = true;
            }
          }
          
          idMapping[svc.id] = newId;
          
          if (!newServices.some(s => s.id === newId)) {
            newServices.push({ id: newId, name: svc.name, price: svc.price, active: svc.active });
          } else {
             const existing = newServices.find(s => s.id === newId);
             if (svc.active) existing.active = true;
          }
        }
        
        if (custChanged) {
          await db.customers.update(cust.id, { services: newServices });
          
          const custVisits = visits.filter(v => v.customerId === cust.id);
          for (const v of custVisits) {
            if (!v.appliedServices) continue;
            let vChanged = false;
            const newApplied = v.appliedServices.map(id => {
              if (idMapping[id]) {
                vChanged = true;
                return idMapping[id];
              }
              return id;
            });
            if (vChanged) {
              await db.visits.update(v.id, { appliedServices: [...new Set(newApplied)] });
            }
          }
        }
      }
      
      if (settingsChanged) {
        saveSettings({ defaultServices });
      }
      
      localStorage.setItem('services_migrated_v2', 'true');
    };
    
    runMigration();
  }, []);

  return (
    <>


      <main className="page-container animate-fade-in">
        <Toast />
        <ReloadPrompt />
        <div style={{ display: isLive ? 'block' : 'none', height: '100%' }}>
          <LiveMap />
        </div>
        <div style={{ display: isLive ? 'none' : 'block', height: '100%' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/live" element={null} />
            <Route path="/customers" element={<CustomersList />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/routes" element={<RouteBuilder />} />
            <Route path="/history" element={<History />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/print-epa/:visitId" element={<PrintEpaLog />} />
          </Routes>
        </div>
      </main>

      {!isPrint && (
        <nav className="bottom-nav">
        <NavLink to="/" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <Home size={24} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/live" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <MapIcon size={24} />
          <span>Live</span>
        </NavLink>
        <NavLink to="/routes" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <RouteIcon size={24} />
          <span>Routes</span>
        </NavLink>
        <NavLink to="/history" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <FileText size={24} />
          <span>Logs</span>
        </NavLink>
        <NavLink to="/analytics" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <TrendingUp size={24} />
          <span>Stats</span>
        </NavLink>
        <NavLink to="/customers" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <Users size={24} />
          <span>Clients</span>
        </NavLink>
      </nav>
      )}
    </>
  );
}

export default App;

