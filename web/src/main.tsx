import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './state/auth'
import { applyDensity, readDensity } from './components/DensityToggle'
import './styles.css'

// Before the first paint, not in an effect after it. Reading the saved row
// spacing once React is already mounted means the board draws at the wrong
// density and then jumps, which is exactly the kind of flicker that makes
// an interface feel cheap.
applyDensity(readDensity())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
