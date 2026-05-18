import './style.css';
import { mountSiteShell } from './layout.ts';

// Entry for the /learn/why-rust/ page. Pure content; the lesson body
// is in the HTML. JS only mounts the shared shell with the Learn nav
// highlighted.
mountSiteShell('learn');
