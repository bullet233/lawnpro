import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import MapProvider from './components/MapProvider'
import { ServiceProvider } from './components/ServiceProvider'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MapProvider>
      <ServiceProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <App />
        </BrowserRouter>
      </ServiceProvider>
    </MapProvider>
  </StrictMode>,
)
