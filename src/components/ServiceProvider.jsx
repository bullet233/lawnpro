import React, { createContext, useContext, useState, useEffect } from 'react';

const ServiceContext = createContext(null);

export function ServiceProvider({ children }) {
  // Load initial mode from localStorage so it persists across reloads
  const [activeMode, setActiveMode] = useState(() => {
    return localStorage.getItem('service_mode') || 'mowing';
  });

  useEffect(() => {
    localStorage.setItem('service_mode', activeMode);
    
    // Toggle theme class for visual differentiation
    if (activeMode === 'fertilizer') {
      document.body.classList.add('theme-fertilizer');
    } else {
      document.body.classList.remove('theme-fertilizer');
    }
  }, [activeMode]);

  return (
    <ServiceContext.Provider value={{ activeMode, setActiveMode }}>
      {children}
    </ServiceContext.Provider>
  );
}

export function useServiceMode() {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServiceMode must be used within a ServiceProvider');
  }
  return context;
}
