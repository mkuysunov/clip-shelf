import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Onboarding from './Onboarding.jsx';
import Settings from './Settings.jsx';
import './styles.css';

// Одно и то же приложение обслуживает панель и обычные окна (приветствие, настройки): выбираем по hash
const PAGES = { '#onboarding': Onboarding, '#settings': Settings };
const Root = PAGES[window.location.hash] || App;
document.body.classList.toggle('window-page', Root !== App);

createRoot(document.getElementById('root')).render(<Root />);
