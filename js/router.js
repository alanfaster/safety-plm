/**
 * Hash-based SPA router.
 * Routes: #/projects, #/project/:id, #/project/:id/item/:itemId/vcycle/:phase, etc.
 */

const routes = [];

export function route(pattern, handler) {
  // Convert :param to named capture groups
  const regexStr = pattern
    .replace(/\//g, '\\/')
    .replace(/:([a-zA-Z_]+)/g, '(?<$1>[^/]+)');
  routes.push({ regex: new RegExp(`^${regexStr}$`), handler });
}

export function navigate(path) {
  window.location.hash = path;
}

function getCurrentPath() {
  return window.location.hash.slice(1) || '/projects';
}

function dispatch(path) {
  for (const { regex, handler } of routes) {
    const match = path.match(regex);
    if (match) {
      handler(match.groups || {});
      return;
    }
  }
  // Default: redirect to projects
  navigate('/projects');
}

export function init() {
  window.addEventListener('hashchange', () => dispatch(getCurrentPath()));
  dispatch(getCurrentPath());
}
