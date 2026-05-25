import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import MapProvider from './components/MapProvider'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MapProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </MapProvider>
  </StrictMode>,
)
