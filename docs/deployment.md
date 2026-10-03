# Static deployment

The simplest option is Vercel's static Vite preset. The app uses hash routes, so no server, functions or route rewrite is needed. Publish only `dist/` and keep financial/private fixtures out of the hosting project.

## Vercel

1. Push this source project to your private Git repository, excluding ignored files.
2. Import that repository in Vercel. If it is a monorepo, set Root Directory to `feng-finance`.
3. Framework: Vite. Install: `npm ci`. Build: `npm run build`. Output: `dist`. Node: 24 LTS. No environment variables are required.
4. Deploy. The included `vercel.json` sets static-only output and security/cache headers.
5. Open the HTTPS deployment URL, import a synthetic PDF, wait for Offline ready, then verify an offline reload and import. Follow `iphone-checklist.md` on a real device before relying on the app for financial records.

For CLI deployment from an authenticated local account: `npx vercel --prod` in the project directory. Review the resulting project's access controls. A private source repository does not automatically make the static application URL private. Financial data is never stored in the host, but deployment access protection may be enabled if desired.

## Cloudflare Pages

Use a Pages Git project with build command `npm run build`, output directory `dist`, root set to this project, Node 24 and no bindings/functions. `public/_headers` becomes `dist/_headers` and configures CSP and cache headers. Alternatively, from an authenticated account: `npx wrangler pages deploy dist --project-name feng-finance` after a successful build. Do not add Workers, D1 or R2.

## GitHub Pages

Set `VITE_BASE_PATH=/YOUR_REPOSITORY/` when building under a repository subpath:

```sh
npm ci
VITE_BASE_PATH=/feng-finance/ npm run build
```

Upload the contents of `dist` using the GitHub Pages Actions artifact/deployment workflow. For a custom-domain root deployment leave `VITE_BASE_PATH=/`. Set Pages HTTPS enforcement. Hash routes and relative manifest scope make subpath deployment work. GitHub Pages cannot configure the provided HTTP security headers; use Vercel/Cloudflare when CSP/response-header control is required. Never build a root-path artifact and place it under a subpath.

## Installation and updates

Safari → Share → Add to Home Screen → Open as Web App → Add. Use the same origin consistently to preserve the device-local database. Each installed browser profile/device keeps separate data.

The service worker precaches the HTML, hashed scripts, PDF worker/font/decoder assets, local English OCR model/runtime, icons and CSS. Updates wait until the user taps **Update**; users are warned to finish import review before reloading. The app checks for updates on launch and hourly while online. The new worker activates on user request; old precaches are cleaned. Database migrations execute independently and preserve records.

Do not cache `sw.js` or `manifest.webmanifest` indefinitely at a CDN. Deploy all files atomically. Keep HTTPS enabled. After each release, verify the update prompt from a tab running the previous release and confirm its transactions and backups remain intact.

## Build artifact transfer

Run `npm run build`, then upload all of `dist/` together. No `src`, `tests`, backups or local IndexedDB data are required by the host. PWA operation needs HTTPS or localhost. The 22 MB precache is an intentional first-install download that enables offline OCR without a CDN.
