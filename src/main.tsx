import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Onboarding from './Onboarding';
import Settings from './Settings';
import './styles.css';

// Одно и то же приложение обслуживает панель и обычные окна (приветствие, настройки): выбираем по hash
const PAGES: Record<string, ComponentType> = { '#onboarding': Onboarding, '#settings': Settings };
const Root = PAGES[window.location.hash] || App;
document.body.classList.toggle('window-page', Root !== App);

createRoot(document.getElementById('root')!).render(<Root />);
