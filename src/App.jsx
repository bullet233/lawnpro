import { Routes, Route, NavLink } from 'react-router-dom';
import { Users, Map as MapIcon, Route as RouteIcon, FileText, TrendingUp, Home } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import CustomersList from './pages/CustomersList';
import CustomerDetail from './pages/CustomerDetail';
import RouteBuilder from './pages/RouteBuilder';
import LiveMap from './pages/LiveMap';
import History from './pages/History';
import Analytics from './pages/Analytics';

function App() {
  return (
    <>
      <main className="page-container animate-fade-in">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<LiveMap />} />
          <Route path="/customers" element={<CustomersList />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/routes" element={<RouteBuilder />} />
          <Route path="/history" element={<History />} />
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </main>

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
    </>
  );
}

export default App;
