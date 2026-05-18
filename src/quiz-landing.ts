import './style.css';
import { mountSiteShell } from './layout.ts';

// Entry for the /quiz/ landing page. Mounts the site shell with the
// Quiz nav highlighted. Pure content; the category cards are static.
mountSiteShell('quiz');
