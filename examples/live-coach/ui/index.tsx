import { mount } from 'telenow/react';
import App from './App';

// Single entry for every page this app renders (coach widget, admin, analytics).
// The platform picks the page via `telenow.context.page`; App switches on it.
mount(App);
