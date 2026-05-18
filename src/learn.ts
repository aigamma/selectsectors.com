import './style.css';
import { mountSiteShell } from './layout.ts';

// Entry for the /learn landing page. Mounts the site shell with the
// Learn nav highlighted; no other page-specific JS is needed because
// the landing is static content (a directory of curriculum sections).
mountSiteShell('learn');
