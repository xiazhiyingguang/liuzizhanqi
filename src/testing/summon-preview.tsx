import React from 'react';
import { createRoot } from 'react-dom/client';
import HeroSummon from '../components/Summon/HeroSummon';
import '../index.css';

// Standalone preview, absent from the main game bundle.
createRoot(document.getElementById('root')!).render(
    <React.StrictMode><HeroSummon onClose={() => { window.location.href = import.meta.env.BASE_URL; }} /></React.StrictMode>,
);
