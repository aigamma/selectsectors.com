import './style.css';
import { mountSiteShell } from './layout.ts';

// Entry for the 404 page. No active nav highlight because the user
// is on a route that doesn't map to any nav item.
mountSiteShell('none');
