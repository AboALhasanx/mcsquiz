// Copy to js/dropbox-config.js and put your Dropbox App Key below.
// (dropbox-config.js is gitignored — it never leaves your machine.)
// How to get the key (2 minutes, free, no payment):
//   1. Open https://www.dropbox.com/developers/apps and sign in.
//   2. "Create app" -> Scoped access -> App folder -> name it mcq-portal.
//   3. Copy the "App key" and paste it below.
//   4. In the app's settings page, under "OAuth 2 > Redirect URIs", add:
//        https://mcq-portal-jade.vercel.app/
//      and for local testing:
//        http://127.0.0.1:8080/
//      (exact match, including the trailing slash).
window.PORTAL_DROPBOX_KEY = '';
